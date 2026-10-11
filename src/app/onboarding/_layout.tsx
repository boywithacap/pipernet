import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { useTheme } from "@/hooks/use-theme";

export const unstable_settings = { initialRouteName: "index" };

export default function OnboardingLayout() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
        animation: reducedMotion ? "fade" : "slide_from_right",
      }}
    />
  );
}
