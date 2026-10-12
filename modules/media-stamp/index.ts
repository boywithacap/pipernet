import { requireOptionalNativeModule } from "expo-modules-core";

type PiperMediaStamp = {
  stampPhoto(uri: string, text: string, quality: number): Promise<string>;
  stampVideo(uri: string, text: string): Promise<string>;
};

export default requireOptionalNativeModule<PiperMediaStamp>("PiperMediaStamp");
