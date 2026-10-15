import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCaptureStamp } from "../src/lib/capture-time";

test("capture stamps use readable local dates and 12-hour times", () => {
  for (const [hour, minute, expected] of [
    [0, 5, "12:05 AM"],
    [10, 8, "10:08 AM"],
    [12, 0, "12:00 PM"],
    [13, 9, "1:09 PM"],
    [23, 40, "11:40 PM"],
  ] as const) {
    const captured = new Date(2026, 9, 14, hour, minute, 35).getTime();
    assert.equal(formatCaptureStamp(captured), `14 Oct 2026\n${expected}`);
  }
  assert.equal(
    formatCaptureStamp(new Date(2027, 0, 1, 0, 0).getTime()),
    "1 Jan 2027\n12:00 AM",
  );
});

test("capture stamps reject invalid timestamps before native processing", () => {
  for (const value of [NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => formatCaptureStamp(value), /Invalid capture time/);
  }
});
