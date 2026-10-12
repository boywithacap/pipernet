export class PermissionDeniedError extends Error {
  constructor(
    message: string,
    readonly canAskAgain: boolean,
  ) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function checkPermissionTask(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("Permission request cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

export function permissionErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Couldn’t check access. Try again.";
}
