import {
  GlassView,
  isLiquidGlassAvailable,
  type GlassStyle,
} from "expo-glass-effect";
import { Children, type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { Text, TextClassContext } from "@/components/ui/text";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/cn";
import { hapticButtonPress } from "@/lib/haptics";

// Continuous curve can't be expressed as a class.
const continuous = { borderCurve: "continuous" } as const;
const AnimatedPressable = withUniwind(
  Animated.createAnimatedComponent(Pressable),
);
// Explicit mapping keeps the native glassEffectStyle enum out of style conversion.
const StyledGlassView = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});
const pressTransition = {
  transition:
    "transform 120ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms cubic-bezier(0.23, 1, 0.32, 1)",
} as const;

const variantClasses = {
  primary: "bg-primary shadow-xs",
  secondary: "bg-secondary shadow-xs",
  destructive: "bg-destructive shadow-xs",
  outlined: "bg-card border border-border shadow-xs",
  surface: "bg-card",
  plain: "",
  ghost: "",
  link: "",
} as const;

const variantTextClasses = {
  primary: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  destructive: "text-destructive-foreground",
  outlined: "text-foreground",
  surface: "text-foreground",
  plain: "text-foreground",
  ghost: "text-foreground",
  link: "text-primary underline underline-offset-4",
} as const;

const sizeClasses = {
  sm: "h-9 px-3",
  md: "h-11 min-w-11 px-2",
  default: "h-11 px-5",
  lg: "h-14 px-6",
  icon: "h-11 w-11",
  "icon-lg": "h-12 w-12",
} as const;

const sizeTextClasses = {
  sm: "text-sm",
  md: "text-base",
  default: "text-base",
  lg: "text-base",
  icon: "text-base",
  "icon-lg": "text-base",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

// Variants that read as a tinted glass; others get a neutral (untinted) glass.
const glassTintVariants = {
  primary: "primary",
  secondary: "secondary",
  destructive: "destructive",
} as const;

// Spinner/tint color per variant, matching the label color.
const variantForeground = {
  primary: "primaryForeground",
  secondary: "secondaryForeground",
  destructive: "destructiveForeground",
  outlined: "foreground",
  surface: "foreground",
  plain: "foreground",
  ghost: "foreground",
  link: "primary",
} as const;

export type ButtonProps = Omit<PressableProps, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Layout applied to the outer button container on every platform. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Uniwind layout classes applied to the outer container on every platform. */
  containerClassName?: string;
  /** Native iOS glass material. @default 'regular' */
  glassEffectStyle?: GlassStyle;
  /** Style for the native iOS glass container. */
  glassStyle?: StyleProp<ViewStyle>;
  /** Custom tint for native glass and the solid fallback. */
  tintColor?: string;
  /** Label and loading indicator color when using a custom tint. */
  foregroundColor?: string;
  /** Show a spinner and disable the button. */
  loading?: boolean;
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "default",
  containerStyle,
  containerClassName,
  glassEffectStyle = "regular",
  glassStyle,
  tintColor,
  foregroundColor,
  loading = false,
  className,
  style,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  children,
  ...pressableProps
}: ButtonProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Bare icon actions and opaque sheet surfaces intentionally opt out of
  // Liquid Glass; all other variants keep the automatic platform treatment.
  const useGlass =
    isLiquidGlassAvailable() && variant !== "plain" && variant !== "surface";
  const isDisabled = disabled || loading;
  const interactionState = { pressed, hovered };
  const resolvedStyle =
    typeof style === "function" ? style(interactionState) : style;

  const pressable = (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={isDisabled}
      pressRetentionOffset={16}
      className={cn(
        "flex-row items-center justify-center gap-2",
        variant === "plain" ? "rounded-none" : "rounded-full",
        sizeClasses[size],
        // The glass backdrop supplies the fill, so drop the solid variant background.
        useGlass ? undefined : variantClasses[variant],
        useGlass ? undefined : containerClassName,
        className,
      )}
      style={[
        continuous,
        useGlass ? undefined : containerStyle,
        !useGlass && tintColor ? { backgroundColor: tintColor } : undefined,
        {
          transform: [
            { scale: !isDisabled && !reduceMotion && pressed ? 0.97 : 1 },
          ],
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
        },
        pressTransition,
        resolvedStyle,
      ]}
      {...pressableProps}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      onPress={
        onPress
          ? (event) => {
              hapticButtonPress();
              onPress(event);
            }
          : undefined
      }
    >
      {loading ? (
        <ActivityIndicator
          color={foregroundColor ?? theme[variantForeground[variant]]}
        />
      ) : (
        Children.map(children, (child) =>
          typeof child === "string" || typeof child === "number" ? (
            <Text
              style={foregroundColor ? { color: foregroundColor } : undefined}
            >
              {child}
            </Text>
          ) : (
            child
          ),
        )
      )}
    </AnimatedPressable>
  );

  return (
    <TextClassContext.Provider
      value={cn(
        "font-semibold",
        sizeTextClasses[size],
        variantTextClasses[variant],
      )}
    >
      {useGlass ? (
        <StyledGlassView
          className={containerClassName}
          isInteractive
          glassEffectStyle={glassEffectStyle}
          tintColor={
            tintColor ??
            (variant in glassTintVariants
              ? theme[
                  glassTintVariants[variant as keyof typeof glassTintVariants]
                ]
              : undefined)
          }
          style={[
            continuous,
            { borderRadius: 999 },
            containerStyle,
            glassStyle,
          ]}
        >
          {pressable}
        </StyledGlassView>
      ) : (
        pressable
      )}
    </TextClassContext.Provider>
  );
}
