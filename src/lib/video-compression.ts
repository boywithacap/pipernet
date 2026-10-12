import { MEDIA_LIMITS, VIDEO_COMPRESSION_PASSES } from "./media-policy";

type VideoEncoder = {
  encode: (
    uri: string,
    options: { maxSize: number; bitrate: number },
  ) => Promise<string>;
  adopt: (uri: string) => string | Promise<string>;
  size: (uri: string) => number;
  remove: (uri: string) => void;
};

/** Bound output by actual bytes; each lower-quality pass starts from the original. */
export async function encodeVideoForMesh(
  source: string,
  duration: number,
  io: VideoEncoder,
) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > MEDIA_LIMITS.videoSeconds + 0.5
  ) {
    throw new Error("Record a video of 60 seconds or less.");
  }
  for (const options of VIDEO_COMPRESSION_PASSES) {
    const raw = await io.encode(source, options);
    let uri = raw;
    let retained = false;
    try {
      uri = raw === source ? source : await io.adopt(raw);
      const bytes = io.size(uri);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new Error("Couldn’t read the compressed video. Try again.");
      }
      if (bytes <= MEDIA_LIMITS.videoTargetBytes) {
        retained = true;
        return uri;
      }
    } finally {
      if (!retained && uri !== source) io.remove(uri);
    }
  }
  throw new Error("Video exceeds the sharing budget. Record a shorter clip.");
}
