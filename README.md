# PiperNet

PiperNet captures, compresses, and shares photos and short videos between nearby iOS and Android phones without internet. Built with Expo and React Native.

Onboarding enables Bluetooth sharing. Phones discover and connect automatically, exchange missing media, and relay received files when enabled. Use the Inbox gear to change sharing options. Sharing uses Bluetooth only; Wi-Fi and internet are not required. Keep PiperNet open with Bluetooth enabled on participating phones.

**Current status:** automatic BLE discovery, encrypted resumable photo/video transfers, persistent broadcast queues, receipts, and bounded store-and-forward are implemented. Google Nearby has been removed from source. This removal and Save to Photos/Gallery need a new tester binary; physical-device BLE interoperability and throughput still need validation. Radio jamming can block delivery; captures remain local until a link returns.

## Build for physical phones

```bash
bun install --frozen-lockfile
bunx eas-cli login
bunx eas-cli whoami
bun run check
bun run build:testflight
bun run build:android-release
```

Use **TestFlight on iOS** and the **signed release APK on Android** for device testing. Both embed the app bundle and work without Metro. Install the new binaries for native changes, including Bluetooth transport, capture timestamps, and video compression. Keep the app open with Bluetooth enabled on both phones.

Both releases use the `production` OTA channel. Publish compatible JavaScript/assets with `bun run update:production -- --message "Describe the change"`; native changes require new builds. Update checks download in the background at launch and apply on the next restart. Development-client/simulator builds are reserved for explicitly requested debugging; see the architecture document for those commands.

Protocol limits, security boundaries, and device test steps are in [docs/mesh-architecture.md](docs/mesh-architecture.md).
