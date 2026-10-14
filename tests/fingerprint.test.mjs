import assert from "node:assert/strict";
import {
  readFileSync,
  symlinkSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFingerprintAsync } from "expo/fingerprint";
import { test } from "node:test";

import config from "../fingerprint.config.js";

test(
  "shared BLE native changes invalidate both platform runtimes",
  { timeout: 30000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "pipernet-fingerprint-"));
    try {
      symlinkSync(
        new URL("../node_modules", import.meta.url),
        join(root, "node_modules"),
        "dir",
      );
      writeFileSync(
        join(root, "package.json"),
        '{"name":"ble-fixture","version":"1.0.0"}',
      );
      writeFileSync(
        join(root, "fingerprint.config.js"),
        readFileSync(new URL("../fingerprint.config.js", import.meta.url)),
      );
      const source = join(root, "modules/ble-transport/shared/PiperBle.c");
      mkdirSync(join(root, "modules/ble-transport/shared"), {
        recursive: true,
      });
      for (const platform of ["ios", "android"]) {
        writeFileSync(source, "int protocol_version = 1;\n");
        const before = await createFingerprintAsync(root, {
          platforms: [platform],
          useRNCoreAutolinkingFromExpo: true,
        });
        assert.ok(
          before.sources.some(
            (s) => s.filePath === "modules/ble-transport/shared" && s.hash,
          ),
        );
        writeFileSync(source, "int protocol_version = 2;\n");
        const after = await createFingerprintAsync(root, {
          platforms: [platform],
          useRNCoreAutolinkingFromExpo: true,
        });
        assert.notEqual(after.hash, before.hash, platform);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

function normalize(path, text) {
  const source = { type: "file", filePath: path };
  const bytes = Buffer.from(text);
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 17) {
    result +=
      config.fileHookTransform(
        source,
        bytes.subarray(offset, offset + 17),
        false,
      ) ?? "";
  }
  return result + (config.fileHookTransform(source, null, true) ?? "");
}

test("submission metadata keeps compatibility while native build settings change it", () => {
  const eas = JSON.parse(
    readFileSync(new URL("../eas.json", import.meta.url), "utf8"),
  );
  const original = normalize("eas.json", JSON.stringify(eas));
  eas.submit.production.ios = {
    ascAppId: "another-app",
    appleTeamId: "another-team",
  };
  eas.submit.preview = { ios: { ascAppId: "preview-app" } };
  assert.equal(normalize("eas.json", JSON.stringify(eas)), original);
  eas.build.production.env = { NATIVE_FEATURE: "enabled" };
  assert.notEqual(normalize("eas.json", JSON.stringify(eas)), original);
});

test("ignore rules remain part of the native fingerprint", () => {
  const original = "node_modules/\n/ios/\n/android/\n";
  assert.equal(normalize(".gitignore", original), original);
  assert.notEqual(
    normalize(".gitignore", original + ".metro-health-check*\n.kotlin/\n"),
    original,
  );
  assert.notEqual(normalize(".gitignore", original + "modules/\n"), original);
});

test("concurrent platform fingerprints keep their input streams separate", () => {
  const first = { type: "file", filePath: "eas.json" };
  const second = { type: "file", filePath: "eas.json" };
  const firstInput = '{"build":{"production":{"env":{"FEATURE":"first"}}}}';
  const secondInput = '{"build":{"production":{"env":{"FEATURE":"second"}}}}';
  for (
    let index = 0;
    index < Math.max(firstInput.length, secondInput.length);
    index++
  ) {
    config.fileHookTransform(
      first,
      Buffer.from(firstInput.slice(index, index + 1)),
      false,
    );
    config.fileHookTransform(
      second,
      Buffer.from(secondInput.slice(index, index + 1)),
      false,
    );
  }
  const firstResult = JSON.parse(config.fileHookTransform(first, null, true));
  const secondResult = JSON.parse(config.fileHookTransform(second, null, true));
  assert.equal(firstResult.build.production.env.FEATURE, "first");
  assert.equal(secondResult.build.production.env.FEATURE, "second");
});

test("native code and app configuration are fingerprinted unchanged", () => {
  for (const path of [
    "modules/media-stamp/ios/PiperMediaStampModule.swift",
    "app.json",
  ]) {
    const chunk = Buffer.from("native input");
    assert.equal(
      config.fileHookTransform({ type: "file", filePath: path }, chunk, false),
      chunk,
    );
  }
  const contents = '{"plugins":["new-native-module"]}';
  assert.equal(
    config.fileHookTransform(
      { type: "contents", id: "expoConfig" },
      contents,
      true,
    ),
    contents,
  );
});
