const { withInfoPlist, withAndroidManifest } = require("expo/config-plugins");

module.exports = function withBluetooth(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.NSBluetoothAlwaysUsageDescription =
      "PiperNet uses Bluetooth to discover phones and share photos and videos without internet.";
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest["uses-permission"] ?? [];
    for (const [name, maxSdk] of [
      ["BLUETOOTH", "30"],
      ["BLUETOOTH_ADMIN", "30"],
      ["ACCESS_COARSE_LOCATION", "30"],
      ["ACCESS_FINE_LOCATION", "30"],
      ["BLUETOOTH_ADVERTISE"],
      ["BLUETOOTH_CONNECT"],
      ["BLUETOOTH_SCAN"],
    ]) {
      const fullName = `android.permission.${name}`;
      const attributes = {
        "android:name": fullName,
        ...(maxSdk ? { "android:maxSdkVersion": maxSdk } : {}),
        ...(name === "BLUETOOTH_SCAN"
          ? { "android:usesPermissionFlags": "neverForLocation" }
          : {}),
      };
      const existing = permissions.find(
        (entry) => entry.$["android:name"] === fullName,
      );
      if (existing) existing.$ = attributes;
      else permissions.push({ $: attributes });
    }
    config.modResults.manifest["uses-permission"] = permissions;
    return config;
  });
};
