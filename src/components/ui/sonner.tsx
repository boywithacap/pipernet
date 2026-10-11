import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Extrapolation,
  FadeOut,
  interpolate,
  useReducedMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { create } from "zustand";
import { scheduleOnRN } from "react-native-worklets";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/use-theme";

type SonnerVariant = "success" | "error" | "info";

type SonnerAction = {
  label: string;
  onPress: () => void;
};

export type SonnerOptions = {
  id?: string;
  description?: string;
  duration?: number;
  action?: SonnerAction;
};

type SonnerItem = SonnerOptions & {
  id: string;
  title: string;
  variant: SonnerVariant;
};

type SonnerState = {
  items: SonnerItem[];
  show: (item: SonnerItem) => void;
  dismiss: (id?: string) => void;
};

type SonnerTimer = {
  timeout?: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
};

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION = 4000;
const MIN_TOAST_HEIGHT = 56;
const STACK_GAP = 8;
const STACK_SCALE_STEP = 0.05;
const SWIPE_THRESHOLD = 56;
const SWIPE_VELOCITY = 550;
const timers = new Map<string, SonnerTimer>();
let nextId = 0;

const stackSpring = {
  duration: 400,
  dampingRatio: 1,
} as const;

const useSonnerStore = create<SonnerState>((set) => ({
  items: [],
  show: (item) =>
    set((state) => ({
      items: [
        ...state.items.filter((current) => current.id !== item.id),
        item,
      ].slice(-MAX_VISIBLE_TOASTS),
    })),
  dismiss: (id) =>
    set((state) => ({
      items: id ? state.items.filter((item) => item.id !== id) : [],
    })),
}));

function armTimer(id: string, timer: SonnerTimer) {
  timer.startedAt = Date.now();
  timer.timeout = setTimeout(() => {
    timers.delete(id);
    useSonnerStore.getState().dismiss(id);
  }, timer.remaining);
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer?.timeout) clearTimeout(timer.timeout);
  timers.delete(id);
}

function pauseTimer(id: string) {
  const timer = timers.get(id);
  if (!timer?.timeout) return;

  clearTimeout(timer.timeout);
  timer.timeout = undefined;
  timer.remaining = Math.max(
    0,
    timer.remaining - (Date.now() - timer.startedAt),
  );
}

function resumeTimer(id: string) {
  const timer = timers.get(id);
  if (!timer || timer.timeout) return;

  if (timer.remaining <= 0) {
    timers.delete(id);
    useSonnerStore.getState().dismiss(id);
    return;
  }
  armTimer(id, timer);
}

function scheduleTimer(id: string, duration: number) {
  const timer: SonnerTimer = { remaining: duration, startedAt: Date.now() };
  timers.set(id, timer);
  if (AppState.currentState === "active") armTimer(id, timer);
}

function show(
  title: string,
  variant: SonnerVariant,
  options: SonnerOptions = {},
) {
  const id = options.id ?? `sonner-${++nextId}`;
  const currentItems = useSonnerStore.getState().items;
  const isReplacing = currentItems.some((item) => item.id === id);

  if (!isReplacing && currentItems.length >= MAX_VISIBLE_TOASTS) {
    clearTimer(currentItems[0].id);
  }
  clearTimer(id);
  useSonnerStore.getState().show({ ...options, id, title, variant });

  const duration = options.duration ?? DEFAULT_DURATION;
  if (duration > 0) scheduleTimer(id, duration);

  return id;
}

function dismiss(id?: string) {
  if (id) {
    clearTimer(id);
  } else {
    [...timers.keys()].forEach(clearTimer);
  }
  useSonnerStore.getState().dismiss(id);
}

/** Imperative notifications for completed app actions. */
export const sonner = {
  success: (title: string, options?: SonnerOptions) =>
    show(title, "success", options),
  error: (title: string, options?: SonnerOptions) =>
    show(title, "error", options),
  info: (title: string, options?: SonnerOptions) =>
    show(title, "info", options),
  dismiss,
};

/** App-level viewport for Sonner notifications. Mount once near the root navigator. */
export function Sonner() {
  const insets = useSafeAreaInsets();
  const items = useSonnerStore((state) => state.items);
  const [frontHeight, setFrontHeight] = useState(MIN_TOAST_HEIGHT);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        [...timers.keys()].forEach(resumeTimer);
      } else {
        [...timers.keys()].forEach(pauseTimer);
      }
    });
    return () => subscription.remove();
  }, []);

  const measureFrontToast = useCallback((event: LayoutChangeEvent) => {
    const height = Math.max(
      MIN_TOAST_HEIGHT,
      Math.round(event.nativeEvent.layout.height),
    );
    setFrontHeight((current) => (current === height ? current : height));
  }, []);

  const stackHeight = items.length
    ? frontHeight + Math.max(0, items.length - 1) * STACK_GAP
    : 0;

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 z-50 items-center px-4"
      style={{ top: insets.top + 8, elevation: 1000 }}
    >
      <View
        pointerEvents="box-none"
        className="relative w-full"
        style={{ maxWidth: 520, height: stackHeight }}
      >
        {items.map((item, index) => {
          const indexFromFront = items.length - index - 1;
          const isFront = indexFromFront === 0;

          return (
            <SonnerCard
              key={item.id}
              item={item}
              indexFromFront={indexFromFront}
              isFront={isFront}
              frontHeight={frontHeight}
              onFrontLayout={isFront ? measureFrontToast : undefined}
            />
          );
        })}
      </View>
    </View>
  );
}

