import { createStore } from "zustand/vanilla";
import { APP } from "../constants/app";
import { assertMediaSize } from "../lib/media-policy";
import type { MediaDraft, MediaFiles, MediaItem } from "../types/media";

export const MEDIA_STORAGE_KEY = `${APP.storagePrefix}.media.v1`;

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

type MediaState = {
  status: "idle" | "loading" | "ready" | "error";
  items: MediaItem[];
  hydrate: () => Promise<void>;
  queue: (draft: MediaDraft) => Promise<MediaItem>;
  // The transport must verify and reassemble incoming media before calling this.
  receive: (
    id: string,
    sender: string,
    draft: MediaDraft,
  ) => Promise<MediaItem>;
  markRead: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const safeName = /^[a-zA-Z0-9_-]+\.(jpg|mp4|mov)$/;
const safeId = /^[a-zA-Z0-9_-]{1,100}$/;

function readItems(raw: string | null): MediaItem[] {
  if (raw === null) return [];
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.items)) {
    throw new Error("Unsupported media library.");
  }
  const ids = new Set<string>();
  for (const item of data.items) {
    if (
      !item ||
      !safeId.test(item.id) ||
      typeof item.id !== "string" ||
      ids.has(item.id) ||
      !["photo", "video"].includes(item.kind) ||
      typeof item.fileName !== "string" ||
      !safeName.test(item.fileName) ||
      (item.thumbnailName !== undefined &&
        (typeof item.thumbnailName !== "string" ||
          !safeName.test(item.thumbnailName))) ||
      !Number.isFinite(item.createdAt) ||
      item.createdAt <= 0 ||
      typeof item.read !== "boolean" ||
      !["received", "outgoing"].includes(item.direction) ||
      (item.sender !== undefined && typeof item.sender !== "string") ||
      (item.duration !== undefined &&
        (!Number.isFinite(item.duration) || item.duration < 0))
    ) {
      throw new Error("Invalid media library.");
    }
    assertMediaSize(item.kind, item.bytes);
    ids.add(item.id);
  }
  return data.items;
}

/** Persist each transaction before publishing it; serialize writes to avoid lost captures. */
export function createMediaStore(storage: Storage, files: MediaFiles) {
  let hydration: Promise<void> | undefined;
  let mutations = Promise.resolve();

  return createStore<MediaState>((set, get) => {
    const transaction = <T>(action: () => Promise<T>): Promise<T> => {
      const next = mutations.then(async () => {
        await get().hydrate();
        if (get().status !== "ready")
          throw new Error("Couldn’t open your library. Try again.");
        return action();
      });
      mutations = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    const commit = async (items: MediaItem[]) => {
      await storage.setItem(
        MEDIA_STORAGE_KEY,
        JSON.stringify({ version: 1, items }),
      );
      set({ items });
    };

    const add = (
      id: string,
      direction: MediaItem["direction"],
      draft: MediaDraft,
      sender?: string,
    ) =>
      transaction(async () => {
        if (!safeId.test(id)) throw new Error("Invalid media identifier.");
        const existing = get().items.find((item) => item.id === id);
        if (existing) return existing;
        assertMediaSize(draft.kind, draft.bytes);
        const saved = await files.save(id, draft);
        const item: MediaItem = {
          ...saved,
          id,
          kind: draft.kind,
          bytes: draft.bytes,
          duration: draft.duration,
          createdAt: Date.now(),
          direction,
          sender,
          read: direction === "outgoing",
        };
        try {
          await commit([item, ...get().items]);
        } catch {
          await files.remove(saved).catch(() => undefined);
          throw new Error("Couldn’t save. Try again.");
        }
        return item;
      });

    return {
      status: "idle",
      items: [],
      hydrate: () => {
        if (get().status === "ready") return Promise.resolve();
        if (hydration) return hydration;
        set({ status: "loading" });
        hydration = storage
          .getItem(MEDIA_STORAGE_KEY)
          .then((raw) => set({ items: readItems(raw), status: "ready" }))
          .catch(() => set({ status: "error" }))
          .finally(() => {
            hydration = undefined;
          });
        return hydration;
      },
      queue: (draft) =>
        add(
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
          "outgoing",
          draft,
        ),
      receive: (id, sender, draft) => add(id, "received", draft, sender),
      markRead: (id) =>
        transaction(async () => {
          if (!get().items.some((item) => item.id === id && !item.read)) return;
          await commit(
            get().items.map((item) =>
              item.id === id ? { ...item, read: true } : item,
            ),
          );
        }),
      remove: (id) =>
        transaction(async () => {
          const item = get().items.find((entry) => entry.id === id);
          if (!item) return;
          await commit(get().items.filter((entry) => entry.id !== id));
          await files.remove(item).catch(() => undefined);
        }),
    };
  });
}
