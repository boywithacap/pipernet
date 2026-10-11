import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { AppWordmark } from "@/components/app-wordmark";
import { Screen } from "@/components/ui/screen";

export function OnboardingFrame({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Screen className="flex-1 bg-background">
      <View className="min-h-16 w-full max-w-[600px] self-center items-center justify-center px-5 pb-2 pt-3">
        <AppWordmark />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow items-center justify-center px-7 pb-10 pt-6"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {children}
      </ScrollView>
      <View className="w-full max-w-[480px] self-center px-6 pb-6">
        {footer}
      </View>
    </Screen>
  );
}

export function OnboardingCopy({ children }: { children: ReactNode }) {
  return (
    <View className="mt-8 w-full max-w-[380px] items-center gap-4">
      {children}
    </View>
  );
}
