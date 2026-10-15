import type { Permission } from "react-native";
import { PermissionDeniedError } from "./permission-errors";

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

export async function checkAndroidBluetoothPermissions({
  version,
  check,
  request,
}: {
  version: number;
  check: (permission: Permission) => Promise<boolean>;
  request?: (permissions: Permission[]) => Promise<Record<string, string>>;
}) {
  const permissions = androidBluetoothPermissions(version);
  const granted = await Promise.all(permissions.map(check));
  const missing = permissions.filter((_, index) => !granted[index]);
  if (!missing.length) return;
  if (!request)
    throw new PermissionDeniedError(
      "Allow Bluetooth access in device settings to resume sharing.",
      false,
    );

  // Keep legacy Android location requests together for discovery and permission upgrades.
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
        ? "Allow Bluetooth access in device settings, then return to PiperNet."
        : "Bluetooth access is required to share. Allow access to continue.",
    !blocked,
  );
}
