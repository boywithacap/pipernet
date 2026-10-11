import type { ImageSourcePropType } from "react-native";

export type IllustrationKind = "nearby" | "inbox" | "capture" | "permissions";

export type IllustrationAssets = Record<IllustrationKind, ImageSourcePropType>;

export interface StateIllustrationProps {
  kind: IllustrationKind;
  variant?: "state" | "onboarding";
}
