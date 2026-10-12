import type { ReactElement } from "react";
import type { ColorValue } from "react-native";

export type NativeBottomSheetHostProps = {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  dismissible: boolean;
  ignoreKeyboardSafeArea: boolean;
  containerColor: ColorValue;
  contentColor: ColorValue;
  children: ReactElement;
};
