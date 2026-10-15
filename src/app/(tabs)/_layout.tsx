import { Lucide } from "@react-native-vector-icons/lucide";
import { Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useMedia } from "@/hooks/use-media";
import { useTheme } from "@/hooks/use-theme";

export default function TabsLayout() {
  const theme = useTheme();
  const unread = useMedia(
    (state) =>
      state.items.filter((item) => item.direction === "received" && !item.read)
        .length,
  );
  return (
    <NativeTabs
      tintColor={theme.foreground}
      iconColor={{ default: theme.mutedForeground, selected: theme.foreground }}
    >
      <NativeTabs.Trigger
        name="index"
        disableAutomaticContentInsets
        contentStyle={{ backgroundColor: theme.background }}
      >
        <NativeTabs.Trigger.Icon
          src={<NativeTabs.Trigger.VectorIcon family={Lucide} name="camera" />}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="inbox"
        disableAutomaticContentInsets={Platform.OS !== "ios"}
        contentStyle={{ backgroundColor: theme.background }}
      >
        <NativeTabs.Trigger.Icon
          src={<NativeTabs.Trigger.VectorIcon family={Lucide} name="inbox" />}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        {unread > 0 ? (
          <NativeTabs.Trigger.Badge>
            {unread > 99 ? "99+" : String(unread)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
