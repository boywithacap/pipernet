import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForForeground } from "../src/lib/app-foreground";

test("foreground waits clean up their listener after the permission activity closes", async () => {
  let active = false;
  let notify = () => {};
  let removed = 0;
  const waiting = waitForForeground({
    isActive: () => active,
    subscribe: (listener) => {
      notify = listener;
      return () => {
        removed++;
      };
    },
  });
  active = true;
  notify();
  await waiting;
  assert.equal(removed, 1);
});

test("a resume during subscription is not missed or leaked", async () => {
  let active = false;
  let removed = 0;
  await waitForForeground({
    isActive: () => active,
    subscribe: (listener) => {
      active = true;
      listener();
      return () => {
        removed++;
      };
    },
  });
  assert.equal(removed, 1);
});

test("cancelling while waiting cleans up and prevents later startup", async () => {
  const controller = new AbortController();
  let removed = 0;
  const waiting = waitForForeground({
    isActive: () => false,
    subscribe: () => () => {
      removed++;
    },
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(removed, 1);
});

test("a missing resume times out so the onboarding spinner cannot remain stuck", async () => {
  let removed = 0;
  await assert.rejects(
    waitForForeground({
      isActive: () => false,
      subscribe: () => () => {
        removed++;
      },
      timeoutMs: 1,
    }),
    /Return to PiperNet/,
  );
  assert.equal(removed, 1);
});
