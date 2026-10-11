import { router } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export default function InboxIntroductionScreen() {
  return (
    <OnboardingFrame
      footer={
        <Button
          size="lg"
          containerClassName="w-full"
          accessibilityLabel="Continue to Tap or hold"
          onPress={() => router.navigate("/onboarding/capture")}
        >
          Continue
        </Button>
      }
    >
      <StateIllustration kind="inbox" variant="onboarding" />
      <OnboardingCopy>
        <Text
          accessibilityRole="header"
          className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
        >
          Your inbox
        </Text>
        <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
          Find received photos and videos in Inbox. Your own captures are saved
          in Queued.
        </Text>
      </OnboardingCopy>
    </OnboardingFrame>
  );
}
