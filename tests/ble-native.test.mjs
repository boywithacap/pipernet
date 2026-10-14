import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const shared = resolve("modules/ble-transport/shared");
test("vendored Noise sources match the pinned upstream revision", () => {
  const manifest = JSON.parse(
    readFileSync(join(shared, "vendor/noise/manifest.json"), "utf8"),
  );
  for (const [path, hash] of Object.entries(manifest.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(shared, "vendor/noise", path)))
        .digest("hex"),
      hash,
      path,
    );
});
test("native BLE engine passes crypto vectors and interrupted file transfers under sanitizers", () => {
  const directory = mkdtempSync(join(tmpdir(), "pipernet-ble-"));
  try {
    const sources = JSON.parse(
      readFileSync(join(shared, "sources.json"), "utf8"),
    );
    const binary = join(directory, "ble-tests");
    const compile = spawnSync(
      "clang",
      [
        "-std=c11",
        "-g",
        "-fsanitize=address,undefined",
        "-fno-omit-frame-pointer",
        "-Wno-expansion-to-defined",
        "-DED25519_CUSTOMHASH",
        "-DED25519_CUSTOMRANDOM",
        ...[
          ".",
          "vendor/noise/include",
          "vendor/noise/src",
          "vendor/noise/src/protocol",
        ].map((p) => `-I${join(shared, p)}`),
        ...sources.map((p) => join(shared, p)),
        resolve("tests/native/ble-core.c"),
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(compile.status, 0, compile.stderr || String(compile.error));
    const run = spawnSync(binary, [directory], {
      encoding: "utf8",
      env: { ...process.env, UBSAN_OPTIONS: "halt_on_error=1" },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
