import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-screens/experimental";
import { withUniwind } from "uniwind";
import { Screen } from "@/components/ui/screen";

const NativeSafeAreaView = withUniwind(SafeAreaView);

/** Native tabs own the bottom inset so content ends above the floating bar. */
export function TabScreen({ children }: { children: ReactNode }) {
  return (
    <NativeSafeAreaView
      edges={{ bottom: true }}
      className="flex-1 bg-background"
    >
      <Screen edges={["top", "left", "right"]} className="flex-1 bg-background">
        {children}
      </Screen>
    </NativeSafeAreaView>
  );
}
