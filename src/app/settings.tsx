import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { meshCoordinator, useMesh } from "@/hooks/use-mesh";
import { useTheme } from "@/hooks/use-theme";
import { usePermissionAction } from "@/hooks/use-permission-action";
import {
  checkPermissionTask,
  permissionErrorMessage,
} from "@/lib/permission-errors";
import { formatBytes } from "@/lib/media-policy";
import { requestNearbyPermissions } from "@/lib/mesh/transport";
import { waitForForeground } from "@/lib/app-foreground";
import { isAppActive, subscribeAppActive } from "@/lib/app-state";
import type { MeshSnapshot } from "@/types/mesh";

export default function SettingsScreen() {
  const theme = useTheme();
  const state = useMesh((state) => state);
  const { busy, error: actionError, run, cancel } = usePermissionAction();
  const error = actionError ? permissionErrorMessage(actionError) : state.error;
  useFocusEffect(useCallback(() => cancel, [cancel]));
  const available =
    state.status !== "unavailable" && state.status !== "loading";
  const connected = state.peers.filter(
    (peer) => peer.state === "connected",
  ).length;
  const scanning = state.status === "discovering" && !connected;

  function enable(value: boolean) {
    return run(async (signal) => {
      if (value) {
        await requestNearbyPermissions();
        await waitForForeground({
          isActive: isAppActive,
          subscribe: subscribeAppActive,
          signal,
        });
      }
      checkPermissionTask(signal);
      await meshCoordinator.configure({ enabled: value });
    });
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/inbox");
  }

  return (
    <Screen
      edges={["bottom", "left", "right"]}
      className="flex-1 overflow-hidden bg-sheet"
    >
      <View className="w-full max-w-[800px] flex-1 self-center">
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-4">
          <Button
            variant="surface"
            size="icon"
            accessibilityLabel="Close settings"
            onPress={close}
          >
            <Icon name="x" size={20} color={theme.foreground} />
          </Button>
          <Text
            accessibilityRole="header"
            className="flex-1 text-center text-lg font-semibold"
          >
            Settings
          </Text>
          <View className="w-11" />
        </View>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-5 pb-6 pt-2"
        >
          <View
            className="overflow-hidden rounded-card bg-card"
            style={{ borderCurve: "continuous" }}
          >
            <SharingOption
              icon="send"
              title="Auto-share captures"
              hint="Share new captures and queued media from the last 24 hours. Connected phones can view and keep them."
              value={state.enabled}
              disabled={busy || !available}
              onChange={(value) => void enable(value)}
            />
            <View className="ml-[60px] mr-4 h-px bg-border" />
            <SharingOption
              icon="repeat-2"
              title="Relay received media"
              hint="Pass received files to other phones."
              value={state.relay}
              disabled={busy || !available}
              onChange={(relay) =>
                void run(() => meshCoordinator.configure({ relay }))
              }
            />
          </View>
          <View className="gap-3 py-5">
            <View className="flex-row items-center gap-3 px-4">
              <View className="size-8 shrink-0 items-center justify-center">
                {scanning || state.status === "loading" ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.mutedForeground}
                  />
                ) : (
                  <Icon
                    name={connected ? "radio" : "radio-tower"}
                    size={20}
                    color={theme.mutedForeground}
                  />
                )}
              </View>
              <Text
                accessibilityLiveRegion="polite"
                className="flex-1 text-sm font-medium"
              >
                {sharingStatus(state, connected)}
              </Text>
            </View>
            {error ? (
              <View className="gap-3 px-4">
                <Text
                  accessibilityRole="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    variant="surface"
                    size="sm"
                    disabled={busy || !available}
                    onPress={() => void enable(true)}
                  >
                    Retry
                  </Button>
                  <Button
                    variant="plain"
                    size="sm"
                    onPress={() => void run(() => Linking.openSettings())}
                  >
                    Device settings
                  </Button>
                </View>
              </View>
            ) : null}
            {state.transfer ? (
              <View className="gap-2 px-4">
                <View className="flex-row flex-wrap items-center justify-between gap-1">
                  <Text className="text-sm">
                    {state.transfer.direction === "sending"
                      ? "Sending"
                      : "Receiving"}
                  </Text>
                  <Text
                    accessibilityLiveRegion="polite"
                    className="text-xs tabular-nums text-muted-foreground"
                  >
                    {formatBytes(state.transfer.bytes)} /{" "}
                    {formatBytes(state.transfer.total)}
                  </Text>
                </View>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel="Media transfer"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: transferPercent(state),
                  }}
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <View
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${transferPercent(state)}%` }}
                  />
                </View>
              </View>
            ) : null}
          </View>

          {available ? (
            <>
              <Text
                accessibilityRole="header"
                className="mb-3 px-1 text-sm font-medium"
              >
                Nearby phones
              </Text>
              {state.peers.length === 0 ? (
                <View className="flex-row items-center gap-3 rounded-card bg-card px-4 py-4">
                  <View className="size-8 shrink-0 items-center justify-center">
                    <Icon
                      name="smartphone"
                      size={22}
                      color={theme.mutedForeground}
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-sm font-medium">
                      No phones nearby
                    </Text>
                    <Text className="text-xs leading-[18px] text-muted-foreground">
                      {state.enabled
                        ? "Open PiperNet on another phone."
                        : "Turn on auto-sharing to connect."}
                    </Text>
                  </View>
                </View>
              ) : (
                <View className="gap-3">
                  {state.peers.map((peer) => (
                    <View
                      key={peer.id}
                      className="gap-3 rounded-card bg-card p-4"
                    >
                      <View className="flex-row items-center gap-3">
                        <View className="size-8 shrink-0 items-center justify-center">
                          <Icon
                            name="smartphone"
                            size={22}
                            color={theme.mutedForeground}
                          />
                        </View>
                        <View className="flex-1 gap-1">
                          <Text numberOfLines={1} className="font-medium">
                            {peer.name}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {peer.state === "connected"
                              ? "Connected"
                              : peer.state === "connecting"
                                ? "Connecting…"
                                : "Waiting to connect"}
                          </Text>
                        </View>
                        {peer.state === "connecting" ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.mutedForeground}
                          />
                        ) : peer.state === "connected" ? (
                          <Icon
                            name="check"
                            size={18}
                            color={theme.foreground}
                          />
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}

function SharingOption({
  icon,
  title,
  hint,
  value,
  disabled,
  onChange,
}: {
  icon: IconName;
  title: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
      <View className="size-8 shrink-0 items-center justify-center">
        <Icon name={icon} size={22} color={theme.foreground} />
      </View>
      <Text className="min-w-0 flex-1 text-base font-medium leading-6">
        {title}
      </Text>
      <View className="shrink-0 items-center justify-center">
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          accessibilityLabel={title}
          accessibilityHint={hint}
        />
      </View>
    </View>
  );
}

function sharingStatus(state: MeshSnapshot, connected: number) {
  if (state.status === "loading") return "Opening sharing…";
  if (state.status === "unavailable") return "Sharing unavailable";
  if (state.status === "error") return "Sharing needs attention";
  if (!state.enabled) return "Sharing off";
  if (state.status === "paused") return "Sharing paused";
  if (connected)
    return `${connected} phone${connected === 1 ? "" : "s"} connected`;
  return "Looking for phones…";
}

function transferPercent(state: MeshSnapshot) {
  if (!state.transfer || state.transfer.total <= 0) return 0;
  return Math.round(
    Math.min(1, Math.max(0, state.transfer.bytes / state.transfer.total)) * 100,
  );
}
