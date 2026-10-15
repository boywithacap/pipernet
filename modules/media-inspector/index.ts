import { requireOptionalNativeModule } from "expo-modules-core";

export type MediaInspection = {
  kind: "photo" | "video";
  width: number;
  height: number;
  duration?: number;
  bytes: number;
};

type PiperMediaInspector = {
  hashFile(uri: string): Promise<{ hash: string; bytes: number }>;
  inspectMedia(uri: string): Promise<MediaInspection>;
};

export default requireOptionalNativeModule<PiperMediaInspector>(
  "PiperMediaInspector",
);
