import type { ReactNode } from "react";
import { Platform } from "react-native";
import { SafeAreaView } from "react-native-screens/experimental";
import { withUniwind } from "uniwind";
import { Screen } from "@/components/ui/screen";

const NativeSafeAreaView = withUniwind(SafeAreaView);

/** Keep fixed controls above tabs; iOS lists use scroll insets to flow behind them. */
export function TabScreen({
  children,
  scrollsBehindTabs = false,
}: {
  children: ReactNode;
  scrollsBehindTabs?: boolean;
}) {
  return (
    <NativeSafeAreaView
      edges={{ bottom: !scrollsBehindTabs || Platform.OS !== "ios" }}
      collapsable={false}
      className="flex-1 bg-background"
    >
      <Screen
        edges={["top", "left", "right"]}
        collapsable={false}
        className="flex-1 bg-background"
      >
        {children}
      </Screen>
    </NativeSafeAreaView>
  );
}
