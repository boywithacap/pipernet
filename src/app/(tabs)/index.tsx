import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type CameraViewProps,
} from "expo-camera";
import { isDevice } from "expo-device";
import { router, useIsFocused } from "expo-router";
import { withUniwind } from "uniwind";
import { MediaPreview } from "@/components/media-preview";
import { StateIllustration } from "@/components/state-illustration";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TabScreen } from "@/components/ui/tab-screen";
import { sonner } from "@/components/ui/sonner";
import { Text } from "@/components/ui/text";
import { useAppActive } from "@/hooks/use-app-active";
import { useMedia } from "@/hooks/use-media";
import { useTheme } from "@/hooks/use-theme";
import { createCaptureGesture, type VideoIntent } from "@/lib/capture-gesture";
import {
  compressPhoto,
  deleteTemporaryFile,
  discardDraft,
  prepareVideo,
  thumbnailUri,
} from "@/lib/media-files";
import { formatBytes, formatDuration, MEDIA_LIMITS } from "@/lib/media-policy";
import { hapticButtonPress } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import type { MediaDraft, MediaKind } from "@/types/media";

const StyledCameraView = withUniwind(CameraView);
// iOS Simulator capture sessions can time out during startup and preview teardown.
const cameraSupported = Platform.OS !== "ios" || isDevice;

