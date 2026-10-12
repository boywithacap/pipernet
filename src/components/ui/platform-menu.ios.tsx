import { MenuView, type MenuComponentProps } from "@expo/ui/community/menu";

export type { MenuAction, NativeActionEvent } from "@expo/ui/community/menu";

/** Keep the native iOS menu independent of Android drawable assets. */
export function PlatformMenu({
  accessibilityLabel: _accessibilityLabel,
  ...props
}: MenuComponentProps & { accessibilityLabel: string }) {
  return <MenuView {...props} />;
}
