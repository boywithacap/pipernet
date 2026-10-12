import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const template = fileURLToPath(new URL("..", import.meta.url));
const script = join(template, "scripts/create-project.mjs");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const run = (...args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("creates an independent starter with fresh identity and no generated files", () => {
  const temp = mkdtempSync(join(tmpdir(), "expo-template-test-"));
  try {
    const destination = join(temp, "my-app");
    const result = run(destination, "com.example.myapp", 'My "New" App');
    assert.equal(result.status, 0, result.stderr);
    const config = readJson(join(destination, "app.json")).expo;
    assert.equal(config.name, 'My "New" App');
    assert.equal(config.scheme, "my-app");
    assert.equal(config.slug, "my-app");
    assert.equal(config.ios.bundleIdentifier, "com.example.myapp");
    assert.equal(config.android.package, "com.example.myapp");
    assert.equal(config.extra?.eas, undefined);
    assert.equal(config.updates, undefined);
    assert.equal(
      readJson(join(destination, "eas.json")).submit?.production?.ios?.ascAppId,
      undefined,
    );
    assert.equal(readJson(join(destination, "package.json")).name, "my-app");
    assert.match(
      readFileSync(join(destination, "src/constants/app.ts"), "utf8"),
      /"storagePrefix": "my-app"/,
    );
    assert.match(
      readFileSync(join(destination, "bun.lock"), "utf8"),
      /"name": "my-app"/,
    );
    assert.ok(existsSync(join(destination, "src/components/ui/button.tsx")));
    assert.ok(
      existsSync(
        join(
          destination,
          "modules/nearby-transport/ios/PiperNearbyModule.swift",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(destination, "modules/nearby-transport/android/build.gradle"),
      ),
    );
    for (const name of [
      "node_modules",
      ".git",
      ".expo",
      "dist",
      "ios",
      "android",
    ]) {
      assert.equal(existsSync(join(destination, name)), false, name);
    }
    const before = readFileSync(join(destination, "app.json"), "utf8");
    assert.notEqual(run(destination, "com.example.other").status, 0);
    assert.equal(readFileSync(join(destination, "app.json"), "utf8"), before);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("rejects unsafe destinations and invalid identity before copying", () => {
  const temp = mkdtempSync(join(tmpdir(), "expo-template-invalid-"));
  try {
    assert.notEqual(
      run(join(template, "nested-app"), "com.example.app").status,
      0,
    );
    assert.equal(existsSync(join(template, "nested-app")), false);
    const alias = join(temp, "alias");
    symlinkSync(template, alias, "dir");
    assert.notEqual(
      run(join(alias, "nested-app"), "com.example.app").status,
      0,
    );
    assert.equal(existsSync(join(template, "nested-app")), false);
    for (const identifier of [
      "invalid",
      "com.example.my_app",
      "Com.Example.App",
    ]) {
      assert.notEqual(run(join(temp, "my-app"), identifier).status, 0);
      assert.equal(existsSync(join(temp, "my-app")), false);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
