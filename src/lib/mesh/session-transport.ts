import type { MeshTransport, TransportEvent } from "../../types/mesh";

/** Ignore callbacks from stopped or failed Bluetooth sessions. */
export function createSessionTransport(adapter: MeshTransport): MeshTransport {
  let generation = 0;
  const listeners = new Set<(event: TransportEvent) => void>();
  let unsubscribe: (() => void) | undefined;
  return {
    get available() {
      return adapter.available;
    },
    async start(name) {
      const token = ++generation;
      unsubscribe?.();
      unsubscribe = adapter.subscribe((event) => {
        if (token === generation)
          listeners.forEach((callback) => callback(event));
      });
      try {
        await adapter.start(name);
      } catch (error) {
        if (token === generation) {
          generation++;
          unsubscribe?.();
          unsubscribe = undefined;
        }
        throw error;
      }
    },
    async stop() {
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      await adapter.stop();
    },
    connect: (peer) => adapter.connect(peer),
    verify: (peer, accept) => adapter.verify(peer, accept),
    disconnect: (peer) => adapter.disconnect(peer),
    sendControl: (peer, text) => adapter.sendControl(peer, text),
    expectFile: (peer, bytes, hash) => adapter.expectFile(peer, bytes, hash),
    sendFile: (peer, uri, hash) => adapter.sendFile(peer, uri, hash),
    cancelFile: (peer) => adapter.cancelFile(peer),
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
