import assert from "node:assert/strict";
import { test } from "node:test";
import {
  androidBluetoothPermissions,
  checkAndroidBluetoothPermissions,
} from "../src/lib/android-bluetooth-permissions";
import { PermissionDeniedError } from "../src/lib/permission-errors";

test("modern Android requests only Bluetooth permissions, without Wi-Fi, storage or location", () => {
  for (const api of [31, 32, 33, 35, 36]) {
    assert.deepEqual(androidBluetoothPermissions(api), [
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
    ]);
  }
});

test("legacy Android requests only its required Bluetooth discovery location access", () => {
  for (const api of [29, 30]) {
    assert.deepEqual(androidBluetoothPermissions(api), [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ]);
  }
  assert.deepEqual(androidBluetoothPermissions(28), [
    "android.permission.ACCESS_COARSE_LOCATION",
  ]);
});

test("already granted Bluetooth permissions do not open a second prompt", async () => {
  await checkAndroidBluetoothPermissions({
    version: 35,
    check: async () => true,
    request: async () => {
      throw new Error("Unexpected prompt");
    },
  });
});

test("an approximate-to-precise upgrade includes coarse permission even when it is granted", async () => {
  await checkAndroidBluetoothPermissions({
    version: 30,
    check: async (permission) =>
      permission !== "android.permission.ACCESS_FINE_LOCATION",
    request: async (permissions) => {
      assert.deepEqual(permissions, [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
      ]);
      return Object.fromEntries(
        permissions.map((permission) => [permission, "granted"]),
      );
    },
  });
});

test("denial, permanent denial, and approximate-only access return useful recovery errors", async () => {
  for (const status of ["denied", "never_ask_again"]) {
    await assert.rejects(
      checkAndroidBluetoothPermissions({
        version: 35,
        check: async () => false,
        request: async (permissions) =>
          Object.fromEntries(
            permissions.map((permission) => [permission, status]),
          ),
      }),
      (error: unknown) =>
        error instanceof PermissionDeniedError &&
        error.canAskAgain === (status === "denied"),
    );
  }
  await assert.rejects(
    checkAndroidBluetoothPermissions({
      version: 30,
      check: async () => false,
      request: async (permissions) =>
        Object.fromEntries(
          permissions.map((permission) => [
            permission,
            permission === "android.permission.ACCESS_FINE_LOCATION"
              ? "denied"
              : "granted",
          ]),
        ),
    }),
    /precise location/,
  );
});

test("revoked permissions are detected without prompting during background resume", async () => {
  await assert.rejects(
    checkAndroidBluetoothPermissions({ version: 35, check: async () => false }),
    /device settings/,
  );
});

test("an interrupted native permission request propagates safely for an explicit retry", async () => {
  await assert.rejects(
    checkAndroidBluetoothPermissions({
      version: 35,
      check: async () => false,
      request: async () => {
        throw new Error("Activity unavailable");
      },
    }),
    /Activity unavailable/,
  );
});
