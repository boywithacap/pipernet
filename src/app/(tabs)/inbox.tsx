import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MediaPreview } from "@/components/media-preview";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { TabScreen } from "@/components/ui/tab-screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { sonner } from "@/components/ui/sonner";
import { Text } from "@/components/ui/text";
import { useMedia } from "@/hooks/use-media";
import { useMesh } from "@/hooks/use-mesh";
import { useTheme } from "@/hooks/use-theme";
import { mediaUri, thumbnailUri } from "@/lib/media-files";
import { formatBytes, formatDuration } from "@/lib/media-policy";
import { formatCaptureDateTime } from "@/lib/capture-time";
import {
  PhotoLibraryPermissionError,
  saveToPhotoLibrary,
} from "@/lib/photo-library";
import type { MediaItem } from "@/types/media";
import { MESH_LIMITS } from "@/lib/mesh/protocol";

export default function InboxScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const reducedMotion = useReducedMotion();
  const filter: MediaItem["direction"] =
    view === "queued" ? "outgoing" : "received";
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [contentWidth, setContentWidth] = useState(Math.min(width, 800));
  const items = useMedia((state) => state.items);
  const status = useMedia((state) => state.status);
  const hydrate = useMedia((state) => state.hydrate);
  const markRead = useMedia((state) => state.markRead);
  const visibleItems = items.filter((item) => item.direction === filter);
  const queued = items.filter((item) => item.direction === "outgoing").length;
  const columns = contentWidth >= 600 ? 3 : 2;
  const tileWidth = (contentWidth - 32 - (columns - 1) * 12) / columns;

  function open(item: MediaItem) {
    setSelected(item);
    if (!item.read)
      void markRead(item.id).catch(() =>
        sonner.error("Couldn’t update your library."),
      );
  }

  return (
    <TabScreen scrollsBehindTabs>
      <View
        collapsable={false}
        className="flex-1 w-full max-w-[800px] self-center"
        onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
      >
        <FlatList
          key={columns}
          className="flex-1"
          data={status === "ready" ? visibleItems : []}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          contentInsetAdjustmentBehavior={
            Platform.OS === "ios" ? "automatic" : "never"
          }
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-4 pb-6"
          contentContainerStyle={{ flexGrow: 1 }}
          columnWrapperClassName="gap-3"
          stickyHeaderIndices={[0]}
          ListHeaderComponentStyle={{ marginHorizontal: -16 }}
          ListHeaderComponent={
            <View className="bg-background">
              <View className="flex-row items-center justify-between px-5 py-3">
                <Text
                  accessibilityRole="header"
                  className="text-2xl font-semibold tracking-[-0.8px]"
                >
                  Inbox
                </Text>
                <Button
                  variant="plain"
                  size="icon"
                  accessibilityLabel="Open settings"
                  onPress={() => router.navigate("/settings")}
                >
                  <Icon name="settings" size={23} color={theme.foreground} />
                </Button>
              </View>
              <View className="px-4 pb-4 pt-2">
                <SegmentedControl
                  value={filter}
                  options={[
                    { value: "received", label: "Received" },
                    {
                      value: "outgoing",
                      label: queued ? `Queued (${queued})` : "Queued",
                    },
                  ]}
                  onChange={(value) =>
                    router.setParams({
                      view: value === "outgoing" ? "queued" : "received",
                    })
                  }
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            status === "loading" || status === "idle" ? (
              <View className="flex-1 items-center justify-center px-6 pb-16">
                <ActivityIndicator
                  color={theme.foreground}
                  accessibilityLabel="Loading media"
                />
              </View>
            ) : status === "error" ? (
              <View className="flex-1 items-center justify-center px-6 pb-16">
                <StateIllustration kind="inbox" />
                <Text
                  accessibilityRole="alert"
                  className="my-5 text-lg font-medium"
                >
                  Couldn’t open your library
                </Text>
                <Button onPress={() => void hydrate()}>Try again</Button>
              </View>
            ) : (
              <View className="flex-1 items-center justify-center px-6 pb-16">
                <View className="mb-5">
                  <StateIllustration
                    kind={filter === "received" ? "inbox" : "capture"}
                  />
                </View>
                <Text className="text-lg font-medium">
                  {filter === "received" ? "Inbox empty" : "Queue empty"}
                </Text>
                <Button
                  variant="surface"
                  containerClassName="mt-6"
                  onPress={() => router.navigate("/(tabs)")}
                >
                  Record
                </Button>
              </View>
            )
          }
          initialNumToRender={12}
          windowSize={5}
          renderItem={({ item }) => (
            <MomentTile
              item={item}
              width={tileWidth}
              onPress={() => open(item)}
            />
          )}
        />
      </View>
      <Modal
        visible={selected !== null}
        animationType={reducedMotion ? "none" : "slide"}
        presentationStyle="fullScreen"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaProvider style={{ backgroundColor: theme.background }}>
          {selected ? (
            <MomentViewer
              key={selected.id}
              item={selected}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </SafeAreaProvider>
      </Modal>
    </TabScreen>
  );
}

function MomentTile({
  item,
  width,
  onPress,
}: {
  item: MediaItem;
  width: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const uri = thumbnailUri(item);
  const [failed, setFailed] = useState(false);
  const delivery = useMesh((state) =>
    state.records.find((record) => record.mediaId === item.id),
  );
  const transfer = useMesh((state) =>
    state.transfer?.mediaId === item.id ? state.transfer : undefined,
  );
  const shared = delivery?.deliveredTo.length ?? 0;
  const updatedAt = useMesh((state) => state.updatedAt);
  const sharingLabel = transfer
    ? "Sending"
    : shared
      ? `Shared · ${shared}`
      : item.createdAt + MESH_LIMITS.lifetime <= updatedAt
        ? "Expired"
        : "Queued";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? "" : "Unread "}${item.kind} ${item.direction === "received" ? `from ${item.sender || "nearby"}` : "queued to share"}, ${formatBytes(item.bytes)}`}
      className="mb-[18px] active:opacity-70"
      style={{ width }}
    >
      <View
        className="aspect-[0.8] items-center justify-center overflow-hidden rounded-card bg-card"
        style={{ borderCurve: "continuous" }}
      >
        {uri && !failed ? (
          <Image
            source={{ uri }}
            className="absolute inset-0"
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <Icon
            name={item.kind === "video" ? "video" : "image-off"}
            size={28}
            color={theme.mutedForeground}
          />
        )}
        {item.kind === "video" ? (
          <View className="absolute bottom-2.5 right-2.5 flex-row items-center gap-1 rounded-[20px] bg-[#00000080] px-2 py-[5px]">
            <Icon name="play" size={11} color="#ffffff" />
            <Text className="text-[11px] text-white">
              {item.duration ? formatDuration(item.duration) : "Video"}
            </Text>
          </View>
        ) : null}
        {!item.read ? (
          <View className="absolute right-3 top-3 size-2 rounded-full border border-[#00000020] bg-white" />
        ) : null}
      </View>
      <View className="mt-2 flex-row items-center justify-between gap-2 px-1">
        <Text numberOfLines={1} className="flex-1 text-sm font-medium">
          {item.direction === "received"
            ? item.sender || "Nearby"
            : sharingLabel}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {formatBytes(item.bytes)}
        </Text>
      </View>
    </Pressable>
  );
}

function MomentViewer({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const theme = useTheme();
  const remove = useMedia((state) => state.remove);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsPhotoSettings, setNeedsPhotoSettings] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const deletePending = useRef(false);
  const savePending = useRef(false);
  const confirmationPending = useRef(false);
  const title = `Delete ${item.kind}?`;
  const libraryName = Platform.OS === "ios" ? "Photos" : "Gallery";
  const message = `This removes it from PiperNet. Copies saved to ${libraryName} or shared with others stay there.`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function cancelDelete() {
    confirmationPending.current = false;
    if (mounted.current) setConfirming(false);
  }

  function confirmDelete() {
    if (
      !mounted.current ||
      deletePending.current ||
      savePending.current ||
      confirmationPending.current
    )
      return;
    confirmationPending.current = true;
    if (Platform.OS === "ios") {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: cancelDelete },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteMoment(),
        },
      ]);
    } else setConfirming(true);
  }

  async function deleteMoment() {
    if (
      !mounted.current ||
      !confirmationPending.current ||
      savePending.current ||
      deletePending.current
    )
      return;
    confirmationPending.current = false;
    deletePending.current = true;
    setConfirming(false);
    setDeleting(true);
    setError(null);
    setNeedsPhotoSettings(false);
    try {
      await remove(item.id);
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) {
        setError("Couldn’t delete. Try again.");
        setDeleting(false);
      }
    } finally {
      deletePending.current = false;
    }
  }

  async function saveMoment() {
    if (
      !mounted.current ||
      saved ||
      savePending.current ||
      deletePending.current ||
      confirmationPending.current
    )
      return;
    savePending.current = true;
    setSaving(true);
    setError(null);
    setNeedsPhotoSettings(false);
    try {
      await saveToPhotoLibrary(mediaUri(item));
      if (mounted.current) setSaved(true);
    } catch (error) {
      if (mounted.current) {
        const denied = error instanceof PhotoLibraryPermissionError;
        setNeedsPhotoSettings(denied && !error.canAskAgain);
        setError(
          denied
            ? `Allow PiperNet to save to ${libraryName}${error.canAskAgain ? ", then try again." : " in your phone’s settings."}`
            : `Couldn’t save to ${libraryName}. Check available storage and try again.`,
        );
      }
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      className="flex-1 bg-background"
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <Button
          variant="surface"
          size="icon"
          accessibilityLabel="Close preview"
          disabled={deleting || saving}
          onPress={onClose}
        >
          <Icon name="x" size={22} color={theme.foreground} />
        </Button>
        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 text-center text-sm font-medium"
        >
          {item.direction === "received"
            ? item.sender || "Nearby"
            : "Queued to share"}
        </Text>
        <View className="w-11 shrink-0" />
      </View>
      <View className="mx-3 flex-1 overflow-hidden rounded-[28px]">
        <MediaPreview uri={mediaUri(item)} kind={item.kind} />
      </View>
      <View className="gap-4 px-6 py-5">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="min-w-0 flex-1 text-sm text-muted-foreground">
            {formatCaptureDateTime(item.createdAt)}
          </Text>
          <Text className="shrink-0 text-sm text-muted-foreground">
            {formatBytes(item.bytes)}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ""}
          </Text>
        </View>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {error}
          </Text>
        ) : null}
        {needsPhotoSettings ? (
          <Button
            variant="surface"
            onPress={() =>
              void Linking.openSettings().catch(() => {
                if (mounted.current) {
                  setError(
                    "Open your phone’s settings to allow saving photos and videos.",
                  );
                }
              })
            }
          >
            Open settings
          </Button>
        ) : null}
        <View className="flex-row items-center gap-3">
          <Button
            containerClassName="flex-1"
            loading={saving}
            disabled={deleting || confirming || saved}
            onPress={() => void saveMoment()}
            accessibilityLabel={`${saved ? "Saved" : "Save"} to ${libraryName}`}
            accessibilityState={{ busy: saving }}
          >
            <Icon
              name={saved ? "check" : "download"}
              size={18}
              color={theme.primaryForeground}
            />
            {`${saved ? "Saved" : "Save"} to ${libraryName}`}
          </Button>
          <Button
            variant="destructive"
            size="icon"
            loading={deleting}
            disabled={saving}
            onPress={confirmDelete}
            accessibilityLabel="Delete media from PiperNet"
          >
            <Icon
              name="trash-2"
              size={17}
              color={theme.destructiveForeground}
            />
          </Button>
        </View>
      </View>
      {Platform.OS !== "ios" ? (
        <ConfirmationDialog
          visible={confirming}
          title={title}
          message={message}
          confirmLabel="Delete"
          onCancel={cancelDelete}
          onConfirm={() => void deleteMoment()}
        />
      ) : null}
    </Screen>
  );
}
