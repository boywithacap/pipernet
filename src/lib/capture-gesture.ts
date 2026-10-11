export type VideoIntent = {
  requiresHold: boolean;
  started: boolean;
  released: boolean;
  cancelled: boolean;
};

// Keep a hold's identity across permission prompts and camera remounts.
export function createCaptureGesture() {
  let held = false;
  let consumed = false;
  let video: VideoIntent | null = null;

  return {
    pressIn() {
      held = true;
      if (!video) consumed = false;
    },
    pressOut() {
      held = false;
      if (!video?.requiresHold) return null;
      video.released = true;
      return video;
    },
    beginVideo(requiresHold = true) {
      consumed = true;
      if (video || (requiresHold && !held)) return null;
      video = {
        requiresHold,
        started: false,
        released: false,
        cancelled: false,
      };
      return video;
    },
    startVideo(intent: VideoIntent) {
      if (
        video !== intent ||
        intent.started ||
        intent.released ||
        intent.cancelled
      )
        return false;
      intent.started = true;
      return true;
    },
    takePhoto(fromAccessibility = false) {
      if (video || (consumed && !fromAccessibility)) return false;
      consumed = true;
      return true;
    },
    cancel() {
      held = false;
      consumed = true;
      const previous = video;
      if (previous) previous.cancelled = true;
      video = null;
      return previous;
    },
    finish(intent: VideoIntent) {
      if (video === intent) video = null;
    },
    get video() {
      return video;
    },
  };
}
