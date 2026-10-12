import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { beforeEach, mock, test } from "bun:test";

const cache = "file:///cache/";
const source = `${cache}capture.mov`;
const files = new Map();
const inspected = [];
const played = [];
let encodes = 0;
let inspectionKind = "video";
let failInspection = false;
let stampFailure = false;
let encodeFailure = false;
let photoSizes = [];
let photoPasses = 0;
const stamps = [];
const createdAt = 1_800_000_000_000;
const stampedVideo = `${cache}stamped.mp4`;

beforeEach(() => {
  files.clear();
  inspected.length = 0;
  played.length = 0;
  stamps.length = 0;
  encodes = 0;
  photoPasses = 0;
  inspectionKind = "video";
  failInspection = false;
  stampFailure = false;
  encodeFailure = false;
  photoSizes = [40_000];
});

class AsyncFile {
  constructor(...parts) {
    this.uri = parts
      .map((part) => (part.uri ?? part).replace(/\/+$/, ""))
      .join("/");
  }
  get size() {
    return files.get(this.uri) ?? 0;
  }
  get exists() {
    return files.has(this.uri);
  }
  get extension() {
    return /\.[^.\/]+$/.exec(this.uri)?.[0] ?? "";
  }
  async move(destination) {
    const bytes = this.size;
    files.delete(this.uri);
    files.set(destination.uri, bytes);
    // Reproduce the native race: the old path disappears before JS receives
    // completion and the File object's updated URI (SDK 57).
    await new Promise((resolve) => setImmediate(resolve));
    this.uri = destination.uri;
  }
  delete() {
    files.delete(this.uri);
  }
}

mock.module("expo-file-system", () => ({
  File: AsyncFile,
  Directory: class {},
  Paths: { cache: { uri: cache }, document: { uri: "file:///documents/" } },
}));
mock.module("expo-crypto", () => ({ randomUUID: () => `output-${encodes}` }));
mock.module("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: () => ({
      resize() {},
      renderAsync: async () => ({
        saveAsync: async ({ format }) => {
          assert.equal(format, "png", "stamp from a lossless resized image");
          const uri = `${cache}resized-${photoPasses}.png`;
          files.set(uri, 200_000);
          return { uri };
        },
        release() {},
      }),
      release() {},
    }),
  },
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
}));
mock.module("expo-video", () => ({
  createVideoPlayer: () => ({
    duration: 4,
    replaceAsync: async (uri) => {
      assert.ok(files.has(uri), "playback requires the relocated file");
      played.push(uri);
    },
    generateThumbnailsAsync: async () => [],
    release() {},
  }),
}));
mock.module("react-native-compressor", () => ({
  getVideoMetaData: async () => ({ duration: 4 }),
  Video: {
    compress: async (uri) => {
      assert.equal(uri, stampedVideo);
      if (encodeFailure) throw new Error("Encoder failed");
      const output = `file:///tmp/encoded-${++encodes}.mp4`;
      files.set(output, 180_000);
      return output;
    },
  },
}));
mock.module(
  fileURLToPath(new URL("../modules/media-stamp/index.ts", import.meta.url)),
  () => ({
    default: {
      stampVideo: async (uri, text) => {
        assert.equal(uri, source);
        stamps.push(text);
        if (stampFailure) throw new Error("Stamp failed");
        files.set(stampedVideo, 300_000);
        return stampedVideo;
      },
      stampPhoto: async (uri, text) => {
        assert.ok(files.has(uri));
        stamps.push(text);
        if (stampFailure) throw new Error("Stamp failed");
        const result = `${cache}photo-${photoPasses}.jpg`;
        files.set(result, photoSizes[photoPasses++] ?? 40_000);
        return result;
      },
    },
  }),
);
mock.module(
  fileURLToPath(
    new URL("../modules/nearby-transport/index.ts", import.meta.url),
  ),
  () => ({
    default: {
      inspectMedia: async (uri) => {
        assert.ok(files.has(uri), "inspection requires the relocated file");
        if (
          failInspection ||
          (inspectionKind === "video" &&
            !uri.endsWith(".mp4") &&
            !uri.endsWith(".mov"))
        )
          throw new Error(
            "UnexpectedException: Cannot Open (at ExpoModulesCore/Promise.swift:56)",
          );
        inspected.push(uri);
        return { kind: inspectionKind, bytes: files.get(uri), duration: 4 };
      },
    },
  }),
);

