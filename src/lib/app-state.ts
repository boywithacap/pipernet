import { AppState, Platform } from "react-native";

let focused = true;

export function isAppActive() {
  return (
    AppState.currentState === "active" && (Platform.OS !== "android" || focused)
  );
}

export function subscribeAppActive(listener: () => void) {
  const change = AppState.addEventListener("change", (state) => {
    if (Platform.OS === "android" && state !== "active") focused = false;
    listener();
  });
  const focus =
    Platform.OS === "android"
      ? AppState.addEventListener("focus", () => {
          focused = true;
          listener();
        })
      : undefined;
  const blur =
    Platform.OS === "android"
      ? AppState.addEventListener("blur", () => {
          focused = false;
          listener();
        })
      : undefined;
  return () => {
    change.remove();
    focus?.remove();
    blur?.remove();
  };
}
