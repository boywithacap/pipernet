import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStore } from "zustand";
import { mediaFiles } from "@/lib/media-files";
import { createMediaStore } from "@/stores/media-store";

export const mediaStore = createMediaStore(AsyncStorage, mediaFiles);
type State = ReturnType<typeof mediaStore.getState>;

export function useMedia<T>(selector: (state: State) => T) {
  return useStore(mediaStore, selector);
}
