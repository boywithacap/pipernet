import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

function trigger(effect: () => Promise<void>) {
  if (Platform.OS === "web") return;
  void effect().catch(() => undefined);
}

export function hapticButtonPress() {
  trigger(() =>
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  );
}

export function hapticDragStart() {
  trigger(() =>
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Drag_Start)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  );
}

export function hapticDragEnd() {
  trigger(() =>
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Gesture_End)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  );
}

export function hapticSwipeOpen() {
  trigger(() =>
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Gesture_End)
      : Haptics.selectionAsync(),
  );
}

export function hapticSelection() {
  trigger(() =>
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.selectionAsync(),
  );
}

/** A small acknowledgement after pull-to-refresh crosses its trigger point. */
export function hapticRefresh() {
  trigger(() => Haptics.selectionAsync());
}
