import { useCallback } from "react";
import { BackHandler, Linking, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useOnboarding } from "@/hooks/use-onboarding";
import { meshCoordinator } from "@/hooks/use-mesh";
import { usePermissionAction } from "@/hooks/use-permission-action";
import { waitForForeground } from "@/lib/app-foreground";
import { isAppActive, subscribeAppActive } from "@/lib/app-state";
import {
  sharingTransport,
  requestSharingPermissions,
} from "@/lib/mesh/transport";
import { finishNearbyOnboarding } from "@/lib/nearby-onboarding";
import { requestNearbyAccess } from "@/lib/nearby-permissions";
import { permissionErrorMessage } from "@/lib/permission-errors";

export default function NearbyPermissionsScreen() {
  const complete = useOnboarding((state) => state.complete);
  const { busy, error, run, cancel } = usePermissionAction();
  const action = error ? "Try again" : "Enable sharing";

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
      const { enabled, relay, transport } = meshCoordinator.getSnapshot();
      await finishNearbyOnboarding({
        signal,
        previous: { enabled, relay },
        configure: (options) => meshCoordinator.configure(options),
        complete,
        requestAccess: () =>
          requestNearbyAccess({
            transport: sharingTransport,
            requestPermissions: () => requestSharingPermissions(transport),
            signal,
            waitUntilActive: () =>
              waitForForeground({
                isActive: isAppActive,
                subscribe: subscribeAppActive,
                signal,
              }),
          }),
      });
    });
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <OnboardingFrame
        footer={
          <View className="gap-2">
            {error ? (
              <Text
                accessibilityRole="alert"
                className="mb-2 text-center text-sm leading-5 text-destructive"
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
            {error ? (
              <Button
                variant="plain"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await Linking.openSettings();
                  })
                }
              >
                Device settings
              </Button>
            ) : null}
          </View>
        }
      >
        <StateIllustration kind="nearby" variant="onboarding" />
        <OnboardingCopy>
          <Text
            accessibilityRole="header"
            className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
          >
            Bluetooth sharing
          </Text>
          <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
            Allow Bluetooth access to discover phones automatically, share your
            captures, and relay received media. Wi-Fi is optional.
          </Text>
          <Text className="max-w-[330px] text-center text-sm leading-5 text-muted-foreground">
            Keep PiperNet open on participating phones. They can view and keep
            shared media. Older Android versions also need location access for
            Bluetooth discovery; PiperNet never collects your location.
          </Text>
        </OnboardingCopy>
      </OnboardingFrame>
    </>
  );
}
