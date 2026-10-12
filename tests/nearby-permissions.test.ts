import assert from "node:assert/strict";
import { test } from "node:test";
import { requestNearbyAccess } from "../src/lib/nearby-permissions";

test("onboarding resolves permission prompts before starting and stops discovery before finishing", async () => {
  const calls: string[] = [];
  let finishStart: () => void = () => {};
  const starting = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  let notifyStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const access = requestNearbyAccess({
    requestPermissions: async () => {
      calls.push("permissions");
    },
    transport: {
      available: true,
      start: async () => {
        calls.push("start");
        notifyStarted();
        await starting;
      },
      stop: async () => {
        calls.push("stop");
      },
    },
  });
  await started;
  assert.deepEqual(calls, ["permissions", "start"]);
  finishStart();
  await access;
  assert.deepEqual(calls, ["permissions", "start", "stop"]);
});

test("denied platform permissions do not start nearby discovery", async () => {
  let starts = 0;
  await assert.rejects(
    requestNearbyAccess({
      requestPermissions: async () => {
        throw new Error("Permission denied");
      },
      transport: {
        available: true,
        start: async () => {
          starts++;
        },
        stop: async () => {},
      },
    }),
    /Permission denied/,
  );
  assert.equal(starts, 0);
});

test("a failed native start is stopped and reported so onboarding can retry", async () => {
  let stops = 0;
  await assert.rejects(
    requestNearbyAccess({
      requestPermissions: async () => {},
      transport: {
        available: true,
        start: async () => {
          throw new Error("Bluetooth unavailable");
        },
        stop: async () => {
          stops++;
        },
      },
    }),
    /Bluetooth unavailable/,
  );
  assert.equal(stops, 1);
});

test("an unavailable native transport does not request unrelated permissions", async () => {
  const unexpected = async () => {
    throw new Error("Unexpected native request");
  };
  await assert.rejects(
    requestNearbyAccess({
      requestPermissions: unexpected,
      transport: { available: false, start: unexpected, stop: unexpected },
    }),
    /development build/,
  );
});

test("permission approval waits for the app to resume before native startup", async () => {
  const calls: string[] = [];
  let resume: () => void = () => {};
  const foreground = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const access = requestNearbyAccess({
    requestPermissions: async () => {
      calls.push("permissions");
    },
    waitUntilActive: () => foreground,
    transport: {
      available: true,
      start: async () => {
        calls.push("start");
      },
      stop: async () => {
        calls.push("stop");
      },
    },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["permissions"]);
  resume();
  await access;
  assert.deepEqual(calls, ["permissions", "start", "stop"]);
});

test("leaving the screen during an OS prompt cannot start discovery", async () => {
  const controller = new AbortController();
  let starts = 0;
  await assert.rejects(
    requestNearbyAccess({
      signal: controller.signal,
      requestPermissions: async () => {
        controller.abort();
      },
      transport: {
        available: true,
        start: async () => {
          starts++;
        },
        stop: async () => {},
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(starts, 0);
});

test("an interrupted native start is stopped before cancellation returns", async () => {
  const controller = new AbortController();
  let stopped = false;
  await assert.rejects(
    requestNearbyAccess({
      signal: controller.signal,
      requestPermissions: async () => {},
      transport: {
        available: true,
        start: async () => {
          controller.abort();
        },
        stop: async () => {
          stopped = true;
        },
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(stopped, true);
});

test("cleanup errors do not replace the permission/startup failure", async () => {
  await assert.rejects(
    requestNearbyAccess({
      requestPermissions: async () => {},
      transport: {
        available: true,
        start: async () => {
          throw new Error("Bluetooth off");
        },
        stop: async () => {
          throw new Error("Cleanup failed");
        },
      },
    }),
    /Bluetooth off/,
  );
});
