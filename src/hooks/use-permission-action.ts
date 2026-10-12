import { useCallback, useEffect, useRef, useState } from "react";
import { checkPermissionTask } from "@/lib/permission-errors";

/** One user-initiated request at a time; a departed screen cannot finish onboarding. */
export function usePermissionAction() {
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancel = useCallback(() => pending.current?.abort(), []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  const run = useCallback(
    async (action: (signal: AbortSignal) => Promise<void>) => {
      if (pending.current || !mounted.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      setError(null);
      try {
        await action(controller.signal);
        checkPermissionTask(controller.signal);
      } catch (error) {
        if (mounted.current && !controller.signal.aborted) setError(error);
      } finally {
        if (pending.current === controller) pending.current = null;
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, run, cancel };
}
