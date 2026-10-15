import { useCallback, useEffect } from "react";
import { BackHandler, Linking, View } from "react-native";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { router, Stack, useFocusEffect, useIsFocused } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppActive } from "@/hooks/use-app-active";
import { usePermissionAction } from "@/hooks/use-permission-action";
import { requestCaptureAccess } from "@/lib/capture-permissions";
import { waitForForeground } from "@/lib/app-foreground";
import { isAppActive, subscribeAppActive } from "@/lib/app-state";
import {
  checkPermissionTask,
  PermissionDeniedError,
  permissionErrorMessage,
} from "@/lib/permission-errors";

export default function PermissionsScreen() {
  const [cameraPermission, requestCameraPermission, refreshCamera] =
    useCameraPermissions();
  const [, requestMicrophonePermission, refreshMicrophone] =
    useMicrophonePermissions();
  const { busy, error, run, cancel } = usePermissionAction();
  const active = useAppActive();
  const focused = useIsFocused();
  const blocked =
    cameraPermission?.canAskAgain === false && !cameraPermission.granted;
  const action = blocked
    ? "Open device settings"
    : cameraPermission?.granted
      ? "Continue"
      : "Allow access";

  useEffect(() => {
    if (active && focused && !busy) {
      void refreshCamera().catch(() => undefined);
      void refreshMicrophone().catch(() => undefined);
    }
  }, [active, focused, busy, refreshCamera, refreshMicrophone]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => busy,
      );
      return () => {
        subscription.remove();
      };
    }, [busy]),
  );
  useFocusEffect(useCallback(() => cancel, [cancel]));

  function finish() {
    return run(async (signal) => {
      const [camera, microphone] = await Promise.all([
        refreshCamera(),
        refreshMicrophone(),
      ]);
      checkPermissionTask(signal);
      if (!camera.granted && !camera.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      const access = await requestCaptureAccess({
        camera,
        microphone,
        requestCamera: requestCameraPermission,
        requestMicrophone: requestMicrophonePermission,
        signal,
        waitUntilActive: () =>
          waitForForeground({
            isActive: isAppActive,
            subscribe: subscribeAppActive,
            signal,
          }),
      });
      checkPermissionTask(signal);
      if (!access.camera?.granted)
        throw new PermissionDeniedError(
          "Camera access is required to capture. Allow access to continue.",
          access.camera?.canAskAgain ?? true,
        );
      router.navigate("/onboarding/bluetooth-permissions");
    });
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <OnboardingFrame
        footer={
          <View className="gap-3">
            {error ? (
              <Text
                accessibilityRole="alert"
                className="text-center text-sm leading-5 text-destructive"
              >
                {permissionErrorMessage(error)}
              </Text>
            ) : null}
            <Button
              size="lg"
              containerClassName="w-full"
              loading={busy}
              accessibilityLabel={action}
              onPress={() => void finish()}
            >
              {action}
            </Button>
          </View>
        }
      >
        <StateIllustration kind="permissions" variant="onboarding" />
        <OnboardingCopy>
          <Text
            accessibilityRole="header"
            className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
          >
            Camera & microphone
          </Text>
          <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
            Camera access is for photos and videos. Microphone access is for
            video sound. Without microphone access, videos are silent.
          </Text>
        </OnboardingCopy>
      </OnboardingFrame>
    </>
  );
}
