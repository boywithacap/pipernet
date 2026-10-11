import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStore } from "zustand";
import { createOnboardingStore } from "@/stores/onboarding-store";

export const onboardingStore = createOnboardingStore(AsyncStorage);
type State = ReturnType<typeof onboardingStore.getState>;

export function useOnboarding<T>(selector: (state: State) => T) {
  return useStore(onboardingStore, selector);
}
