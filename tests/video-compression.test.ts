import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeVideoForMesh } from "../src/lib/video-compression";
import { MEDIA_LIMITS } from "../src/lib/media-policy";

test("adaptive video encoding checks actual bytes and retries from the original", async () => {
  const inputs: string[] = [],
    removed: string[] = [],
    bitrates: number[] = [];
  const result = await encodeVideoForMesh("original", 60, {
    encode: async (uri, pass) => {
      inputs.push(uri);
      bitrates.push(pass.bitrate);
      return `pass-${inputs.length}`;
    },
    adopt: (uri) => uri,
    size: (uri) =>
      uri === "pass-1" ? MEDIA_LIMITS.videoTargetBytes + 1 : 900_000,
    remove: (uri) => {
      removed.push(uri);
    },
  });
  assert.equal(result, "pass-2");
  assert.deepEqual(inputs, ["original", "original"]);
  assert.deepEqual(bitrates, [240_000, 160_000]);
  assert.deepEqual(removed, ["pass-1"]);
});

test("an uncompressible clip fails after bounded passes without deleting the original", async () => {
  const removed: string[] = [];
  let calls = 0;
  await assert.rejects(
    encodeVideoForMesh("original", 10, {
      encode: async () => `pass-${++calls}`,
      adopt: (uri) => uri,
      size: () => MEDIA_LIMITS.videoBytes + 1,
      remove: (uri) => {
        removed.push(uri);
      },
    }),
    /shorter clip/,
  );
  assert.equal(calls, 3);
  assert.equal(removed.length, 3);
  assert.ok(!removed.includes("original"));
});

test("invalid duration never reaches the encoder", async () => {
  let calls = 0;
  const io = {
    encode: async () => {
      calls++;
      return "output";
    },
    adopt: (uri: string) => uri,
    size: () => 0,
    remove: () => {},
  };
  for (const duration of [0, NaN, Infinity, 61])
    await assert.rejects(encodeVideoForMesh("original", duration, io));
  assert.equal(calls, 0);
});

test("file relocation finishes before size validation and retains the destination", async () => {
  let finishMove!: () => void;
  const moving = new Promise<void>((resolve) => {
    finishMove = resolve;
  });
  const reads: string[] = [],
    removed: string[] = [];
  const result = encodeVideoForMesh("original", 4, {
    encode: async () => "temporary-output",
    adopt: async () => {
      await moving;
      return "cache-output";
    },
    size: (uri) => {
      reads.push(uri);
      return uri === "cache-output" ? 180_000 : 0;
    },
    remove: (uri) => {
      removed.push(uri);
    },
  });
  await Promise.resolve();
  assert.deepEqual(reads, []);
  finishMove();
  assert.equal(await result, "cache-output");
  assert.deepEqual(reads, ["cache-output"]);
  assert.deepEqual(removed, []);
});

test("a failed asynchronous move propagates its error and preserves the recording", async () => {
  const removed: string[] = [];
  const failure = new Error("Device storage is full");
  await assert.rejects(
    encodeVideoForMesh("original", 4, {
      encode: async () => "temporary-output",
      adopt: async () => {
        throw failure;
      },
      size: () => {
        throw new Error("Must not read a failed move");
      },
      remove: (uri) => {
        removed.push(uri);
      },
    }),
    failure,
  );
  assert.deepEqual(removed, ["temporary-output"]);
});

test("empty or unreadable output reports a read failure instead of asking for a shorter clip", async () => {
  for (const bytes of [0, NaN, Infinity, -1, 1.5]) {
    const removed: string[] = [];
    let calls = 0;
    await assert.rejects(
      encodeVideoForMesh("original", 4, {
        encode: async () => `pass-${++calls}`,
        adopt: (uri) => uri,
        size: () => bytes,
        remove: (uri) => {
          removed.push(uri);
        },
      }),
      /read the compressed video/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(removed, ["pass-1"]);
  }
});
