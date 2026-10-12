import assert from "node:assert/strict";
import { test } from "node:test";
import {
  androidNearbyPermissions,
  checkAndroidNearbyPermissions,
} from "../src/lib/android-nearby-permissions";
import { PermissionDeniedError } from "../src/lib/permission-errors";

test("Android 15 requests nearby Bluetooth/Wi-Fi access without obsolete location/storage prompts", () => {
  assert.deepEqual(androidNearbyPermissions(35), [
    "android.permission.BLUETOOTH_ADVERTISE",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.NEARBY_WIFI_DEVICES",
  ]);
});

test("Android 12/12L pairs fine and coarse location; older OS versions avoid unknown nearby permissions", () => {
  for (const api of [31, 32]) {
    const permissions = androidNearbyPermissions(api);
    assert.ok(
      permissions.includes("android.permission.ACCESS_COARSE_LOCATION"),
    );
    assert.ok(permissions.includes("android.permission.ACCESS_FINE_LOCATION"));
    assert.ok(!permissions.includes("android.permission.NEARBY_WIFI_DEVICES"));
  }
  assert.deepEqual(androidNearbyPermissions(28), [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.READ_EXTERNAL_STORAGE",
  ]);
});

test("already granted nearby permissions do not open a second prompt", async () => {
  await checkAndroidNearbyPermissions({
    version: 35,
    check: async () => true,
    request: async () => {
      throw new Error("Unexpected prompt");
    },
  });
});

test("an approximate-to-precise upgrade includes coarse permission even when it is granted", async () => {
  await checkAndroidNearbyPermissions({
    version: 31,
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
      checkAndroidNearbyPermissions({
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
    checkAndroidNearbyPermissions({
      version: 31,
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
    checkAndroidNearbyPermissions({ version: 35, check: async () => false }),
    /device settings/,
  );
});

test("an interrupted native permission request propagates safely for an explicit retry", async () => {
  await assert.rejects(
    checkAndroidNearbyPermissions({
      version: 35,
      check: async () => false,
      request: async () => {
        throw new Error("Activity unavailable");
      },
    }),
    /Activity unavailable/,
  );
});
