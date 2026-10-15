import assert from "node:assert/strict";
import { beforeEach, mock, test } from "bun:test";

const platform = { OS: "ios", Version: 27 };
const calls = [];
let current = { granted: false, canAskAgain: true };
let requested = { granted: true, canAskAgain: true };
let failure;

mock.module("react-native", () => ({ Platform: platform }));
mock.module("expo-media-library", () => ({
  getPermissionsAsync: async (...args) => {
    calls.push(["get", ...args]);
    return current;
  },
  requestPermissionsAsync: async (...args) => {
    calls.push(["request", ...args]);
    return requested;
  },
  Asset: {
    create: async (uri) => {
      calls.push(["save", uri]);
      if (failure) throw failure;
      return { id: "saved-asset" };
    },
  },
}));

const { PhotoLibraryPermissionError, saveToPhotoLibrary } =
  await import("../src/lib/photo-library");

beforeEach(() => {
  platform.OS = "ios";
  platform.Version = 27;
  calls.length = 0;
  current = { granted: false, canAskAgain: true };
  requested = { granted: true, canAskAgain: true };
  failure = undefined;
});

test("iOS requests add-only permission before saving the original photo", async () => {
  await saveToPhotoLibrary("file:///moments/photo.jpg");
  assert.deepEqual(calls, [
    ["get", true, []],
    ["request", true, []],
    ["save", "file:///moments/photo.jpg"],
  ]);
});

test("an existing grant saves the video itself without another prompt", async () => {
  current = { granted: true, canAskAgain: true };
  await saveToPhotoLibrary("file:///moments/video.mp4");
  assert.deepEqual(calls, [
    ["get", true, []],
    ["save", "file:///moments/video.mp4"],
  ]);
});

test("denial never writes a file and permanent denial does not prompt again", async () => {
  requested = { granted: false, canAskAgain: true };
  await assert.rejects(
    saveToPhotoLibrary("file:///moments/photo.jpg"),
    (error) =>
      error instanceof PhotoLibraryPermissionError && error.canAskAgain,
  );
  assert.deepEqual(calls, [
    ["get", true, []],
    ["request", true, []],
  ]);

  calls.length = 0;
  current = { granted: false, canAskAgain: false };
  await assert.rejects(
    saveToPhotoLibrary("file:///moments/photo.jpg"),
    (error) =>
      error instanceof PhotoLibraryPermissionError && !error.canAskAgain,
  );
  assert.deepEqual(calls, [["get", true, []]]);
});

test("Android 11+ saves without media access; SDK 57's older path requests write-only access", async () => {
  platform.OS = "android";
  for (const version of [30, 32, 33, 36]) {
    platform.Version = version;
    calls.length = 0;
    await saveToPhotoLibrary("file:///moments/video.mp4");
    assert.deepEqual(calls, [["save", "file:///moments/video.mp4"]]);
  }
  for (const version of [28, 29]) {
    platform.Version = version;
    calls.length = 0;
    await saveToPhotoLibrary("file:///moments/photo.jpg");
    assert.deepEqual(calls, [
      ["get", true, []],
      ["request", true, []],
      ["save", "file:///moments/photo.jpg"],
    ]);
  }
});

test("a native save failure reaches the caller and a later attempt can succeed", async () => {
  current = { granted: true, canAskAgain: true };
  failure = new Error("Storage full");
  await assert.rejects(
    saveToPhotoLibrary("file:///moments/photo.jpg"),
    /Storage full/,
  );
  failure = undefined;
  await saveToPhotoLibrary("file:///moments/photo.jpg");
  assert.equal(calls.filter(([operation]) => operation === "save").length, 2);
});
