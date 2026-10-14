import assert from "node:assert/strict";
import { test } from "node:test";
import { createSelectableTransport } from "../src/lib/mesh/selectable-transport";
import {
  androidBluetoothPermissions,
  checkAndroidNearbyPermissions,
} from "../src/lib/android-nearby-permissions";
import type { MeshTransport, TransportEvent } from "../src/types/mesh";

function adapter() {
  let listener: ((event: TransportEvent) => void) | undefined;
  let lastListener: typeof listener;
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
      lastListener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    value,
    calls,
    emit: (e: TransportEvent) => listener?.(e),
    late: (e: TransportEvent) => lastListener?.(e),
  };
}
test("Bluetooth is the default and never starts Nearby; switching isolates late radio callbacks", async () => {
  const ble = adapter(),
    nearby = adapter();
  const transport = createSelectableTransport({
    ble: ble.value,
    nearby: nearby.value,
  });
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));
  await transport.start("PN1:test");
  assert.deepEqual(ble.calls, ["start"]);
  assert.deepEqual(nearby.calls, []);
  assert.throws(() => transport.select!("nearby"), /Stop sharing/);
  const event: TransportEvent = { type: "connected", peerId: "a" };
  ble.emit(event);
  await transport.expectFile("a", 123, "hash");
  await transport.sendFile("a", "file:///photo", "hash");
  assert.ok(ble.calls.includes("expect:a:123:hash"));
  assert.ok(ble.calls.includes("file:a:file:///photo:hash"));
  await transport.stop();
  transport.select!("nearby");
  await transport.start("PN1:test");
  ble.late(event);
  nearby.emit(event);
  assert.equal(events.length, 2);
  assert.deepEqual(nearby.calls, ["start"]);
});
test("a failed BLE start does not silently downgrade to Nearby or forward stale events", async () => {
  const ble = adapter(),
    nearby = adapter();
  ble.value.start = async () => {
    throw new Error("Bluetooth denied");
  };
  const transport = createSelectableTransport({
    ble: ble.value,
    nearby: nearby.value,
  });
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));
  await assert.rejects(transport.start("PN1:test"), /Bluetooth denied/);
  ble.late({ type: "connected", peerId: "late" });
  assert.equal(events.length, 0);
  assert.equal(nearby.calls.length, 0);
  await transport.stop();
  transport.select!("nearby");
  await transport.start("PN1:test");
  assert.deepEqual(nearby.calls, ["start"]);
});
test("BLE permissions never request Wi-Fi/storage and only legacy Android requires location", async () => {
  for (const version of [31, 32, 33, 35, 36]) {
    const permissions = androidBluetoothPermissions(version);
    assert.equal(permissions.length, 3);
    assert.ok(permissions.every((p) => p.includes("BLUETOOTH")));
    await checkAndroidNearbyPermissions({
      version,
      bluetoothOnly: true,
      check: async () => false,
      request: async (requested) => {
        assert.deepEqual(requested, permissions);
        return Object.fromEntries(requested.map((p) => [p, "granted"]));
      },
    });
  }
  assert.deepEqual(androidBluetoothPermissions(28), [
    "android.permission.ACCESS_COARSE_LOCATION",
  ]);
  assert.deepEqual(androidBluetoothPermissions(30), [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
  ]);
});
