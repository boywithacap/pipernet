import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

function cliJson(entry, args) {
  return JSON.parse(
    execFileSync("node", [require.resolve(entry), ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, CI: "1" },
    }),
  );
}

test("native configuration supports BLE without Nearby Wi-Fi or hotspot access", () => {
  const config = cliJson("expo/bin/cli", [
    "config",
    "--type",
    "introspect",
    "--json",
  ]);
  const { ios, android } = config._internal.modResults;
  assert.match(ios.infoPlist.NSBluetoothAlwaysUsageDescription, /Bluetooth/);
  assert.equal(ios.infoPlist.NSLocationWhenInUseUsageDescription, undefined);
  assert.equal(
    ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
    undefined,
  );
  assert.equal(
    ios.entitlements["com.apple.developer.networking.HotspotConfiguration"],
    undefined,
  );
  assert.equal(
    ios.entitlements["com.apple.developer.networking.wifi-info"],
    undefined,
  );
  // Expo's development launcher owns this entry and strips it from Release builds.
  assert.deepEqual(ios.infoPlist.NSBonjourServices ?? [], ["_expo._tcp"]);
  assert.match(
    ios.infoPlist.NSLocalNetworkUsageDescription,
    /Expo Dev Launcher/,
  );
  assert.ok(ios.infoPlist.NSPhotoLibraryAddUsageDescription);
  assert.equal(ios.infoPlist.NSPhotoLibraryUsageDescription, undefined);

  const permissions = Object.fromEntries(
    android.manifest.manifest["uses-permission"].map(({ $: entry }) => [
      entry["android:name"].replace("android.permission.", ""),
      entry,
    ]),
  );
  for (const name of [
    "BLUETOOTH_SCAN",
    "BLUETOOTH_CONNECT",
    "BLUETOOTH_ADVERTISE",
  ])
    assert.ok(permissions[name]);
  assert.equal(
    permissions.BLUETOOTH_SCAN["android:usesPermissionFlags"],
    "neverForLocation",
  );
  for (const name of [
    "BLUETOOTH",
    "BLUETOOTH_ADMIN",
    "ACCESS_COARSE_LOCATION",
    "ACCESS_FINE_LOCATION",
  ])
    assert.equal(permissions[name]["android:maxSdkVersion"], "30");
  for (const name of [
    "NEARBY_WIFI_DEVICES",
    "ACCESS_WIFI_STATE",
    "CHANGE_WIFI_STATE",
    "ACCESS_BACKGROUND_LOCATION",
  ])
    assert.equal(permissions[name], undefined);
  assert.equal(permissions.READ_EXTERNAL_STORAGE["tools:node"], "remove");
});

for (const platform of ["apple", "android"]) {
  test(`${platform} autolinks independent BLE and media modules without Nearby or location`, () => {
    const { modules } = cliJson(
      "expo-modules-autolinking/bin/expo-modules-autolinking",
      ["resolve", "--platform", platform, "--json"],
    );
    const names = modules.map((module) => module.packageName);
    for (const name of [
      "ble-transport",
      "media-inspector",
      "media-stamp",
      "expo-media-library",
    ])
      assert.ok(
        names.includes(name),
        `${name} must remain linked on ${platform}`,
      );
    for (const name of ["nearby-transport", "expo-location"])
      assert.ok(!names.includes(name), `${name} must not ship on ${platform}`);
  });
}
