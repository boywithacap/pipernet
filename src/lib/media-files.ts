import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createVideoPlayer } from "expo-video";
import { randomUUID } from "expo-crypto";
import native from "../../modules/nearby-transport";
import mediaStamp from "../../modules/media-stamp";
import type { MeshEnvelope } from "@/types/mesh";
import type { MediaDraft, MediaFiles, MediaItem } from "@/types/media";
import { assertMediaSize, fitPhoto, MEDIA_LIMITS } from "./media-policy";
import { encodeVideoForMesh } from "./video-compression";
import { formatCaptureStamp } from "./capture-time";

function mediaDirectory() {
  const directory = new Directory(Paths.document, "moments");
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function mediaUri(item: MediaItem) {
  return new File(Paths.document, "moments", item.fileName).uri;
}

export function thumbnailUri(item: MediaItem) {
  return item.thumbnailName
    ? new File(Paths.document, "moments", item.thumbnailName).uri
    : item.kind === "photo"
      ? mediaUri(item)
      : undefined;
}

export function deleteTemporaryFile(uri?: string) {
  if (!uri) return;
  try {
    // Only remove our temporary captures, never a durable moment or an external URI.
    if (!uri.startsWith(Paths.cache.uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache eviction is best effort; the OS can reclaim these files.
  }
}

export function discardDraft(draft: MediaDraft) {
  deleteTemporaryFile(draft.uri);
  deleteTemporaryFile(draft.thumbnailUri);
}

export async function compressPhoto(
  uri: string,
  width: number,
  height: number,
  createdAt = Date.now(),
): Promise<MediaDraft> {
  if (!mediaStamp?.stampPhoto)
    throw new Error(
      "Photo timestamps need an updated PiperNet development build.",
    );
  const stamp = formatCaptureStamp(createdAt);
  // JPEG is readable on both platforms. Re-encode without location/EXIF metadata.
  for (const [edge, quality] of [
    [640, 0.35],
    [480, 0.25],
    [320, 0.2],
  ] as const) {
    const context = ImageManipulator.manipulate(uri);
    let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    let resizedUri: string | undefined;
    let stampedUri: string | undefined;
    let retained = false;
    try {
      context.resize(fitPhoto(width, height, edge));
      image = await context.renderAsync();
      // Use a lossless intermediate so the timestamp and JPEG compression happen once.
      const result = await image.saveAsync({ format: SaveFormat.PNG });
      resizedUri = result.uri;
      stampedUri = await mediaStamp.stampPhoto(resizedUri, stamp, quality);
      const bytes = new File(stampedUri).size;
      if (bytes > 0 && bytes <= MEDIA_LIMITS.photoBytes) {
        retained = true;
        return { uri: stampedUri, kind: "photo", bytes, createdAt };
      }
    } finally {
      deleteTemporaryFile(resizedUri);
      if (!retained) deleteTemporaryFile(stampedUri);
      image?.release();
      context.release();
    }
  }
  throw new Error("Photo too large. Try again.");
}

/** Re-encode captured video to H.264 in native code; try lower bitrates until it meets the budget. */
export async function prepareVideo(
  uri: string,
  createdAt = Date.now(),
): Promise<MediaDraft> {
  if (!native)
    throw new Error("Video compression needs a PiperNet development build.");
  if (!mediaStamp?.stampVideo)
    throw new Error(
      "Video timestamps need an updated PiperNet development build.",
    );
  const stamp = formatCaptureStamp(createdAt);
  const { Video, getVideoMetaData } = await import("react-native-compressor");
  const metadata = await getVideoMetaData(uri);
  let compressed: string | undefined;
  let stamped: string | undefined;
  try {
    // Burn into frames before the existing bounded compression passes. Shared files
    // and locally generated thumbnails then carry the same frozen capture time.
    stamped = await mediaStamp.stampVideo(uri, stamp);
    compressed = await encodeVideoForMesh(stamped, metadata.duration, {
      encode: (source, pass) =>
        Video.compress(source, {
          ...pass,
          compressionMethod: "manual",
          minimumFileSizeForCompress: 0,
        }),
      adopt: async (result) => {
        // iOS encoders return tmp/ URLs. Adopt into cache for validation and cleanup.
        const file = new File(result);
        // SDK 57 moves asynchronously and updates file.uri only on completion.
        await file.move(
          new File(Paths.cache, `piper-video-${randomUUID()}.mp4`),
        );
        return file.uri;
      },
      size: (result) => new File(result).size,
      remove: deleteTemporaryFile,
    });
    const inspection = await native.inspectMedia(compressed);
    if (inspection.kind !== "video")
      throw new Error("Couldn’t encode a compatible video.");
    const draft = await videoDraft(compressed, inspection.duration);
    if (compressed !== uri) deleteTemporaryFile(uri);
    return { ...draft, createdAt };
  } catch (error) {
    if (compressed && compressed !== uri) deleteTemporaryFile(compressed);
    throw error;
  } finally {
    if (stamped && stamped !== compressed && stamped !== uri)
      deleteTemporaryFile(stamped);
  }
}

async function videoDraft(uri: string, duration?: number): Promise<MediaDraft> {
  const bytes = new File(uri).size;
  assertMediaSize("video", bytes);
  const draft: MediaDraft = { uri, kind: "video", bytes, duration };
  const player = createVideoPlayer(null);
  try {
    await player.replaceAsync(uri);
    const [thumbnail] = await player.generateThumbnailsAsync(0, {
      maxWidth: 240,
      maxHeight: 320,
    });
    if (
      Number.isFinite(player.duration) &&
      player.duration > 0 &&
      player.duration <= MEDIA_LIMITS.videoSeconds + 0.5
    ) {
      draft.duration = player.duration;
    }
    if (thumbnail) {
      const context = ImageManipulator.manipulate(thumbnail);
      let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        image = await context.renderAsync();
        const result = await image.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.45,
        });
        draft.thumbnailUri = result.uri;
      } finally {
        image?.release();
        context.release();
        thumbnail.release();
      }
    }
  } catch {
    // A missing poster shouldn't discard a playable capture.
  } finally {
    player.release();
  }
  return draft;
}

