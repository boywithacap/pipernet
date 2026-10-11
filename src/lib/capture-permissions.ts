type Permission = { granted: boolean; canAskAgain: boolean };
type Request = () => Promise<Permission>;

export async function requestCaptureAccess({
  camera,
  microphone,
  requestCamera,
  requestMicrophone,
}: {
  camera: Permission | null;
  microphone: Permission | null;
  requestCamera: Request;
  requestMicrophone: Request;
}) {
  const cameraAccess =
    camera?.granted || camera?.canAskAgain === false
      ? camera
      : await requestCamera();
  // Ask for sound only after the camera is available. A denied microphone
  // still allows silent video; permanently denied access is handled in Settings.
  const microphoneAccess =
    cameraAccess?.granted &&
    !microphone?.granted &&
    microphone?.canAskAgain !== false
      ? await requestMicrophone()
      : microphone;
  return { camera: cameraAccess, microphone: microphoneAccess };
}
