import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createVideoPlayer } from "expo-video";
import type { MediaDraft, MediaFiles, MediaItem } from "@/types/media";
import { assertMediaSize, fitPhoto, MEDIA_LIMITS } from "./media-policy";

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
): Promise<MediaDraft> {
  // JPEG is readable on both platforms. Re-encode without location/EXIF metadata.
  for (const [edge, quality] of [
    [640, 0.35],
    [480, 0.25],
    [320, 0.2],
  ] as const) {
    const context = ImageManipulator.manipulate(uri);
    let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      context.resize(fitPhoto(width, height, edge));
      image = await context.renderAsync();
      const result = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: quality,
      });
      const bytes = new File(result.uri).size;
      if (bytes > 0 && bytes <= MEDIA_LIMITS.photoBytes) {
        return { uri: result.uri, kind: "photo", bytes };
      }
      deleteTemporaryFile(result.uri);
    } finally {
      image?.release();
      context.release();
    }
  }
  throw new Error("Photo too large. Try again.");
}

export async function prepareVideo(uri: string): Promise<MediaDraft> {
  const bytes = new File(uri).size;
  assertMediaSize("video", bytes);
  const draft: MediaDraft = { uri, kind: "video", bytes };
  const player = createVideoPlayer(null);
  try {
    await player.replaceAsync(uri);
    const [thumbnail] = await player.generateThumbnailsAsync(0, {
      maxWidth: 240,
      maxHeight: 320,
    });
    draft.duration = player.duration;
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
