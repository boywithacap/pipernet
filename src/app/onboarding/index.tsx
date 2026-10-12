import { router } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export default function NearbySharingScreen() {
  return (
    <OnboardingFrame
      footer={
        <Button
          size="lg"
          containerClassName="w-full"
          accessibilityLabel="Continue to Your inbox"
          onPress={() => router.navigate("/onboarding/inbox")}
        >
          Continue
        </Button>
      }
    >
      <StateIllustration kind="nearby" variant="onboarding" />
      <OnboardingCopy>
        <Text
          accessibilityRole="header"
          className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
        >
          Nearby sharing
        </Text>
        <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
          Share photos and videos with nearby phones, without internet.
          Connected phones can view and keep what you share.
        </Text>
      </OnboardingCopy>
    </OnboardingFrame>
  );
}
