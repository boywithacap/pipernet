import { PermissionsAndroid, Platform } from "react-native";
import bleNative from "../../../modules/ble-transport";
import { createSessionTransport } from "./session-transport";
import type { MeshTransport } from "../../types/mesh";
import { checkAndroidBluetoothPermissions } from "../android-bluetooth-permissions";
import { waitForForeground } from "../app-foreground";
import { isAppActive, subscribeAppActive } from "../app-state";

async function checkBluetoothPermissions(request: boolean) {
  requireBluetooth();
  if (Platform.OS === "android") {
    await checkAndroidBluetoothPermissions({
      version: Number(Platform.Version),
      check: (permission) => PermissionsAndroid.check(permission),
      request: request
        ? (permissions) => PermissionsAndroid.requestMultiple(permissions)
        : undefined,
    });
  }
  // Core Bluetooth asks for iOS authorization when native startup creates its managers.
}
function requireBluetooth() {
  if (!bleNative)
    throw new Error(
      "Bluetooth sharing needs a new PiperNet build. Install the latest build and retry.",
    );
  return bleNative;
}
export const bluetoothTransport: MeshTransport = {
  available: bleNative !== null,
  start: async (name) => {
    await checkBluetoothPermissions(false);
    await waitForForeground({
      isActive: isAppActive,
      subscribe: subscribeAppActive,
    });
    await requireBluetooth().start(name);
  },
  stop: () => bleNative?.stop() ?? Promise.resolve(),
  connect: (peer) => requireBluetooth().connect(peer),
  verify: (peer, accept) => requireBluetooth().verify(peer, accept),
  disconnect: (peer) => requireBluetooth().disconnect(peer),
  sendControl: (peer, text) => requireBluetooth().sendControl(peer, text),
  expectFile: (peer, bytes, hash) =>
    requireBluetooth().expectFile(peer, bytes, hash),
  sendFile: (peer, uri, hash) => requireBluetooth().sendFile(peer, uri, hash),
  cancelFile: (peer) => requireBluetooth().cancelFile(peer),
  subscribe: (callback) => {
    const subscription = bleNative?.addListener("onEvent", callback);
    return () => subscription?.remove();
  },
};
export const sharingTransport = createSessionTransport(bluetoothTransport);

let permissionRequest: Promise<void> | undefined;
export function requestSharingPermissions() {
  if (!permissionRequest) {
    permissionRequest = checkBluetoothPermissions(true).finally(() => {
      permissionRequest = undefined;
    });
  }
  return permissionRequest;
}