const { compressPhoto, prepareVideo, prepareReceivedMedia } =
  await import("../src/lib/media-files.ts");
const { formatCaptureStamp } = await import("../src/lib/capture-time.ts");

test("a four-second capture survives the SDK 57 asynchronous move and reaches playback", async () => {
  files.set(source, 240_000);
  const draft = await prepareVideo(source, createdAt);
  assert.deepEqual(draft, {
    uri: `${cache}piper-video-output-1.mp4`,
    kind: "video",
    bytes: 180_000,
    duration: 4,
    createdAt,
  });
  assert.equal(encodes, 1);
  assert.deepEqual(inspected, [draft.uri]);
  assert.deepEqual(played, [draft.uri]);
  assert.deepEqual([...files.entries()], [[draft.uri, 180_000]]);
  assert.deepEqual(stamps, [formatCaptureStamp(createdAt)]);
});

test("photo size limits apply after stamping and rejected passes leave no temporary files", async () => {
  const photoSource = `${cache}capture.jpg`;
  files.set(photoSource, 250_000);
  photoSizes = [110_000, 90_000];
  const draft = await compressPhoto(photoSource, 1920, 1080, createdAt);
  assert.deepEqual(draft, {
    uri: `${cache}photo-1.jpg`,
    kind: "photo",
    bytes: 90_000,
    createdAt,
  });
  assert.deepEqual(stamps, [
    formatCaptureStamp(createdAt),
    formatCaptureStamp(createdAt),
  ]);
  assert.deepEqual([...files.keys()], [photoSource, draft.uri]);
});

test("failed photo timestamping cleans up the lossless intermediate", async () => {
  stampFailure = true;
  await assert.rejects(
    compressPhoto(`${cache}capture.jpg`, 1920, 1080, createdAt),
    /Stamp failed/,
  );
  assert.equal(files.size, 0);
});

test("timestamp and compression failures preserve the recording and remove intermediates", async () => {
  files.set(source, 240_000);
  stampFailure = true;
  await assert.rejects(prepareVideo(source, createdAt), /Stamp failed/);
  assert.equal(encodes, 0);
  stampFailure = false;
  encodeFailure = true;
  await assert.rejects(prepareVideo(source, createdAt), /Encoder failed/);
  assert.deepEqual([...files.entries()], [[source, 240_000]]);
});

const receivedOffer = {
  id: "a".repeat(64),
  kind: "video",
  bytes: 180_000,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86_400_000,
  hops: 1,
};

test("received opaque video awaits relocation to MP4 before native inspection and playback", async () => {
  files.clear();
  inspectionKind = "video";
  const opaque = `${cache}piper-mesh/incoming.bin`;
  files.set(opaque, receivedOffer.bytes);
  const draft = await prepareReceivedMedia(opaque, receivedOffer);
  assert.ok(draft.uri.endsWith(".mp4"));
  assert.equal(draft.kind, "video");
  assert.equal(files.has(opaque), false);
  assert.deepEqual([...files.keys()], [draft.uri]);
  assert.equal(inspected.at(-1), draft.uri);
  assert.equal(played.at(-1), draft.uri);
  assert.equal(draft.createdAt, receivedOffer.createdAt);
  assert.equal(stamps.length, 0);
});

test("a video extension cannot bypass native validation; failed adoption is cleaned up with a useful error", async () => {
  files.clear();
  failInspection = true;
  const opaque = `${cache}piper-mesh/invalid.bin`;
  files.set(opaque, receivedOffer.bytes);
  await assert.rejects(prepareReceivedMedia(opaque, receivedOffer), (error) => {
    assert.match(error.message, /Couldn’t prepare incoming media/);
    assert.doesNotMatch(error.message, /Promise.swift/);
    assert.match(error.cause.message, /Cannot Open/);
    return true;
  });
  assert.equal(files.size, 0);
  failInspection = false;
});

test("opaque received photos remain at their original path for header validation", async () => {
  files.clear();
  inspectionKind = "photo";
  const opaque = `${cache}piper-mesh/photo.bin`;
  files.set(opaque, 1000);
  const draft = await prepareReceivedMedia(opaque, {
    ...receivedOffer,
    kind: "photo",
    bytes: 1000,
  });
  assert.equal(draft.uri, opaque);
  assert.equal(draft.kind, "photo");
  assert.equal(draft.createdAt, receivedOffer.createdAt);
  assert.deepEqual([...files.keys()], [opaque]);
});
