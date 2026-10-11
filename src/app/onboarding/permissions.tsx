import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Stack, useFocusEffect } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { sonner } from "@/components/ui/sonner";
import { Text } from "@/components/ui/text";
import { useOnboarding } from "@/hooks/use-onboarding";
import { requestCaptureAccess } from "@/lib/capture-permissions";

export default function PermissionsScreen() {
  const complete = useOnboarding((state) => state.complete);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();
  const saving = useRef(false);
  const mounted = useRef(true);
  const [finishing, setFinishing] = useState(false);
  const needsCamera =
    !cameraPermission?.granted && cameraPermission?.canAskAgain !== false;
  const needsMicrophone =
    (cameraPermission?.granted || needsCamera) &&
    !microphonePermission?.granted &&
    microphonePermission?.canAskAgain !== false;
  const action =
    needsCamera || needsMicrophone ? "Allow access" : "Open camera";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => saving.current,
      );
      return () => subscription.remove();
    }, []),
  );

  async function finish() {
    if (saving.current) return;
    saving.current = true;
    setFinishing(true);
    let accessChecked = false;
    try {
      await requestCaptureAccess({
        camera: cameraPermission,
        microphone: microphonePermission,
        requestCamera: requestCameraPermission,
        requestMicrophone: requestMicrophonePermission,
      });
      accessChecked = true;
      // The protected root opens Record only after completion is persisted.
      await complete();
    } catch {
      if (mounted.current)
        sonner.error(
          accessChecked
            ? "Couldn’t save. Try again."
            : "Couldn’t request access. Try again.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setFinishing(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !finishing }} />
      <OnboardingFrame
        footer={
          <Button
            size="lg"
            containerClassName="w-full"
            loading={finishing}
            accessibilityLabel={action}
            onPress={() => void finish()}
          >
            {action}
          </Button>
        }
      >
        <StateIllustration kind="permissions" variant="onboarding" />
        <OnboardingCopy>
          <Text
            accessibilityRole="header"
            className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
          >
            Permissions
          </Text>
          <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
            {
              "Camera access is for photos and videos.\nMicrophone access is for video sound."
            }
          </Text>
        </OnboardingCopy>
      </OnboardingFrame>
    </>
  );
}
