import type { MediaDraft, MediaFiles } from "../src/types/media";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaStore, MEDIA_STORAGE_KEY } from "../src/stores/media-store";
import {
  assertMediaSize,
  fitPhoto,
  MEDIA_LIMITS,
} from "../src/lib/media-policy";

const photo: MediaDraft = {
  uri: "file:///cache/photo.jpg",
  kind: "photo",
  bytes: 40_000,
};

function setup() {
  const data = new Map<string, string>();
  const saved = new Set<string>();
  const storage = {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const files: MediaFiles = {
    save: async (id) => {
      const fileName = `${id}.jpg`;
      saved.add(fileName);
      return { fileName };
    },
    remove: async (item) => {
      saved.delete(item.fileName);
    },
  };
  return {
    data,
    saved,
    storage,
    files,
    store: createMediaStore(storage, files),
  };
}

test("queued captures survive restart and remain separate from received moments", async () => {
  const { store, storage, files } = setup();
  const queued = await store.getState().queue(photo);
  assert.equal(queued.direction, "outgoing");
  assert.equal(queued.read, true);
  const next = createMediaStore(storage, files);
  await next.getState().hydrate();
  assert.equal(next.getState().items[0].fileName, queued.fileName);
  const received = await next
    .getState()
    .receive("peer-message-1", "Nearby", photo);
  assert.equal(received.read, false);
  await next.getState().markRead(received.id);
  const third = createMediaStore(storage, files);
  await third.getState().hydrate();
  assert.equal(third.getState().items[0].read, true);
});

test("concurrent writes preserve every capture and received duplicates are idempotent", async () => {
  const { store, saved } = setup();
  await Promise.all([
    store.getState().queue(photo),
    store.getState().queue(photo),
    store.getState().receive("peer-1", "Nearby", photo),
  ]);
  await store.getState().receive("peer-1", "Nearby", photo);
  assert.equal(store.getState().items.length, 3);
  assert.equal(saved.size, 3);
});

test("capture time survives delayed queueing, receiving, and restart", async () => {
  const { store, storage, files } = setup();
  const createdAt = Date.now() - 60_000;
  const draft = { ...photo, createdAt };
  const queued = await store.getState().queue(draft);
  const received = await store
    .getState()
    .receive("dated-peer-1", "Nearby", draft);
  assert.equal(queued.createdAt, createdAt);
  assert.equal(received.createdAt, createdAt);
  const restarted = createMediaStore(storage, files);
  await restarted.getState().hydrate();
  assert.ok(
    restarted.getState().items.every((item) => item.createdAt === createdAt),
  );
});

test("invalid capture times fail before copying media", async () => {
  const { store, saved } = setup();
  for (const createdAt of [NaN, Infinity, 0, -1, 1.5, 8_640_000_000_000_001]) {
    await assert.rejects(
      store.getState().queue({ ...photo, createdAt }),
      /Invalid capture time/,
    );
  }
  assert.equal(saved.size, 0);
  assert.equal(store.getState().items.length, 0);
});

test("failed persistence rolls back copied files and a later retry succeeds", async () => {
  const { storage, files, saved } = setup();
  let fail = true;
  const store = createMediaStore(
    {
      ...storage,
      setItem: async (key, value) => {
        if (fail) throw new Error("Storage full");
        await storage.setItem(key, value);
      },
    },
    files,
  );
  await assert.rejects(store.getState().queue(photo));
  assert.equal(store.getState().items.length, 0);
  assert.equal(saved.size, 0);
  fail = false;
  await store.getState().queue(photo);
  assert.equal(store.getState().items.length, 1);
});

test("a failed deletion keeps media and metadata intact", async () => {
  const { storage, files, saved } = setup();
  let fail = false;
  const store = createMediaStore(
    {
      ...storage,
      setItem: async (key, value) => {
        if (fail) throw new Error("Unavailable");
        await storage.setItem(key, value);
      },
    },
    files,
  );
  const item = await store.getState().queue(photo);
  fail = true;
  await assert.rejects(store.getState().remove(item.id));
  assert.equal(store.getState().items.length, 1);
  assert.ok(saved.has(item.fileName));
  fail = false;
  await store.getState().remove(item.id);
  assert.equal(saved.size, 0);
  assert.equal(store.getState().items.length, 0);
});

test("corrupt or newer metadata is never overwritten by a new capture", async () => {
  for (const raw of [
    "broken",
    "null",
    '{"version":2,"items":[]}',
    '{"version":1,"items":[{"id":"../escape"}]}',
  ]) {
    const { data, store, saved } = setup();
    data.set(MEDIA_STORAGE_KEY, raw);
    await store.getState().hydrate();
    assert.equal(store.getState().status, "error");
    await assert.rejects(store.getState().queue(photo));
    assert.equal(data.get(MEDIA_STORAGE_KEY), raw);
    assert.equal(saved.size, 0);
  }
});

test("read failures can be retried and concurrent hydration shares one read", async () => {
  const { files } = setup();
  let fail = true;
  let reads = 0;
  const store = createMediaStore(
    {
      getItem: async () => {
        reads++;
        if (fail) throw new Error("Unavailable");
        return null;
      },
      setItem: async () => {},
    },
    files,
  );
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()]);
  assert.equal(reads, 1);
  assert.equal(store.getState().status, "error");
  fail = false;
  await store.getState().hydrate();
  assert.equal(store.getState().status, "ready");
});

test("media limits reject oversized or empty payloads and preserve photo aspect ratio", () => {
  assert.throws(() => assertMediaSize("photo", MEDIA_LIMITS.photoBytes + 1));
  assert.throws(() => assertMediaSize("video", MEDIA_LIMITS.videoBytes + 1));
  assert.throws(() => assertMediaSize("video", 0));
  assert.throws(() => assertMediaSize("photo", NaN));
  assert.deepEqual(fitPhoto(4000, 3000), { width: 640, height: 480 });
  assert.deepEqual(fitPhoto(3000, 4000), { width: 480, height: 640 });
  assert.deepEqual(fitPhoto(160, 120), { width: 160, height: 120 });
});

test("the video budget accommodates a full minute with audio and overhead", () => {
  assert.equal(MEDIA_LIMITS.videoSeconds, 60);
  const videoAndAudioBytes =
    ((MEDIA_LIMITS.videoBitrate + 128_000) * MEDIA_LIMITS.videoSeconds) / 8;
  assert.doesNotThrow(() => assertMediaSize("video", videoAndAudioBytes * 1.2));
});
