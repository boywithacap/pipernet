import { useSyncExternalStore } from "react";
import { isAppActive, subscribeAppActive } from "@/lib/app-state";

export function useAppActive() {
  return useSyncExternalStore(subscribeAppActive, isAppActive, () => false);
}
