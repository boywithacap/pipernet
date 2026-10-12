import {
  Host,
  ModalBottomSheet,
  RNHostView,
  type ModalBottomSheetRef,
} from "@expo/ui/jetpack-compose";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { NativeBottomSheetHostProps } from "./bottom-sheet-host.types";

export function NativeBottomSheetHost({
  visible,
  onClose,
  onDismiss,
  dismissible,
  ignoreKeyboardSafeArea,
  containerColor,
  contentColor,
  children,
}: NativeBottomSheetHostProps) {
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  const [mounted, setMounted] = useState(visible);
  const didDismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (visible) {
      const frame = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(frame);
    }

    let cancelled = false;
    const sheet = sheetRef.current;

    if (!sheet) {
      const frame = requestAnimationFrame(() => {
        setMounted(false);
        didDismiss();
      });
      return () => cancelAnimationFrame(frame);
    }

    void sheet.hide().then(() => {
      if (!cancelled) {
        setMounted(false);
        didDismiss();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!mounted) return null;

  return (
    <Host
      ignoreSafeAreaKeyboardInsets={ignoreKeyboardSafeArea}
      pointerEvents="none"
      style={{ position: "absolute" }}
    >
      <ModalBottomSheet
        ref={sheetRef}
        onDismissRequest={onClose}
        containerColor={containerColor}
        contentColor={contentColor}
        showDragHandle
        skipPartiallyExpanded
        sheetGesturesEnabled={dismissible}
        properties={{
          shouldDismissOnBackPress: dismissible,
          shouldDismissOnClickOutside: dismissible,
        }}
      >
        <RNHostView matchContents>{children}</RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
