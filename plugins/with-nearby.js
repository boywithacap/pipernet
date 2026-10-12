const { createHash } = require("node:crypto");
const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  withPodfile,
} = require("expo/config-plugins");

const SERVICE_ID = "com.boywithacap.pipernet.mesh.v1";

module.exports = function withNearby(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.NSBluetoothAlwaysUsageDescription =
      "PiperNet uses Bluetooth to discover nearby phones and share media offline.";
    config.modResults.NSLocalNetworkUsageDescription =
      "PiperNet uses local Wi-Fi to transfer compressed media without internet.";
    config.modResults.NSLocationWhenInUseUsageDescription =
      "iOS requires location permission to join a nearby phone’s Wi-Fi hotspot. PiperNet does not collect your location.";
    const serviceType = `_${createHash("sha256").update(SERVICE_ID).digest("hex").slice(0, 12).toUpperCase()}._tcp`;
    config.modResults.NSBonjourServices = [
      ...new Set([...(config.modResults.NSBonjourServices ?? []), serviceType]),
    ];
    return config;
  });
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.networking.HotspotConfiguration"] =
      true;
    config.modResults["com.apple.developer.networking.wifi-info"] = true;
    return config;
  });
  config = withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest["uses-permission"] ?? [];
    for (const [name, maxSdk] of [
      ["ACCESS_WIFI_STATE"],
      ["CHANGE_WIFI_STATE"],
      ["BLUETOOTH", "30"],
      ["BLUETOOTH_ADMIN", "30"],
      ["ACCESS_COARSE_LOCATION", "32"],
      ["ACCESS_FINE_LOCATION", "32"],
      ["BLUETOOTH_ADVERTISE"],
      ["BLUETOOTH_CONNECT"],
      ["BLUETOOTH_SCAN"],
      ["NEARBY_WIFI_DEVICES"],
      ["READ_EXTERNAL_STORAGE", "32"],
    ]) {
      const fullName = `android.permission.${name}`;
      const entry = permissions.find(
        (permission) => permission.$["android:name"] === fullName,
      );
      const attributes = {
        "android:name": fullName,
        ...(maxSdk ? { "android:maxSdkVersion": maxSdk } : {}),
        ...(["BLUETOOTH_SCAN", "NEARBY_WIFI_DEVICES"].includes(name)
          ? { "android:usesPermissionFlags": "neverForLocation" }
          : {}),
      };
      if (entry) entry.$ = attributes;
      else permissions.push({ $: attributes });
    }
    config.modResults.manifest["uses-permission"] = permissions;
    return config;
  });
  return withPodfile(config, (config) => {
    const requireLine =
      "require_relative '../modules/nearby-transport/ios/install_nearby'";
    let contents = config.modResults.contents;
    if (!contents.includes(requireLine))
      contents = `${requireLine}\n${contents}`;
    if (!contents.includes("pipernet_install_nearby(installer)")) {
      const hook = /post_install do \|installer\|/;
      if (!hook.test(contents))
        throw new Error(
          "PiperNet needs a CocoaPods post_install hook for Nearby's Swift package.",
        );
      contents = contents.replace(
        hook,
        "$&\n    pipernet_install_nearby(installer)",
      );
    }
    config.modResults.contents = contents;
    return config;
  });
};

module.exports.SERVICE_ID = SERVICE_ID;
