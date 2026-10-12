import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { patchNearbyAllocator } from "../scripts/prepare-nearby-ios.mjs";

// Minimal allocator with the same symbol layout as Nearby's pinned SSL package.
const allocator = `
#include <stdlib.h>
#define OPENSSL_MALLOC_PREFIX 0
void sdallocx(void *ptr, size_t size, int flags);
__attribute((weak, noinline))
void sdallocx(void *ptr, size_t size, int flags) { free(ptr); }
void release_buffer(void *ptr, size_t size) {
  sdallocx(ptr, size + OPENSSL_MALLOC_PREFIX, 0);
}
`;

test("Nearby's allocator remains callable when Folly exports a variable with the original symbol name", () => {
  const directory = mkdtempSync(join(tmpdir(), "pipernet-allocator-"));
  try {
    writeFileSync(
      join(directory, "allocator.c"),
      patchNearbyAllocator(allocator),
    );
    writeFileSync(
      join(directory, "folly.c"),
      `
#include <stdlib.h>
void (*sdallocx)(void *, size_t, int) = NULL;
void release_buffer(void *, size_t);
int main(void) { release_buffer(malloc(32), 32); return 0; }
`,
    );
    const binary = join(directory, "allocator-check");
    const compile = spawnSync(
      "cc",
      [
        join(directory, "allocator.c"),
        join(directory, "folly.c"),
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(compile.status, 0, compile.stderr);
    assert.equal(spawnSync(binary).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the allocator patch is idempotent and refuses partial patches or dependency drift", () => {
  const patched = patchNearbyAllocator(allocator);
  assert.equal(patchNearbyAllocator(patched), patched);
  assert.throws(
    () =>
      patchNearbyAllocator(
        allocator.replace("__attribute((weak, noinline))", ""),
      ),
    /allocator changed/,
  );
  assert.throws(
    () =>
      patchNearbyAllocator(
        allocator.replace("void sdallocx", "void pipernet_boringssl_sdallocx"),
      ),
    /allocator changed/,
  );
});
