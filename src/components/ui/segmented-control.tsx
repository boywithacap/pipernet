import { Icon, type IconName } from "@/components/ui/icon";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withSpring,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/cn";
import { hapticSelection } from "@/lib/haptics";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
};

// Inner padding of the track (p-1); the thumb is inset by it on all sides.
const TRACK_PADDING = 4;

/**
 * Pill tab switcher: muted rounded track with a thumb that springs to the
 * active segment. Inbox uses it to flip between Received and Queued.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  iconOnly = false,
}: {
  value: T;
  options: SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Keep labels for VoiceOver while displaying only icons. */
  iconOnly?: boolean;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth =
    trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / options.length : 0;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const offset = useSharedValue(0);
  // Jump (don't animate) into the initial position once the track is measured;
  // spring on every selection change after that.
  const initialized = useRef(false);
  useEffect(() => {
    if (!segmentWidth) return;
    const target = index * segmentWidth;
    if (!initialized.current || reducedMotion) {
      initialized.current = true;
      offset.set(target);
    } else {
      offset.set(
        withSpring(target, {
          duration: 400,
          dampingRatio: 1,
        }),
      );
    }
  }, [index, offset, segmentWidth, reducedMotion]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));

  return (
    <View
      className={cn("flex-row rounded-full bg-muted p-1", className)}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: TRACK_PADDING,
              bottom: TRACK_PADDING,
              left: TRACK_PADDING,
              width: segmentWidth,
              borderRadius: 999,
              backgroundColor: theme.background,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.08,
              shadowRadius: 3,
              elevation: 2,
            },
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => {
              if (!selected) hapticSelection();
              onChange(option.value);
            }}
            className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-full px-3"
          >
            {option.icon ? (
              <Icon
                name={option.icon}
                size={18}
                color={selected ? theme.foreground : theme.mutedForeground}
              />
            ) : null}
            {!iconOnly && (
              <Text
                className={cn(
                  "font-semibold",
                  !selected && "text-muted-foreground",
                )}
              >
                {option.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
