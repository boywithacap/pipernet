import type {
  MeshTransport,
  MeshTransportMode,
  TransportEvent,
} from "../../types/mesh";

/** One active radio transport keeps admission and receipts owned by one coordinator. */
export function createSelectableTransport(
  adapters: Record<MeshTransportMode, MeshTransport>,
): MeshTransport {
  let mode: MeshTransportMode = "ble";
  let running = false;
  let generation = 0;
  const listeners = new Set<(event: TransportEvent) => void>();
  let unsubscribe: (() => void) | undefined;
  const current = () => adapters[mode];
  return {
    get available() {
      return current().available;
    },
    select(next) {
      if (running) throw new Error("Stop sharing before changing transports.");
      mode = next;
    },
    async start(name) {
      const adapter = current();
      const token = ++generation;
      unsubscribe?.();
      unsubscribe = adapter.subscribe((event) => {
        if (token === generation)
          listeners.forEach((callback) => callback(event));
      });
      running = true;
      try {
        await adapter.start(name);
      } catch (error) {
        if (token === generation) {
          running = false;
          generation++;
          unsubscribe?.();
          unsubscribe = undefined;
        }
        throw error;
      }
    },
    async stop() {
      generation++;
      running = false;
      unsubscribe?.();
      unsubscribe = undefined;
      await current().stop();
    },
    connect: (peer) => current().connect(peer),
    verify: (peer, accept) => current().verify(peer, accept),
    disconnect: (peer) => current().disconnect(peer),
    sendControl: (peer, text) => current().sendControl(peer, text),
    expectFile: (peer, bytes, hash) => current().expectFile(peer, bytes, hash),
    sendFile: (peer, uri, hash) => current().sendFile(peer, uri, hash),
    cancelFile: (peer) => current().cancelFile(peer),
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