/** Validate actual file headers/dimensions/duration before invoking a media decoder. */
export async function prepareReceivedMedia(
  uri: string,
  envelope: MeshEnvelope,
): Promise<MediaDraft> {
  if (!native) throw new Error("Offline sharing needs a development build.");
  let adopted: File | undefined;
  try {
    // Nearby delivers opaque .bin files. AVFoundation needs a video extension
    // even for valid MP4 bytes; the native inspector still validates their format.
    const source = new File(uri);
    if (
      envelope.kind === "video" &&
      ![".mp4", ".mov"].includes(source.extension.toLowerCase())
    ) {
      adopted = new File(Paths.cache, `piper-received-${randomUUID()}.mp4`);
      await source.move(adopted);
      uri = adopted.uri;
    }
    const inspection = await native.inspectMedia(uri);
    assertMediaSize(inspection.kind, inspection.bytes);
    if (
      inspection.kind !== envelope.kind ||
      inspection.bytes !== envelope.bytes
    )
      throw new Error("Incoming media does not match its offer.");
    const draft: MediaDraft =
      inspection.kind === "video"
        ? await videoDraft(uri, inspection.duration)
        : { uri, kind: "photo", bytes: inspection.bytes };
    return { ...draft, createdAt: envelope.createdAt };
  } catch (error) {
    if (adopted) deleteTemporaryFile(adopted.uri);
    throw new Error(
      "Couldn’t prepare incoming media. It will retry automatically.",
      { cause: error },
    );
  }
}

export const mediaFiles: MediaFiles = {
  async save(id, draft) {
    assertMediaSize(draft.kind, new File(draft.uri).size);
    const directory = mediaDirectory();
    const extension =
      draft.kind === "photo"
        ? "jpg"
        : new File(draft.uri).extension === ".mov"
          ? "mov"
          : "mp4";
    const fileName = `${id}.${extension}`;
    const thumbnailName = draft.thumbnailUri ? `${id}-thumb.jpg` : undefined;
    try {
      await new File(draft.uri).copy(new File(directory, fileName));
      if (thumbnailName && draft.thumbnailUri) {
        await new File(draft.thumbnailUri).copy(
          new File(directory, thumbnailName),
        );
      }
      return { fileName, thumbnailName };
    } catch {
      await mediaFiles
        .remove({ fileName, thumbnailName })
        .catch(() => undefined);
      throw new Error("Couldn’t save. Check device storage.");
    }
  },
  async remove(item) {
    for (const name of [item.fileName, item.thumbnailName]) {
      if (!name) continue;
      const file = new File(Paths.document, "moments", name);
      if (file.exists) file.delete();
    }
  },
};
