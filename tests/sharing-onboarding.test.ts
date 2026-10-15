import assert from "node:assert/strict";
import { test } from "node:test";
import { finishSharingOnboarding } from "../src/lib/sharing-onboarding";

test("onboarding enables both sharing options only after access, before marking completion", async () => {
  const calls: unknown[] = [];
  await finishSharingOnboarding({
    requestAccess: async () => {
      calls.push("access");
    },
    configure: async (options) => {
      calls.push(options);
    },
    previous: { enabled: false, relay: false },
    complete: async () => {
      calls.push("complete");
    },
  });
  assert.deepEqual(calls, [
    "access",
    { enabled: true, relay: true },
    "complete",
  ]);
});

test("denied access cannot enable sharing or bypass onboarding", async () => {
  const unexpected = async () => {
    throw new Error("Must not run");
  };
  await assert.rejects(
    finishSharingOnboarding({
      requestAccess: async () => {
        throw new Error("Access denied");
      },
      configure: unexpected,
      complete: unexpected,
      previous: { enabled: false, relay: false },
    }),
    /Access denied/,
  );
});

test("failed onboarding persistence rolls back both settings and remains retryable", async () => {
  const options: unknown[] = [];
  await assert.rejects(
    finishSharingOnboarding({
      requestAccess: async () => {},
      configure: async (value) => {
        options.push(value);
      },
      previous: { enabled: false, relay: true },
      complete: async () => {
        throw new Error("Storage failed");
      },
    }),
    /Storage failed/,
  );
  assert.deepEqual(options, [
    { enabled: true, relay: true },
    { enabled: false, relay: true },
  ]);
});

test("cancellation while saving options rolls back instead of finishing a departed screen", async () => {
  const controller = new AbortController();
  const options: unknown[] = [];
  await assert.rejects(
    finishSharingOnboarding({
      signal: controller.signal,
      requestAccess: async () => {},
      configure: async (value) => {
        options.push(value);
        controller.abort();
      },
      previous: { enabled: false, relay: false },
      complete: async () => {
        throw new Error("Must not complete");
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(options, [
    { enabled: true, relay: true },
    { enabled: false, relay: false },
  ]);
});

test("failed settings persistence does not complete onboarding", async () => {
  await assert.rejects(
    finishSharingOnboarding({
      requestAccess: async () => {},
      configure: async () => {
        throw new Error("Settings failed");
      },
      previous: { enabled: false, relay: false },
      complete: async () => {
        throw new Error("Must not complete");
      },
    }),
    /Settings failed/,
  );
});
