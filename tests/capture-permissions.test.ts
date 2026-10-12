import assert from "node:assert/strict";
import { test } from "node:test";
import { requestCaptureAccess } from "../src/lib/capture-permissions";

const allowed = { granted: true, canAskAgain: true };
const undecided = { granted: false, canAskAgain: true };
const blocked = { granted: false, canAskAgain: false };

test("onboarding asks for camera before microphone and waits for both responses", async () => {
  const calls: string[] = [];
  const result = await requestCaptureAccess({
    camera: undecided,
    microphone: undecided,
    requestCamera: async () => {
      calls.push("camera");
      return allowed;
    },
    requestMicrophone: async () => {
      calls.push("microphone");
      return allowed;
    },
  });
  assert.deepEqual(calls, ["camera", "microphone"]);
  assert.equal(result.camera?.granted, true);
  assert.equal(result.microphone?.granted, true);
});

test("a denied camera finishes the permission flow without an unnecessary audio prompt", async () => {
  let audioRequests = 0;
  const result = await requestCaptureAccess({
    camera: undecided,
    microphone: undecided,
    requestCamera: async () => blocked,
    requestMicrophone: async () => {
      audioRequests++;
      return allowed;
    },
  });
  assert.equal(result.camera?.granted, false);
  assert.equal(audioRequests, 0);
});

test("already granted or permanently denied permissions are never requested again", async () => {
  let requests = 0;
  const request = async () => {
    requests++;
    return allowed;
  };
  for (const camera of [allowed, blocked]) {
    for (const microphone of [allowed, blocked]) {
      await requestCaptureAccess({
        camera,
        microphone,
        requestCamera: request,
        requestMicrophone: request,
      });
    }
  }
  assert.equal(requests, 0);
});

test("microphone denial allows capture to continue silently", async () => {
  const result = await requestCaptureAccess({
    camera: allowed,
    microphone: undecided,
    requestCamera: async () => {
      throw new Error("Camera must not be prompted again");
    },
    requestMicrophone: async () => blocked,
  });
  assert.equal(result.camera?.granted, true);
  assert.equal(result.microphone?.granted, false);
});

test("a failed native request is reported so onboarding can retry", async () => {
  await assert.rejects(
    requestCaptureAccess({
      camera: null,
      microphone: null,
      requestCamera: async () => {
        throw new Error("Request failed");
      },
      requestMicrophone: async () => allowed,
    }),
    /Request failed/,
  );
});

test("a departed camera permission screen does not open a late microphone prompt", async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestCaptureAccess({
      signal: controller.signal,
      camera: undecided,
      microphone: undecided,
      requestCamera: async () => {
        controller.abort();
        return allowed;
      },
      requestMicrophone: async () => {
        throw new Error("Unexpected late prompt");
      },
    }),
    { name: "AbortError" },
  );
});
