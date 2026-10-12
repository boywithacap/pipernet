import { Modal, Pressable, View } from "react-native";
import { Button } from "./button";
import { Text } from "./text";

/** Custom Android confirmation, including hardware-back and outside-tap dismissal. */
export function ConfirmationDialog({
  visible,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View className="flex-1 items-center justify-center bg-black/45 px-6">
        <Pressable
          className="absolute inset-0"
          onPress={onCancel}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          accessibilityViewIsModal
          className="w-full max-w-[360px] gap-5 rounded-[24px] bg-sheet p-6"
        >
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-xl font-semibold">
              {title}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {message}
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="surface"
              containerClassName="flex-1"
              onPress={onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              containerClassName="flex-1"
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
