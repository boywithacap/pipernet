import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOnboardingStore,
  ONBOARDING_STORAGE_KEY,
} from "../src/stores/onboarding-store";

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  return { values, storage, store: createOnboardingStore(storage) };
}

test("a fresh install opens onboarding and completion survives a restart", async () => {
  const { store, storage, values } = setup();
  await store.getState().hydrate();
  assert.equal(store.getState().status, "ready");
  assert.equal(store.getState().completed, false);
  await store.getState().complete();
  assert.equal(values.get(ONBOARDING_STORAGE_KEY), "1");
  const restarted = createOnboardingStore(storage);
  await restarted.getState().hydrate();
  assert.equal(restarted.getState().completed, true);
});

test("completion does not enter the app until storage succeeds and can be retried", async () => {
  const { storage } = setup();
  let fail = true;
  const store = createOnboardingStore({
    ...storage,
    setItem: async (key, value) => {
      if (fail) throw new Error("Storage unavailable");
      await storage.setItem(key, value);
    },
  });
  await store.getState().hydrate();
  await assert.rejects(store.getState().complete());
  assert.equal(store.getState().completed, false);
  fail = false;
  await store.getState().complete();
  assert.equal(store.getState().completed, true);
});

test("duplicate startup reads and finish taps share their in-flight work", async () => {
  let reads = 0;
  let writes = 0;
  const store = createOnboardingStore({
    getItem: async () => {
      reads++;
      return null;
    },
    setItem: async () => {
      writes++;
    },
  });
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()]);
  await Promise.all([store.getState().complete(), store.getState().complete()]);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});

test("completion waits for a pending startup read so it cannot be overwritten", async () => {
  let finishRead: (value: string | null) => void = () => {};
  const store = createOnboardingStore({
    getItem: () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    setItem: async () => {},
  });
  const reading = store.getState().hydrate();
  const finishing = store.getState().complete();
  finishRead(null);
  await Promise.all([reading, finishing]);
  assert.equal(store.getState().completed, true);
});

test("unreadable or unrecognized completion data does not trap first launch", async () => {
  const { storage, values } = setup();
  values.set(ONBOARDING_STORAGE_KEY, "invalid");
  const invalid = createOnboardingStore(storage);
  await invalid.getState().hydrate();
  assert.equal(invalid.getState().completed, false);
  const unreadable = createOnboardingStore({
    ...storage,
    getItem: async () => {
      throw new Error("Read failed");
    },
  });
  await unreadable.getState().hydrate();
  assert.equal(unreadable.getState().status, "error");
  await unreadable.getState().complete();
  assert.equal(unreadable.getState().completed, true);
});
