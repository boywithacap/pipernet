import type { MediaKind } from "../types/media";

export const MEDIA_LIMITS = {
  photoEdge: 640,
  photoBytes: 100 * 1024,
  videoSeconds: 60,
  videoBitrate: 400_000,
  videoEdge: 480,
  videoTargetBytes: 3 * 1024 * 1024,
  // Room for 60 seconds of compressed video, audio, and container overhead.
  videoBytes: 5 * 1024 * 1024,
} as const;

export const VIDEO_COMPRESSION_PASSES = [
  { maxSize: MEDIA_LIMITS.videoEdge, bitrate: 240_000 },
  { maxSize: 360, bitrate: 160_000 },
  { maxSize: 240, bitrate: 96_000 },
] as const;

export function assertMediaSize(kind: MediaKind, bytes: number) {
  const limit =
    kind === "photo" ? MEDIA_LIMITS.photoBytes : MEDIA_LIMITS.videoBytes;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error("This capture is empty. Try again.");
  }
  if (bytes > limit) {
    throw new Error(
      kind === "photo"
        ? "Photo too large. Try again."
        : "Video too large. Record a shorter video.",
    );
  }
}

export function fitPhoto(
  width: number,
  height: number,
  edge: number = MEDIA_LIMITS.photoEdge,
) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
