import {
  Asset,
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-media-library";
import { Platform } from "react-native";

export class PhotoLibraryPermissionError extends Error {
  constructor(public readonly canAskAgain: boolean) {
    super("Allow PiperNet to save photos and videos in your phone’s settings.");
    this.name = "PhotoLibraryPermissionError";
  }
}

/** Copy a complete local moment into the system library, without reading its contents. */
export async function saveToPhotoLibrary(uri: string) {
  // SDK 57 uses MediaStore on Android 11+, so saving our own files needs no
  // library access. Its Android 10-and-earlier implementation needs write access.
  if (Platform.OS !== "android" || Number(Platform.Version) < 30) {
    let permission = await getPermissionsAsync(true, []);
    if (!permission.granted && permission.canAskAgain) {
      permission = await requestPermissionsAsync(true, []);
    }
    if (!permission.granted) {
      throw new PhotoLibraryPermissionError(permission.canAskAgain);
    }
  }
  // Asset.create copies the JPEG/video itself; it never moves the PiperNet file.
  await Asset.create(uri);
}
