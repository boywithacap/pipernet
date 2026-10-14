import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { randomUUID } from "expo-crypto";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import native from "../../modules/nearby-transport";
import {
  deleteTemporaryFile,
  mediaUri,
  prepareReceivedMedia,
} from "@/lib/media-files";
import { MeshCoordinator } from "@/lib/mesh/coordinator";
import { sharingTransport } from "@/lib/mesh/transport";
import type { MeshSnapshot } from "@/types/mesh";
import { mediaStore } from "./use-media";
import { useAppActive } from "./use-app-active";
import { isAppActive } from "@/lib/app-state";

export const meshCoordinator = new MeshCoordinator({
  storage: AsyncStorage,
  transport: sharingTransport,
  uuid: randomUUID,
  media: {
    ready: async () => {
      await mediaStore.getState().hydrate();
      if (mediaStore.getState().status !== "ready")
        throw new Error("Couldn’t open the media library for sharing.");
    },
    items: () => mediaStore.getState().items,
    uri: mediaUri,
    hash: async (uri) => {
      if (!native)
        throw new Error("Offline sharing needs a development build.");
      return native.hashFile(uri);
    },
    validate: prepareReceivedMedia,
    receive: async (id, sender, draft) => {
      try {
        return await mediaStore.getState().receive(id, sender, draft);
      } finally {
        deleteTemporaryFile(draft.thumbnailUri);
      }
    },
    discard: deleteTemporaryFile,
  },
});
// Zustand holds observable snapshots; radio ownership stays with the coordinator.
const meshStore = createStore<MeshSnapshot>(() =>
  meshCoordinator.getSnapshot(),
);
meshCoordinator.subscribe((state) => meshStore.setState(state, true));

export function useMesh<T>(selector: (state: MeshSnapshot) => T) {
  return useStore(meshStore, selector);
}

export function useMeshRuntime(enabled: boolean) {
  const active = useAppActive();
  useEffect(() => {
    let disposed = false;
    void mediaStore
      .getState()
      .hydrate()
      .then(async () => {
        if (!disposed && mediaStore.getState().status === "ready")
          await meshCoordinator.setActive(enabled && active && isAppActive());
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      void meshCoordinator.setActive(false).catch(() => undefined);
    };
  }, [active, enabled]);
  useEffect(() => {
    if (!active || !enabled) return;
    // Snapshot changes are throttled by native progress; capture/file mutations wake scheduling.
    const unsubscribe = mediaStore.subscribe(() => {
      void meshCoordinator.tick().catch(() => undefined);
    });
    const timer = setInterval(() => {
      void meshCoordinator.tick().catch(() => undefined);
    }, 5000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [active, enabled]);
}
