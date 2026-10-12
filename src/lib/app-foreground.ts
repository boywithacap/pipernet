import { checkPermissionTask } from "./permission-errors";

export async function waitForForeground({
  isActive,
  subscribe,
  signal,
  timeoutMs = 15000,
}: {
  isActive: () => boolean;
  subscribe: (listener: () => void) => () => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  checkPermissionTask(signal);
  if (isActive()) return;
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      try {
        checkPermissionTask(signal);
      } catch (error) {
        finish(error);
      }
    };
    const changed = () => {
      if (isActive()) finish();
    };
    unsubscribe = subscribe(changed);
    if (settled) {
      unsubscribe();
      return;
    }
    timer = setTimeout(
      () => finish(new Error("Return to PiperNet and try again.")),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel);
    // Recheck after subscribing so a resume between the first check and listener is not lost.
    if (signal?.aborted) cancel();
    else changed();
  });
}
