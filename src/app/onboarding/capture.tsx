import { router } from "expo-router";
import { OnboardingCopy, OnboardingFrame } from "@/components/onboarding-frame";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export default function CaptureIntroductionScreen() {
  return (
    <OnboardingFrame
      footer={
        <Button
          size="lg"
          containerClassName="w-full"
          accessibilityLabel="Continue to Permissions"
          onPress={() => router.navigate("/onboarding/permissions")}
        >
          Continue
        </Button>
      }
    >
      <StateIllustration kind="capture" variant="onboarding" />
      <OnboardingCopy>
        <Text
          accessibilityRole="header"
          className="text-center text-[36px] font-normal leading-[44px] tracking-[-0.8px] ios:font-[ui-serif] android:font-[serif]"
        >
          Tap or hold
        </Text>
        <Text className="max-w-[330px] text-center text-[17px] leading-[25px] opacity-65">
          Tap for a photo. Hold for video, then release to stop. Up to 60
          seconds.
        </Text>
      </OnboardingCopy>
    </OnboardingFrame>
  );
}
