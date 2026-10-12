import { PermissionsAndroid, Platform } from "react-native";
import {
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
import native from "../../../modules/nearby-transport";
import type { MeshTransport } from "../../types/mesh";
import { checkAndroidNearbyPermissions } from "../android-nearby-permissions";
import { PermissionDeniedError } from "../permission-errors";
import { waitForForeground } from "../app-foreground";
import { isAppActive, subscribeAppActive } from "../app-state";

async function checkNearbyPermissions(request: boolean) {
  requireTransport();
  if (Platform.OS === "ios") {
    // Nearby uses authorization to join a local hotspot, never to record coordinates.
    let permission = await getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && request)
      permission = await requestForegroundPermissionsAsync();
    if (!permission.granted)
      throw new PermissionDeniedError(
        permission.canAskAgain
          ? "Allow location access for nearby Wi-Fi to continue. PiperNet never collects your location."
          : "Allow location access in device settings, then return to PiperNet.",
        permission.canAskAgain,
      );
  } else if (Platform.OS === "android") {
    await checkAndroidNearbyPermissions({
      version: Number(Platform.Version),
      check: (permission) => PermissionsAndroid.check(permission),
      request: request
        ? (permissions) => PermissionsAndroid.requestMultiple(permissions)
        : undefined,
    });
  }
}

let permissionRequest: Promise<void> | undefined;
export function requestNearbyPermissions() {
  if (!permissionRequest)
    permissionRequest = checkNearbyPermissions(true).finally(() => {
      permissionRequest = undefined;
    });
  return permissionRequest;
}

function requireTransport() {
  if (!native)
    throw new Error("Offline sharing needs a PiperNet development build.");
  return native;
}

export const nearbyTransport: MeshTransport = {
  available: native !== null,
  start: async (name) => {
    // Resume never opens an OS prompt. Revoked access becomes a recoverable Settings error.
    await checkNearbyPermissions(false);
    await waitForForeground({
      isActive: isAppActive,
      subscribe: subscribeAppActive,
    });
    await requireTransport().start(name);
  },
  stop: () => native?.stop() ?? Promise.resolve(),
  connect: (peerId) => requireTransport().connect(peerId),
  verify: (peerId, accept) => requireTransport().verify(peerId, accept),
  disconnect: (peerId) => requireTransport().disconnect(peerId),
  sendControl: (peerId, text) => requireTransport().sendControl(peerId, text),
  expectFile: (peerId, bytes) => requireTransport().expectFile(peerId, bytes),
  sendFile: (peerId, uri) => requireTransport().sendFile(peerId, uri),
  cancelFile: (peerId) => requireTransport().cancelFile(peerId),
  subscribe: (callback) => {
    const subscription = native?.addListener("onEvent", callback);
    return () => subscription?.remove();
  },
};
