import { checkPermissionTask } from "./permission-errors";

type Permission = { granted: boolean; canAskAgain: boolean };
type Request = () => Promise<Permission>;

export async function requestCaptureAccess({
  camera,
  microphone,
  requestCamera,
  requestMicrophone,
  signal,
  waitUntilActive,
}: {
  camera: Permission | null;
  microphone: Permission | null;
  requestCamera: Request;
  requestMicrophone: Request;
  signal?: AbortSignal;
  waitUntilActive?: () => Promise<void>;
}) {
  checkPermissionTask(signal);
  await waitUntilActive?.();
  checkPermissionTask(signal);
  const cameraAccess =
    camera?.granted || camera?.canAskAgain === false
      ? camera
      : await requestCamera();
  checkPermissionTask(signal);
  await waitUntilActive?.();
  checkPermissionTask(signal);
  // Ask for sound only after the camera is available. A denied microphone
  // still allows silent video; permanently denied access is handled in Settings.
  const microphoneAccess =
    cameraAccess?.granted &&
    !microphone?.granted &&
    microphone?.canAskAgain !== false
      ? await requestMicrophone()
      : microphone;
  checkPermissionTask(signal);
  await waitUntilActive?.();
  checkPermissionTask(signal);
  return { camera: cameraAccess, microphone: microphoneAccess };
}
