import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionTransport } from "../src/lib/mesh/session-transport";
import type { MeshTransport, TransportEvent } from "../src/types/mesh";

function adapter() {
  let listener: ((event: TransportEvent) => void) | undefined;
  const subscriptions: ((event: TransportEvent) => void)[] = [];
  const calls: string[] = [];
  const value: MeshTransport = {
    available: true,
    start: async () => {
      calls.push("start");
    },
    stop: async () => {
      calls.push("stop");
    },
    connect: async () => {},
    verify: async () => {},
    disconnect: async () => {},
    sendControl: async () => {},
    expectFile: async (peer, bytes, hash) => {
      calls.push(`expect:${peer}:${bytes}:${hash}`);
    },
    sendFile: async (peer, uri, hash) => {
      calls.push(`file:${peer}:${uri}:${hash}`);
    },
    cancelFile: async () => {},
    subscribe: (callback) => {
      listener = callback;
      subscriptions.push(callback);
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    value,
    calls,
    emit: (e: TransportEvent) => listener?.(e),
    late: (e: TransportEvent) => subscriptions[0]?.(e),
  };
}
test("Bluetooth sessions forward file hashes and isolate stopped-session callbacks", async () => {
  const ble = adapter();
  const transport = createSessionTransport(ble.value);
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));
  await transport.start("PN1:test");
  assert.deepEqual(ble.calls, ["start"]);
  const event: TransportEvent = { type: "connected", peerId: "a" };
  ble.emit(event);
  await transport.expectFile("a", 123, "hash");
  await transport.sendFile("a", "file:///photo", "hash");
  assert.ok(ble.calls.includes("expect:a:123:hash"));
  assert.ok(ble.calls.includes("file:a:file:///photo:hash"));
  await transport.stop();
  ble.late(event);
  assert.equal(events.length, 1);
  await transport.start("PN1:test");
  ble.late(event);
  ble.emit(event);
  assert.equal(events.length, 2);
});

test("failed Bluetooth startup rejects late events and can retry cleanly", async () => {
  const ble = adapter();
  ble.value.start = async () => {
    throw new Error("Bluetooth denied");
  };
  const transport = createSessionTransport(ble.value);
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));
  await assert.rejects(transport.start("PN1:test"), /Bluetooth denied/);
  ble.late({ type: "connected", peerId: "late" });
  assert.equal(events.length, 0);
  await transport.stop();
  ble.value.start = async () => {};
  await transport.start("PN1:test");
  ble.late({ type: "connected", peerId: "late" });
  ble.emit({ type: "connected", peerId: "new" });
  assert.deepEqual(events, [{ type: "connected", peerId: "new" }]);
});