export default function RecordScreen() {
  const theme = useTheme();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const [permission, requestPermission, refreshPermission] =
    useCameraPermissions();
  const [microphone, requestMicrophone, refreshMicrophone] =
    useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const mounted = useRef(true);
  const operation = useRef<object | null>(null);
  const gesture = useRef(createCaptureGesture());
  const stopRecording = useRef<(() => void) | null>(null);
  const requestingMicrophone = useRef(false);
  const startedAt = useRef(0);
  const draftRef = useRef<MediaDraft | null>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [mode, setMode] = useState<MediaKind>("photo");
  const [flash, setFlash] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const [startingVideo, setStartingVideo] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useMedia((state) => state.queue);
  const latest = useMedia((state) =>
    state.items.find((item) => item.direction === "outgoing"),
  );
  const cameraActive =
    cameraSupported && focused && appActive && !draft && permission?.granted;
  const attachCamera = useCallback((instance: CameraView | null) => {
    camera.current = instance;
    setReady(false);
  }, []);

  useEffect(() => {
    const captureGesture = gesture.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureGesture.cancel();
      stopRecording.current?.();
      if (draftRef.current) discardDraft(draftRef.current);
    };
  }, []);
  useEffect(() => {
    if (focused && appActive) {
      void refreshPermission().catch(() => undefined);
      void refreshMicrophone().catch(() => undefined);
    }
  }, [focused, appActive, refreshPermission, refreshMicrophone]);
  useEffect(() => {
    if (!focused || !appActive) return;
    const captureGesture = gesture.current;
    return () => {
      const intent = captureGesture.cancel();
      stopRecording.current?.();
      if (intent && !intent.started && operation.current === intent)
        operation.current = null;
      if (mounted.current) {
        setStartingVideo(false);
        setReady(false);
        setMode("photo");
      }
    };
  }, [focused, appActive]);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () =>
        setElapsed(
          Math.min(
            MEDIA_LIMITS.videoSeconds,
            Math.floor((Date.now() - startedAt.current) / 1000),
          ),
        ),
      200,
    );
    return () => clearInterval(timer);
  }, [recording]);

  function showDraft(value: MediaDraft) {
    if (!mounted.current) {
      discardDraft(value);
      return;
    }
    draftRef.current = value;
    setDraft(value);
  }
  function retake() {
    if (saving || !draft) return;
    discardDraft(draft);
    draftRef.current = null;
    setDraft(null);
    setReady(false);
  }
  async function capturePhoto(fromAccessibility = false) {
    if (
      operation.current ||
      requestingMicrophone.current ||
      !cameraActive ||
      !ready ||
      !camera.current ||
      mode !== "photo" ||
      !gesture.current.takePhoto(fromAccessibility)
    )
      return;
    const capture = {};
    operation.current = capture;
    hapticButtonPress();
    let sourceUri: string | undefined;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.7,
        exif: false,
      });
      sourceUri = photo.uri;
      showDraft(await compressPhoto(photo.uri, photo.width, photo.height));
    } catch (error) {
      if (mounted.current)
        sonner.error(
          error instanceof Error
            ? error.message
            : "Couldn’t capture. Try again.",
        );
    } finally {
      deleteTemporaryFile(sourceUri);
      if (operation.current === capture) operation.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  function cancelVideo() {
    const intent = gesture.current.cancel();
    if (!intent) return;
    if (intent.started) {
      stopRecording.current?.();
      return;
    }
    if (operation.current === intent) operation.current = null;
    setStartingVideo(false);
    setReady(false);
    setMode("photo");
  }

  function releaseShutter() {
    const intent = gesture.current.pressOut();
    if (!intent) return;
    if (intent.started) stopRecording.current?.();
    else cancelVideo();
  }

  async function beginVideo(requiresHold = true) {
    if (
      operation.current ||
      requestingMicrophone.current ||
      !cameraActive ||
      !ready ||
      !camera.current
    )
      return;
    const intent = gesture.current.beginVideo(requiresHold);
    if (!intent) return;
    operation.current = intent;
    setStartingVideo(true);
    hapticButtonPress();
    if (
      !microphone ||
      (microphone.status === "undetermined" && microphone.canAskAgain)
    ) {
      // A system prompt interrupts touch tracking; the next hold records.
      requestingMicrophone.current = true;
      try {
        await requestMicrophone();
      } catch {
        if (mounted.current) sonner.info("Recording without sound");
      } finally {
        requestingMicrophone.current = false;
        gesture.current.finish(intent);
        if (operation.current === intent) operation.current = null;
        if (mounted.current) setStartingVideo(false);
      }
      return;
    }
    // Photo and video use different native outputs on both platforms.
    // Start from onCameraReady after remounting the video camera.
    setReady(false);
    setMode("video");
  }

  async function captureVideo(intent: VideoIntent) {
    const instance = camera.current;
    if (!cameraActive || !instance || !gesture.current.startVideo(intent))
      return;
    let stopTimer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (stopTimer) return;
      instance.stopRecording();
      // Native recording startup is asynchronous on iOS. Retry until its
      // promise settles so a release during startup cannot be missed.
      stopTimer = setInterval(() => instance.stopRecording(), 100);
    };
    stopRecording.current = stop;
    setStartingVideo(false);
    setRecording(true);
    setElapsed(0);
    startedAt.current = Date.now();
    let sourceUri: string | undefined;
    try {
      const result = await instance.recordAsync({
        maxDuration: MEDIA_LIMITS.videoSeconds,
        maxFileSize: MEDIA_LIMITS.videoBytes,
        ...(Platform.OS === "ios" ? { codec: "avc1" as const } : {}),
      });
      clearInterval(stopTimer);
      if (stopRecording.current === stop) stopRecording.current = null;
      if (mounted.current) {
        setRecording(false);
        setBusy(true);
      }
      if (result) {
        sourceUri = result.uri;
        showDraft(await prepareVideo(result.uri));
        sourceUri = undefined;
      }
    } catch (error) {
      if (mounted.current && !intent.cancelled)
        sonner.error(
          error instanceof Error
            ? error.message
            : "Couldn’t record. Try again.",
        );
    } finally {
      clearInterval(stopTimer);
      deleteTemporaryFile(sourceUri);
      if (stopRecording.current === stop) stopRecording.current = null;
      gesture.current.finish(intent);
      if (operation.current === intent) operation.current = null;
      if (mounted.current) {
        setBusy(false);
        setStartingVideo(false);
        setRecording(false);
        setReady(false);
        setMode("photo");
      }
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await queue(draft);
      discardDraft(draft);
      draftRef.current = null;
      if (mounted.current) {
        setDraft(null);
        setReady(false);
        sonner.success("Added to queue");
      }
    } catch (error) {
      if (mounted.current)
        sonner.error(
          error instanceof Error ? error.message : "Couldn’t save. Try again.",
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const controlsDisabled =
    busy || startingVideo || recording || !cameraActive || !ready;
  const shutterDisabled =
    busy ||
    !cameraActive ||
    cameraError ||
    (!ready && !startingVideo && !recording);
  const latestThumbnail = latest ? thumbnailUri(latest) : undefined;

  return (
    <TabScreen>
      <View className="flex-1 w-full max-w-[600px] self-center px-3 pt-2">
        <View
          className="min-h-40 flex-1 overflow-hidden rounded-[28px] bg-card"
          style={{ borderCurve: "continuous" }}
        >
          {draft ? (
            focused && appActive ? (
              <MediaPreview key={draft.uri} uri={draft.uri} kind={draft.kind} />
            ) : (
              <View className="flex-1" />
            )
          ) : !cameraSupported ? (
            <View className="flex-1 items-center justify-center p-6">
              <View className="mb-5">
                <StateIllustration kind="capture" />
              </View>
              <Text className="text-lg font-medium">Camera unavailable</Text>
              <Text className="mt-2 text-center text-sm text-muted-foreground">
                Use a physical device to capture
              </Text>
            </View>
          ) : permission === null ? (
            <View className="flex-1 items-center justify-center p-6">
              <ActivityIndicator
                color={theme.foreground}
                accessibilityLabel="Loading camera"
              />
            </View>
          ) : !permission.granted || cameraError ? (
            <View className="flex-1 items-center justify-center p-6">
              <View className="mb-5">
                <StateIllustration
                  kind={cameraError ? "capture" : "permissions"}
                />
              </View>
              {cameraError ? (
                <Text className="mb-5 text-lg font-medium">
                  Camera unavailable
                </Text>
              ) : null}
              <Button
                onPress={() => {
                  if (cameraError) {
                    setCameraError(false);
                    setReady(false);
                    setCameraSession((value) => value + 1);
                  } else if (permission.canAskAgain)
                    void requestPermission().catch(() =>
                      sonner.error("Couldn’t request camera access."),
                    );
                  else
                    void Linking.openSettings().catch(() =>
                      sonner.error(
                        "Open device settings to allow camera access.",
                      ),
                    );
                }}
              >
                {cameraError
                  ? "Try again"
                  : permission.canAskAgain
                    ? "Enable camera"
                    : "Open settings"}
              </Button>
            </View>
          ) : cameraActive ? (
            <CaptureCamera
              key={`${mode}-${facing}-${!!microphone?.granted}-${cameraSession}`}
              attach={attachCamera}
              className="absolute inset-0"
              facing={facing}
              mode={mode === "photo" ? "picture" : "video"}
              mirror={facing === "front"}
              flash={flash && facing === "back" ? "on" : "off"}
              enableTorch={mode === "video" && flash && facing === "back"}
              mute={!microphone?.granted}
              videoQuality="480p"
              videoBitrate={MEDIA_LIMITS.videoBitrate}
              onReady={(instance) => {
                if (camera.current !== instance) return;
                setReady(true);
                setCameraError(false);
                const intent = gesture.current.video;
                if (mode === "video" && intent) void captureVideo(intent);
              }}
              onMountError={() => {
                cancelVideo();
                setCameraError(true);
                setReady(false);
              }}
            />
          ) : null}
          {!draft && cameraSupported && permission?.granted && !cameraError ? (
            <View className="absolute left-4 right-4 top-4 flex-row items-center justify-between">
              <Button
                variant="surface"
                size="icon"
                tintColor="#00000060"
                disabled={controlsDisabled || facing === "front"}
                accessibilityLabel={flash ? "Turn flash off" : "Turn flash on"}
                accessibilityState={{ selected: flash }}
                onPress={() => setFlash((value) => !value)}
              >
                <Icon
                  name={flash ? "zap" : "zap-off"}
                  size={20}
                  color="#ffffff"
                />
              </Button>
              {recording ? (
                <View className="h-9 flex-row items-center gap-2 rounded-3xl bg-[#00000060] px-3.5">
                  <View className="size-[7px] rounded-full bg-destructive" />
                  <Text className="text-[13px] font-medium tabular-nums text-white">
                    {formatDuration(elapsed)}
                  </Text>
                  {!microphone?.granted ? (
                    <Icon name="mic-off" size={14} color="#ffffff" />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {busy ? (
            <View className="absolute inset-0 items-center justify-center gap-3 bg-[#00000090]">
              <ActivityIndicator color="#ffffff" />
              <Text className="text-[13px] font-medium tabular-nums text-white">
                Preparing
              </Text>
            </View>
          ) : null}
          {draft ? (
            <View className="absolute bottom-4 self-center flex-row items-center gap-1.5 rounded-[20px] bg-[#00000080] px-3 py-[7px]">
              <Icon name="check" size={14} color="#ffffff" />
              <Text className="text-[13px] font-medium tabular-nums text-white">
                {formatBytes(draft.bytes)}
                {draft.duration ? ` · ${formatDuration(draft.duration)}` : ""}
              </Text>
            </View>
          ) : null}
        </View>
        {draft ? (
          <View className="flex-row items-center gap-3 px-3 py-6">
            <Button
              variant="surface"
              disabled={saving}
              onPress={retake}
              containerClassName="flex-1"
            >
              Retake
            </Button>
            <Button
              onPress={() => void save()}
              loading={saving}
              containerClassName="flex-[2]"
            >
              <Icon name="arrow-up" size={18} color={theme.primaryForeground} />
              Queue to share
            </Button>
          </View>
        ) : (
          <View className="items-center gap-4 pb-[18px] pt-4">
            <View className="w-full max-w-[330px] flex-row items-center justify-between px-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View queued media"
                onPress={() =>
                  router.navigate({
                    pathname: "/(tabs)/inbox",
                    params: { view: "queued" },
                  })
                }
                disabled={startingVideo || recording || busy}
                className="size-12 items-center justify-center overflow-hidden rounded-tile border border-border bg-card active:opacity-60"
              >
                {latestThumbnail ? (
                  <Image
                    source={{ uri: latestThumbnail }}
                    className="absolute inset-0"
                    resizeMode="cover"
                  />
                ) : (
                  <Icon name="images" size={21} color={theme.mutedForeground} />
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  startingVideo || recording ? "Stop recording" : "Capture"
                }
                accessibilityHint="Tap for a photo. Hold to record video, release to stop. Maximum 60 seconds."
                accessibilityState={{ disabled: shutterDisabled, busy }}
                accessibilityActions={
                  startingVideo || recording
                    ? [
                        { name: "activate", label: "Stop recording" },
                        { name: "stopVideo", label: "Stop recording" },
                      ]
                    : [
                        { name: "activate", label: "Take photo" },
                        { name: "recordVideo", label: "Record video" },
                      ]
                }
                onAccessibilityAction={({ nativeEvent }) => {
                  if (shutterDisabled) return;
                  if (nativeEvent.actionName === "activate") {
                    if (startingVideo || recording) cancelVideo();
                    else void capturePhoto(true);
                  } else if (nativeEvent.actionName === "recordVideo")
                    void beginVideo(false);
                  else if (nativeEvent.actionName === "stopVideo")
                    cancelVideo();
                }}
                disabled={shutterDisabled}
                delayLongPress={300}
                onPressIn={() => {
                  if (!operation.current) gesture.current.pressIn();
                }}
                onLongPress={() => void beginVideo()}
                onPressOut={releaseShutter}
                onPress={() => {
                  if (startingVideo || stopRecording.current) cancelVideo();
                  else void capturePhoto();
                }}
                className={cn(
                  "size-[76px] items-center justify-center rounded-full border-[3px] active:opacity-65 disabled:opacity-25",
                  startingVideo || recording
                    ? "border-destructive"
                    : "border-foreground",
                )}
              >
                <View
                  className={cn(
                    "items-center justify-center",
                    startingVideo || recording
                      ? "bg-destructive"
                      : "bg-foreground",
                    recording ? "size-7 rounded-[7px]" : "size-14 rounded-full",
                  )}
                >
                  {startingVideo ? <ActivityIndicator color="#ffffff" /> : null}
                </View>
              </Pressable>
              <Button
                variant="surface"
                size="icon-lg"
                disabled={controlsDisabled}
                accessibilityLabel="Flip camera"
                onPress={() => {
                  setReady(false);
                  setFacing((value) => (value === "back" ? "front" : "back"));
                }}
              >
                <Icon name="switch-camera" size={23} color={theme.foreground} />
              </Button>
            </View>
          </View>
        )}
      </View>
    </TabScreen>
  );
}

function CaptureCamera({
  attach,
  onReady,
  onMountError,
  ...props
}: Omit<CameraViewProps, "onCameraReady"> & {
  className?: string;
  attach: (instance: CameraView | null) => void;
  onReady: (instance: CameraView) => void;
}) {
  const instance = useRef<CameraView | null>(null);
  const attachInstance = useCallback(
    (value: CameraView | null) => {
      instance.current = value;
      attach(value);
    },
    [attach],
  );
  return (
    <StyledCameraView
      {...props}
      ref={attachInstance}
      onCameraReady={() => {
        // Ignore late native events from an unmounted photo/video output.
        if (instance.current) onReady(instance.current);
      }}
      onMountError={(error) => {
        if (instance.current) onMountError?.(error);
      }}
    />
  );
}
