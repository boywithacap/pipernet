import {
  requireOptionalNativeModule,
  type NativeModule,
} from "expo-modules-core";
import type { TransportEvent } from "../../src/types/mesh";

type PiperBle = InstanceType<
  NativeModule<{ onEvent: (event: TransportEvent) => void }>
> & {
  start(name: string): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string): Promise<void>;
  verify(peerId: string, accept: boolean): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  sendControl(peerId: string, text: string): Promise<void>;
  expectFile(peerId: string, bytes: number, hash: string): Promise<void>;
  sendFile(peerId: string, uri: string, hash: string): Promise<void>;
  cancelFile(peerId: string): Promise<void>;
};
export default requireOptionalNativeModule<PiperBle>("PiperBle");
