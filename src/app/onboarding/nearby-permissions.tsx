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
  nearbyTransport,
  requestNearbyPermissions,
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
      const { enabled, relay } = meshCoordinator.getSnapshot();
      await finishNearbyOnboarding({
        signal,
        previous: { enabled, relay },
        configure: (options) => meshCoordinator.configure(options),
        complete,
        requestAccess: () =>
          requestNearbyAccess({
            transport: nearbyTransport,
            requestPermissions: requestNearbyPermissions,
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
            Nearby access
          </Text>
          <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
            Allow nearby access to auto-share your captures and relay received
            media. Keep Bluetooth and Wi-Fi on.
          </Text>
          <Text className="max-w-[330px] text-center text-sm leading-5 text-muted-foreground">
            Nearby PiperNet phones connect automatically and can keep shared
            media. Location access is used for nearby Wi-Fi, never to collect
            your location.
          </Text>
        </OnboardingCopy>
      </OnboardingFrame>
    </>
  );
}
