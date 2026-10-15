const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Freeze a compact, readable local date and 12-hour time into the pixels. */
export function formatCaptureStamp(createdAt: number) {
  const date = new Date(createdAt);
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    !Number.isFinite(date.getTime())
  )
    throw new Error("Invalid capture time.");
  const pad = (value: number) => String(value).padStart(2, "0");
  const hour = date.getHours();
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}\n${hour % 12 || 12}:${pad(date.getMinutes())} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatCaptureDateTime(createdAt: number) {
  return new Date(createdAt).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
