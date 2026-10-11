import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { withUniwind } from "uniwind";
import { AppWordmark } from "@/components/app-wordmark";
import { APP } from "@/constants/app";
import { WORDMARK_CLASSNAME } from "@/constants/branding";
import { cn } from "@/lib/cn";
import type { LaunchLetterProps, LaunchSplashProps } from "@/types/branding";

const AnimatedView = withUniwind(Animated.View);
const AnimatedText = withUniwind(Animated.Text);
const letters = Array.from(APP.name);
const writeDuration = letters.length * 85;
const holdDuration = 180;
const fadeDuration = 200;

export function LaunchSplash({ onFinish }: LaunchSplashProps) {
  const reducedMotion = useReducedMotion();
  const laidOut = useRef(false);
  const [started, setStarted] = useState(false);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const surface = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    if (!started) return;
    let active = true;
    let finished = false;
    const finish = () => {
      if (!active || finished) return;
      finished = true;
      onFinish();
    };

    if (reducedMotion) {
      finish();
      return () => {
        active = false;
      };
    }

    progress.set(
      withTiming(letters.length, {
        duration: writeDuration,
        easing: Easing.linear,
      }),
    );
    opacity.set(
      withDelay(
        writeDuration + holdDuration,
        withTiming(0, { duration: fadeDuration }, (completed) => {
          if (completed) scheduleOnRN(finish);
        }),
      ),
    );
    // A cancelled native animation must never leave launch covering navigation.
    const fallback = setTimeout(
      finish,
      writeDuration + holdDuration + fadeDuration + 500,
    );
    return () => {
      active = false;
      clearTimeout(fallback);
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  }, [started, reducedMotion, onFinish, progress, opacity]);

  return (
    <AnimatedView
      accessible
      accessibilityRole="text"
      accessibilityLabel={APP.name}
      className="absolute inset-0 z-50 items-center justify-center bg-background"
      style={surface}
      onLayout={() => {
        if (laidOut.current) return;
        laidOut.current = true;
        // Keep the native surface until this replacement has actually laid out.
        try {
          SplashScreen.hide();
        } catch {
          // Expo Go may have already hidden its launch surface after a reload.
        }
        setStarted(true);
      }}
    >
      {reducedMotion ? (
        <AppWordmark className="text-[40px] leading-[52px]" />
      ) : (
        <View
          className="flex-row items-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {letters.map((letter, index) => (
            <LaunchLetter
              key={index}
              letter={letter}
              index={index}
              progress={progress}
            />
          ))}
        </View>
      )}
    </AnimatedView>
  );
}

function LaunchLetter({ letter, index, progress }: LaunchLetterProps) {
  const ink = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, progress.get() - index)),
  }));
  return (
    <AnimatedText
      className={cn(
        "text-[40px] leading-[52px] text-foreground",
        WORDMARK_CLASSNAME,
      )}
      style={ink}
    >
      {letter}
    </AnimatedText>
  );
}
