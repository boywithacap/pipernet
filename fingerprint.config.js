const pendingFiles = new WeakMap();

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // Autolinking hashes ios/ and android/; the shared C engine is their sibling.
  extraSources: [
    {
      type: "dir",
      filePath: "modules/ble-transport/shared",
      reasons: ["piperBleSharedNativeCode"],
    },
  ],
  fileHookTransform(source, chunk, isEndOfFile) {
    if (source.type !== "file" || source.filePath !== "eas.json") {
      return chunk;
    }

    const chunks = pendingFiles.get(source) ?? [];
    if (chunk != null) chunks.push(Buffer.from(chunk));
    if (!isEndOfFile) {
      pendingFiles.set(source, chunks);
      return null;
    }
    pendingFiles.delete(source);
    const text = Buffer.concat(chunks).toString("utf8");

    const config = JSON.parse(text);
    // Submission metadata does not alter native code. Keep the canonical
    // empty submit profile used by the first OTA-enabled tester binaries.
    config.submit = { production: {} };
    return `${JSON.stringify(config, null, 2)}\n`;
  },
};
