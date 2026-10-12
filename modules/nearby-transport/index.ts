import {
  requireOptionalNativeModule,
  type NativeModule,
} from "expo-modules-core";
import type { TransportEvent } from "../../src/types/mesh";

export type MediaInspection = {
  kind: "photo" | "video";
  width: number;
  height: number;
  duration?: number;
  bytes: number;
};
type PiperNearby = InstanceType<
  NativeModule<{ onEvent: (event: TransportEvent) => void }>
> & {
  start(name: string): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string): Promise<void>;
  verify(peerId: string, accept: boolean): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  sendControl(peerId: string, text: string): Promise<void>;
  expectFile(peerId: string, bytes: number): Promise<void>;
  sendFile(peerId: string, uri: string): Promise<void>;
  cancelFile(peerId: string): Promise<void>;
  hashFile(uri: string): Promise<{ hash: string; bytes: number }>;
  inspectMedia(uri: string): Promise<MediaInspection>;
};

export default requireOptionalNativeModule<PiperNearby>("PiperNearby");
