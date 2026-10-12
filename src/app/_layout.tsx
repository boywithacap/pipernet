import "@/global.css";

import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { LaunchSplash } from "@/components/launch-splash";
import { Sonner } from "@/components/ui/sonner";
import { useMedia } from "@/hooks/use-media";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useTheme } from "@/hooks/use-theme";
import { useMeshRuntime } from "@/hooks/use-mesh";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
const GestureRoot = withUniwind(GestureHandlerRootView);

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const hydrateMedia = useMedia((state) => state.hydrate);
  const hydrateOnboarding = useOnboarding((state) => state.hydrate);
  const onboardingStatus = useOnboarding((state) => state.status);
  const completed = useOnboarding((state) => state.completed);
  useMeshRuntime(completed);
  const [launchComplete, setLaunchComplete] = useState(false);
  const finishLaunch = useCallback(() => setLaunchComplete(true), []);
  const launchReady =
    onboardingStatus === "ready" || onboardingStatus === "error";
  useEffect(() => {
    void hydrateMedia();
    void hydrateOnboarding();
  }, [hydrateMedia, hydrateOnboarding]);

  if (!launchReady) return null;

  return (
    <GestureRoot className="flex-1 bg-background">
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <View
          className="flex-1"
          pointerEvents={launchComplete ? "auto" : "none"}
          accessibilityElementsHidden={!launchComplete}
          importantForAccessibility={
            launchComplete ? "auto" : "no-hide-descendants"
          }
        >
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.background },
              animation: reducedMotion ? "fade" : "default",
            }}
          >
            <Stack.Protected guard={!completed}>
              <Stack.Screen
                name="onboarding"
                options={{ gestureEnabled: false }}
              />
            </Stack.Protected>
            <Stack.Protected guard={completed}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="settings"
                options={{
                  presentation: "formSheet",
                  sheetAllowedDetents: [0.6, 1],
                  sheetGrabberVisible: true,
                  // iOS owns the floating sheet's top and bottom corner geometry.
                  sheetCornerRadius: Platform.OS === "ios" ? undefined : 28,
                  contentStyle: {
                    backgroundColor: theme.sheet,
                    overflow: "hidden",
                  },
                }}
              />
            </Stack.Protected>
          </Stack>
          <Sonner />
        </View>
        {!launchComplete ? <LaunchSplash onFinish={finishLaunch} /> : null}
      </SafeAreaProvider>
    </GestureRoot>
  );
}
