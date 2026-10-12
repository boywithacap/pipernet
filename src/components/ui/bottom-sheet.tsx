import { Icon } from "@/components/ui/icon";
import {
  BottomSheet as SwiftUIBottomSheet,
  Group,
  Host,
  RNHostView,
} from "@expo/ui/swift-ui";
import {
  frame,
  ignoreSafeArea,
  interactiveDismissDisabled,
  padding,
  presentationBackground,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import {
  createContext,
  forwardRef,
  type Context,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  type TextInputProps,
  type ViewProps,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/use-theme";
import { NativeBottomSheetHost } from "./bottom-sheet-host";
import { Button } from "./button";
import {
  finishSheetSession,
  resolveSheetDetents,
  syncSheetSession,
  type SheetSession,
} from "./bottom-sheet-state";

export { FlatList as BottomSheetFlatList, View as BottomSheetView };

const SheetKeyboardBottomInsetContext = createContext(0);

/** Keeps bottom-anchored sheet controls immediately above the keyboard. */
export function BottomSheetKeyboardAvoidingView({
  style,
  ...props
}: ViewProps) {
  const keyboardBottomInset = useContext(SheetKeyboardBottomInsetContext);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const frameEvent =
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const frameSubscription = Keyboard.addListener(frameEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(0);
    });

    return () => {
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const keyboardOverlap = Math.max(0, keyboardHeight - keyboardBottomInset);
  return (
    <View {...props} style={[style, { paddingBottom: keyboardOverlap }]} />
  );
}

export const BottomSheetTextInput = forwardRef<TextInput, TextInputProps>(
  function BottomSheetTextInput(props, ref) {
    return <TextInput ref={ref} {...props} />;
  },
);

const ScrollViewContext = (
  ScrollView as unknown as { Context: Context<unknown> }
).Context;

export type SheetVariant = "inline" | "large" | "centered";

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fires after the native dismissal completes; safe for subsequent navigation/presentations. */
  onDismiss?: () => void;
  variant?: SheetVariant;
  title?: string;
  leading?: ReactNode;
  action?: ReactNode;
  snapPoints?: (string | number)[];
  dismissible?: boolean;
  backgroundInteraction?: boolean;
  /** Let React Native content handle keyboard overlap instead of the native host. */
  ignoreKeyboardSafeArea?: boolean;
  layers?: ReactNode;
  children: ReactNode;
};

export function BottomSheet({ layers, ...props }: BottomSheetProps) {
  return <SheetBase layers={layers} {...props} />;
}

export type BottomSheetLayerProps = BottomSheetProps;

/**
 * A sheet stacked above its parent sheet. iOS can present only ONE sheet from
 * a given host, so sibling layers on the same parent must never be visible
 * together — a layer that should appear above another layer has to be passed
 * as that layer's own `layers`, not as a sibling.
 */
export function BottomSheetLayer(props: BottomSheetLayerProps) {
  return <SheetBase {...props} />;
}

function SheetBase(props: BottomSheetProps) {
  const [session, setSession] = useState<SheetSession<BottomSheetProps>>({
    phase: "closed",
    content: null,
    id: 0,
  });
  const next = syncSheetSession(session, props.visible, props);
  // Adjust to new props before React commits: never paint the closed panel's
  // empty children or fallback snap point into a still-visible presentation.
  if (next !== session) setSession(next);
  const requestedClose = useRef(-1);
  const [hostHeight, setHostHeight] = useState(0);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const presented = next.content;
  if (!presented) return null;

  const {
    variant = "centered",
    title,
    leading,
    action,
    snapPoints,
    dismissible = true,
    backgroundInteraction = false,
    ignoreKeyboardSafeArea = false,
    layers,
    children,
  } = presented;
  const isPresented = props.visible && next.phase === "open";
  const maxDetent = Math.max(44, winHeight - insets.top - insets.bottom - 10);
  const detents = resolveSheetDetents(snapPoints, maxDetent);
  const autoSize = detents.length === 0;
  const androidHeight = autoSize
    ? undefined
    : Math.max(
        ...detents.map((detent) =>
          detent === "large"
            ? maxDetent
            : detent === "medium"
              ? maxDetent * 0.5
              : "height" in detent
                ? detent.height
                : detent.fraction * maxDetent,
        ),
      );
  const keyboardBottomInset =
    Platform.OS === "ios" && ignoreKeyboardSafeArea && hostHeight
      ? Math.max(0, maxDetent - hostHeight)
      : 0;

  const requestClose = () => {
    if (
      requestedClose.current === next.id ||
      next.phase !== "open" ||
      !props.visible
    )
      return;
    requestedClose.current = next.id;
    setSession((current) =>
      current.id === next.id ? { ...current, phase: "closing" } : current,
    );
    presented.onClose();
  };
  const didDismiss = () => {
    // Native swipe/backdrop completion may reach JS before the binding-change
    // event. Clear the controlled visibility before releasing this session.
    if (next.phase === "open" && props.visible) requestClose();
    setSession((current) => finishSheetSession(current, next.id));
    presented.onDismiss?.();
  };
  const content = (
    <SheetKeyboardBottomInsetContext.Provider value={keyboardBottomInset}>
      <ScrollViewContext.Provider value={null}>
        <View
          className="bg-sheet"
          pointerEvents={next.phase === "closing" ? "none" : "auto"}
          style={
            Platform.OS === "android"
              ? { width: winWidth, height: androidHeight }
              : autoSize
                ? { width: winWidth }
                : // RNHostView needs an explicit zero basis; flex:1 alone can inherit
                  // a scroll child's intrinsic height and lay it out below the sheet.
                  { flexGrow: 1, height: 0 }
          }
        >
          <SheetHeader
            variant={variant}
            title={title}
            leading={leading}
            action={action}
            onClose={requestClose}
          />
          {autoSize ? children : <View className="flex-1">{children}</View>}
          {layers}
        </View>
      </ScrollViewContext.Provider>
    </SheetKeyboardBottomInsetContext.Provider>
  );

  if (Platform.OS === "android") {
    return (
      <NativeBottomSheetHost
        visible={isPresented}
        onClose={requestClose}
        onDismiss={didDismiss}
        dismissible={dismissible}
        ignoreKeyboardSafeArea={ignoreKeyboardSafeArea}
        containerColor={theme.sheet}
        contentColor={theme.foreground}
      >
        {content}
      </NativeBottomSheetHost>
    );
  }

  return (
    <Host style={{ position: "absolute" }} pointerEvents="none">
      <SwiftUIBottomSheet
        isPresented={isPresented}
        fitToContents={autoSize}
        onIsPresentedChange={(visible) => {
          if (!visible) requestClose();
        }}
        onDismiss={didDismiss}
      >
        <Group
          modifiers={[
            frame({
              maxWidth: Infinity,
              ...(autoSize ? {} : { maxHeight: Infinity }),
              alignment: "topLeading",
            }),
            padding({ top: 16 }),
            presentationDragIndicator("visible"),
            // Expo Go builds with @expo/ui <57.0.17 read `color`; newer native
            // builds read `style`. Supply both to paint the entire sheet chrome.
            { ...presentationBackground(theme.sheet), color: theme.sheet },
            interactiveDismissDisabled(!dismissible),
            ...(autoSize ? [] : [presentationDetents(detents)]),
            ...(ignoreKeyboardSafeArea
              ? [ignoreSafeArea({ regions: "keyboard", edges: "bottom" })]
              : []),
            ...(backgroundInteraction
              ? [presentationBackgroundInteraction("enabled")]
              : []),
          ]}
        >
          <RNHostView
            matchContents={autoSize}
            onLayout={(event) => {
              const height = Math.round(event.nativeEvent.layout.height);
              setHostHeight((current) =>
                current === height ? current : height,
              );
            }}
          >
            {content}
          </RNHostView>
        </Group>
      </SwiftUIBottomSheet>
    </Host>
  );
}

function SheetHeader({
  variant,
  title,
  leading,
  action,
  onClose,
}: {
  variant: SheetVariant;
  title?: string;
  leading?: ReactNode;
  action?: ReactNode;
  onClose: () => void;
}) {
  const close = <SheetCloseButton onPress={onClose} />;

  if (variant === "centered" || variant === "large") {
    // `leading` defaults to the close button on the left; `action` is the right slot.
    const left = leading === undefined ? close : leading;
    return (
      <View className="min-h-11 flex-row items-center gap-2 px-4 pb-2 pt-1">
        <View className="min-w-11 items-start">{left}</View>
        <Text
          className="flex-1 text-center text-lg font-semibold"
          numberOfLines={1}
        >
          {title}
        </Text>
        <View className="min-w-11 items-end">{action}</View>
      </View>
    );
  }

  // inline
  return (
    <View className="min-h-11 flex-row items-center gap-2.5 px-4 pb-2 pt-1">
      {leading === undefined ? close : leading}
      {title ? (
        <Text className="flex-1 text-lg font-semibold" numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      {action}
    </View>
  );
}

export function SheetBackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Button
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Back"
      size="icon"
      variant="outlined"
    >
      <Icon name="chevron-left" size={20} color={theme.foreground} />
    </Button>
  );
}

export function SheetCloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Button
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Close"
      size="icon"
      variant="outlined"
    >
      <Icon name="x" size={20} color={theme.foreground} />
    </Button>
  );
}
