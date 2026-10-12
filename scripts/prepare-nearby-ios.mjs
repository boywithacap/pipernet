import {
  chmodSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Nearby's pinned BoringSSL 0.7.x exports a weak sdallocx function. Folly
// exports a variable with that name, causing OPENSSL_free to call data as code.
// Namespace only this allocator fallback; cryptographic operations stay intact.
export function patchNearbyAllocator(source) {
  const originalCalls = (source.match(/\bsdallocx\s*\(/g) ?? []).length;
  const patchedCalls = (
    source.match(/\bpipernet_boringssl_sdallocx\s*\(/g) ?? []
  ).length;
  if (patchedCalls === 3 && originalCalls === 0) return source;
  if (
    originalCalls !== 3 ||
    patchedCalls !== 0 ||
    !source.includes("__attribute((weak, noinline))") ||
    !source.includes("sdallocx(ptr, size + OPENSSL_MALLOC_PREFIX, 0")
  )
    throw new Error(
      "Nearby's SSL allocator changed; review the React Native compatibility patch.",
    );
  return source.replace(/\bsdallocx(?=\s*\()/g, "pipernet_boringssl_sdallocx");
}

function command(executable, args) {
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${executable} failed (${result.status}).`);
}

function prepare() {
  if (process.env.EAS_BUILD_PLATFORM !== "ios") return;
  const ios = resolve("ios");
  const workspaces = readdirSync(ios).filter((name) =>
    name.endsWith(".xcworkspace"),
  );
  if (workspaces.length !== 1)
    throw new Error("Expected one generated iOS workspace.");
  const packages = "/tmp/pipernet-swift-packages";
  command("xcodebuild", [
    "-resolvePackageDependencies",
    "-workspace",
    join(ios, workspaces[0]),
    "-scheme",
    basename(workspaces[0], ".xcworkspace"),
    "-clonedSourcePackagesDirPath",
    packages,
  ]);
  const checkouts = join(packages, "checkouts");
  const ssl = readdirSync(checkouts).find(
    (name) => name.toLowerCase() === "boringssl-swiftpm",
  );
  if (!ssl) throw new Error("Nearby's SSL checkout was not resolved.");
  const allocator = join(checkouts, ssl, "src", "crypto", "mem.c");
  const source = readFileSync(allocator, "utf8");
  const patched = patchNearbyAllocator(source);
  chmodSync(allocator, statSync(allocator).mode | 0o200);
  writeFileSync(allocator, patched);
  // Gym must use the checkout we patched and avoid replacing it during resolution.
  command("set-env", ["GYM_CLONED_SOURCE_PACKAGES_PATH", packages]);
  command("set-env", ["GYM_SKIP_PACKAGE_DEPENDENCIES_RESOLUTION", "true"]);
  command("set-env", ["GYM_DISABLE_PACKAGE_AUTOMATIC_UPDATES", "true"]);
  console.log("Patched Nearby's SSL allocator collision with React Native.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepare();
