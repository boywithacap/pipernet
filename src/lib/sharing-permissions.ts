import type { MeshTransport } from "../types/mesh";
import { checkPermissionTask } from "./permission-errors";

/** Resolve native prompts during onboarding without enabling auto-sharing. */
export async function requestSharingAccess({
  transport,
  requestPermissions,
  waitUntilActive,
  signal,
}: {
  transport: Pick<MeshTransport, "available" | "start" | "stop">;
  requestPermissions: () => Promise<void>;
  waitUntilActive?: () => Promise<void>;
  signal?: AbortSignal;
}) {
  checkPermissionTask(signal);
  if (!transport.available)
    throw new Error("Bluetooth sharing needs an updated PiperNet app.");
  await requestPermissions();
  checkPermissionTask(signal);
  // Android may resolve its permission promise before the permission activity closes.
  await waitUntilActive?.();
  checkPermissionTask(signal);
  try {
    // Starting Bluetooth resolves its platform radio prompts.
    // No peer connections or media transfers are started by this check.
    await transport.start("PiperNet setup");
    checkPermissionTask(signal);
  } catch (error) {
    // Preserve the reason startup failed, even if stopping an interrupted session also fails.
    await transport.stop().catch(() => undefined);
    throw error;
  }
  await transport.stop();
  checkPermissionTask(signal);
}
