import type { Permission } from "react-native";
import { PermissionDeniedError } from "./permission-errors";

export function androidNearbyPermissions(version: number): Permission[] {
  const permissions: Permission[] = [];
  if (version >= 31)
    permissions.push(
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
    );
  if (version >= 33) permissions.push("android.permission.NEARBY_WIFI_DEVICES");
  if (version <= 32) {
    permissions.push("android.permission.ACCESS_COARSE_LOCATION");
    if (version >= 29)
      permissions.push("android.permission.ACCESS_FINE_LOCATION");
    permissions.push("android.permission.READ_EXTERNAL_STORAGE");
  }
  return permissions;
}

export function androidBluetoothPermissions(version: number): Permission[] {
  if (version >= 31)
    return [
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
    ];
  return version >= 29
    ? [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ]
    : ["android.permission.ACCESS_COARSE_LOCATION"];
}

export async function checkAndroidNearbyPermissions({
  version,
  bluetoothOnly = false,
  check,
  request,
}: {
  version: number;
  bluetoothOnly?: boolean;
  check: (permission: Permission) => Promise<boolean>;
  request?: (permissions: Permission[]) => Promise<Record<string, string>>;
}) {
  const permissions = bluetoothOnly
    ? androidBluetoothPermissions(version)
    : androidNearbyPermissions(version);
  const granted = await Promise.all(permissions.map(check));
  const missing = permissions.filter((_, index) => !granted[index]);
  if (!missing.length) return;
  if (!request)
    throw new PermissionDeniedError(
      "Allow nearby access in device settings to resume sharing.",
      false,
    );

  // Android 12 ignores fine-only requests, including upgrades from approximate access.
  if (
    missing.includes("android.permission.ACCESS_FINE_LOCATION") &&
    !missing.includes("android.permission.ACCESS_COARSE_LOCATION")
  )
    missing.push("android.permission.ACCESS_COARSE_LOCATION");
  const results = await request(missing);
  const denied = missing.filter(
    (permission) => results[permission] !== "granted",
  );
  if (!denied.length) return;
  const blocked = denied.some(
    (permission) => results[permission] === "never_ask_again",
  );
  const precise =
    denied.includes("android.permission.ACCESS_FINE_LOCATION") &&
    results["android.permission.ACCESS_COARSE_LOCATION"] === "granted";
  throw new PermissionDeniedError(
    precise
      ? "This Android version needs precise location access to discover phones. PiperNet never collects your location."
      : blocked
        ? "Allow nearby access in device settings, then return to PiperNet."
        : "Nearby access is required to share. Allow access to continue.",
    !blocked,
  );
}
