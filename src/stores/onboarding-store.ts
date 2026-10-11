import { createStore } from "zustand/vanilla";
import { APP } from "../constants/app";

export const ONBOARDING_STORAGE_KEY = `${APP.storagePrefix}.onboarding.v1`;

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

type OnboardingState = {
  status: "idle" | "loading" | "ready" | "error";
  completed: boolean;
  hydrate: () => Promise<void>;
  complete: () => Promise<void>;
};

export function createOnboardingStore(storage: Storage) {
  let hydration: Promise<void> | undefined;
  let completion: Promise<void> | undefined;

  return createStore<OnboardingState>((set, get) => ({
    status: "idle",
    completed: false,
    hydrate: () => {
      if (get().status === "ready") return Promise.resolve();
      if (hydration) return hydration;
      set({ status: "loading" });
      hydration = storage
        .getItem(ONBOARDING_STORAGE_KEY)
        .then((value) => set({ completed: value === "1", status: "ready" }))
        // A read failure still allows the introduction to open and be retried.
        .catch(() => set({ status: "error" }))
        .finally(() => {
          hydration = undefined;
        });
      return hydration;
    },
    complete: () => {
      if (get().completed) return Promise.resolve();
      if (completion) return completion;
      completion = (async () => {
        if (get().status === "idle" || get().status === "loading")
          await get().hydrate();
        await storage.setItem(ONBOARDING_STORAGE_KEY, "1");
        set({ completed: true, status: "ready" });
      })().finally(() => {
        completion = undefined;
      });
      return completion;
    },
  }));
}
