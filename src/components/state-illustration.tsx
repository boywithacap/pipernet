import { Image, useWindowDimensions } from "react-native";
import { ILLUSTRATIONS } from "@/constants/illustrations";
import type { StateIllustrationProps } from "@/types/illustration";

export function StateIllustration({
  kind,
  variant = "state",
}: StateIllustrationProps) {
  const { width, height, fontScale } = useWindowDimensions();
  const edge =
    variant === "onboarding"
      ? Math.min(330, width * 0.8, height * 0.36)
      : Math.min(200, width * 0.5, height * 0.25);
  const size = edge / Math.max(1, fontScale / 1.3);

  return (
    <Image
      source={ILLUSTRATIONS[kind]}
      className="shrink-0"
      resizeMode="contain"
      style={{ width: size, height: size }}
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
}
