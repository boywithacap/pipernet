import { checkPermissionTask } from "./permission-errors";

type SharingOptions = { enabled: boolean; relay: boolean };

export async function finishNearbyOnboarding({
  requestAccess,
  configure,
  previous,
  complete,
  signal,
}: {
  requestAccess: () => Promise<void>;
  configure: (options: SharingOptions) => Promise<void>;
  previous: SharingOptions;
  complete: () => Promise<void>;
  signal?: AbortSignal;
}) {
  checkPermissionTask(signal);
  await requestAccess();
  checkPermissionTask(signal);
  await configure({ enabled: true, relay: true });
  try {
    checkPermissionTask(signal);
    await complete();
  } catch (error) {
    // A failed/cancelled finish must not leave sharing enabled behind onboarding.
    await configure(previous);
    throw error;
  }
}