function SonnerCard({
  item,
  indexFromFront,
  isFront,
  frontHeight,
  onFrontLayout,
}: {
  item: SonnerItem;
  indexFromFront: number;
  isFront: boolean;
  frontHeight: number;
  onFrontLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const visual = sonnerVisuals[item.variant];
  const stackTranslateY = useSharedValue(
    reducedMotion
      ? indexFromFront * STACK_GAP
      : -Math.max(frontHeight, MIN_TOAST_HEIGHT) - 16,
  );
  const stackScale = useSharedValue(reducedMotion ? 1 : 0.96);
  const stackOpacity = useSharedValue(0);
  const swipeTranslateY = useSharedValue(0);

  useEffect(() => {
    stackTranslateY.set(
      reducedMotion
        ? indexFromFront * STACK_GAP
        : withSpring(indexFromFront * STACK_GAP, stackSpring),
    );
    stackScale.set(
      reducedMotion
        ? 1
        : withSpring(
            Math.max(0.9, 1 - indexFromFront * STACK_SCALE_STEP),
            stackSpring,
          ),
    );
    stackOpacity.set(withTiming(1, { duration: 160 }));
  }, [
    indexFromFront,
    reducedMotion,
    stackOpacity,
    stackScale,
    stackTranslateY,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity:
      stackOpacity.get() *
      interpolate(
        Math.abs(swipeTranslateY.get()),
        [0, SWIPE_THRESHOLD * 2],
        [1, 0.35],
        Extrapolation.CLAMP,
      ),
    transform: [
      { translateY: stackTranslateY.get() + swipeTranslateY.get() },
      { scale: stackScale.get() },
    ],
  }));

  const panGesture = Gesture.Pan()
    .enabled(isFront)
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      scheduleOnRN(pauseTimer, item.id);
    })
    .onUpdate((event) => {
      setAnimatedValue(swipeTranslateY, swipeWithFriction(event.translationY));
    })
    .onEnd((event) => {
      const distance = Math.abs(event.translationY);
      const velocity = Math.abs(event.velocityY);

      if (distance >= SWIPE_THRESHOLD || velocity >= SWIPE_VELOCITY) {
        if (reducedMotion) {
          scheduleOnRN(dismiss, item.id);
          return;
        }
        const direction =
          Math.sign(event.translationY || event.velocityY) || -1;
        setAnimatedValue(
          swipeTranslateY,
          withTiming(
            direction * (frontHeight + 120),
            { duration: 160 },
            (finished) => {
              if (finished) scheduleOnRN(dismiss, item.id);
            },
          ),
        );
        return;
      }

      setAnimatedValue(swipeTranslateY, withSpring(0, stackSpring));
      scheduleOnRN(resumeTimer, item.id);
    })
    .onFinalize((_event, success) => {
      if (!success) scheduleOnRN(resumeTimer, item.id);
    });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        pointerEvents={isFront ? "auto" : "none"}
        exiting={FadeOut.duration(140)}
        accessibilityRole={isFront ? "alert" : undefined}
        accessibilityLiveRegion={
          isFront ? (item.variant === "error" ? "assertive" : "polite") : "none"
        }
        accessibilityElementsHidden={!isFront}
        importantForAccessibility={isFront ? "yes" : "no-hide-descendants"}
        style={[
          styles.toastWrapper,
          { zIndex: MAX_VISIBLE_TOASTS - indexFromFront },
        ]}
      >
        <Animated.View
          onLayout={onFrontLayout}
          style={[
            styles.toastShadow,
            { backgroundColor: theme.background },
            animatedStyle,
          ]}
        >
          <View
            style={[
              styles.toast,
              {
                height: isFront ? undefined : frontHeight,
                borderColor: "#ffff",
                backgroundColor: theme.background,
              },
            ]}
          >
            <View
              className="h-[30px] w-[30px] items-center justify-center rounded-full"
              style={{ backgroundColor: visual.backgroundColor }}
            >
              <Icon name={visual.icon} size={17} color={visual.color(theme)} />
            </View>

            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold" numberOfLines={2}>
                {item.title}
              </Text>
              {item.description ? (
                <Text
                  className="mt-0.5 text-xs leading-4 text-muted-foreground"
                  numberOfLines={3}
                >
                  {item.description}
                </Text>
              ) : null}
            </View>

            {item.action ? (
              <Button
                size="sm"
                variant="outlined"
                onPress={() => {
                  sonner.dismiss(item.id);
                  item.action?.onPress();
                }}
              >
                {item.action.label}
              </Button>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function swipeWithFriction(distance: number) {
  "worklet";
  const absoluteDistance = Math.abs(distance);
  if (absoluteDistance <= SWIPE_THRESHOLD) return distance;

  return (
    Math.sign(distance) *
    (SWIPE_THRESHOLD + (absoluteDistance - SWIPE_THRESHOLD) * 0.25)
  );
}

function setAnimatedValue(sharedValue: SharedValue<number>, value: number) {
  "worklet";
  sharedValue.set(value);
}

// Exit opacity belongs to the wrapper while stack/swipe opacity and transforms
// belong to the inner surface. Keeping those animation owners separate avoids
// Reanimated layout animations overwriting the interactive animated style.
const styles = StyleSheet.create({
  toastWrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  toastShadow: {
    borderCurve: "continuous",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  toast: {
    minHeight: MIN_TOAST_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});

const sonnerVisuals: Record<
  SonnerVariant,
  {
    icon: IconName;
    backgroundColor: string;
    color: (theme: ReturnType<typeof useTheme>) => string;
  }
> = {
  success: {
    icon: "check",
    backgroundColor: "rgba(42, 178, 0, 0.12)",
    color: (theme) => theme.primary,
  },
  error: {
    icon: "circle-alert",
    backgroundColor: "rgba(255, 59, 48, 0.11)",
    color: (theme) => theme.destructive,
  },
  info: {
    icon: "info",
    backgroundColor: "rgba(142, 142, 147, 0.13)",
    color: (theme) => theme.mutedForeground,
  },
};
