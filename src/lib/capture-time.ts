/** Freeze local wall time and its UTC offset into the media itself. */
export function formatCaptureStamp(createdAt: number) {
  const date = new Date(createdAt);
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    !Number.isFinite(date.getTime())
  )
    throw new Error("Invalid capture time.");
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}\n${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
}

export function formatCaptureDateTime(createdAt: number) {
  return new Date(createdAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
