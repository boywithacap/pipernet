import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { withUniwind } from "uniwind";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import type { MediaKind } from "@/types/media";

const StyledVideoView = withUniwind(VideoView);

export function MediaPreview({ uri, kind }: { uri: string; kind: MediaKind }) {
  const [failed, setFailed] = useState(false);
  if (kind === "video") return <VideoPreview uri={uri} />;
  return (
    <View className="flex-1 items-center justify-center bg-black">
      <Image
        source={{ uri }}
        className="absolute inset-0"
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
      {failed ? <Unavailable /> : null}
    </View>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const [loadError, setLoadError] = useState(false);
  // Load asynchronously so opening media doesn't block the iOS UI thread.
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  useEffect(() => {
    let cancelled = false;
    void player.replaceAsync(uri).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") player.pause();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [player, uri]);

  return (
    <View className="flex-1 items-center justify-center bg-black">
      <StyledVideoView
        player={player}
        className="absolute inset-0"
        contentFit="contain"
        nativeControls
      />
      {status === "loading" ? (
        <ActivityIndicator color="#ffffff" accessibilityLabel="Loading video" />
      ) : null}
      {loadError || status === "error" ? <Unavailable /> : null}
    </View>
  );
}

function Unavailable() {
  return (
    <View
      className="absolute inset-0 items-center justify-center bg-black"
      accessibilityRole="alert"
    >
      <Icon name="image-off" size={30} color="#8e8e93" />
      <Text className="mt-3 text-white">Media unavailable</Text>
    </View>
  );
}
