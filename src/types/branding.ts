import type { TextProps } from "react-native";
import type { SharedValue } from "react-native-reanimated";

export interface AppWordmarkProps extends Omit<TextProps, "children"> {
  className?: string;
}

export interface LaunchSplashProps {
  onFinish: () => void;
}

export interface LaunchLetterProps {
  letter: string;
  index: number;
  progress: SharedValue<number>;
}
