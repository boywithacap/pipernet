# PiperNet

PiperNet captures, compresses, and shares photos and short videos between nearby iOS and Android phones without internet. Built with Expo and React Native.

Onboarding enables nearby sharing. Phones discover and connect automatically, exchange missing media, and relay received files when enabled. Use the Inbox gear to change sharing options. Keep the app open with Bluetooth and Wi-Fi on.

**Current status:** native Nearby adapters, photo/video compression, persistent broadcast queues, receipts, and bounded store-and-forward are implemented in source. Physical-device interoperability and throughput need validation. Radio jamming can block delivery; captures remain local until a link returns.

## Run locally

```bash
bun install --frozen-lockfile
bunx eas-cli login
bunx eas-cli whoami
bunx eas-cli init
bunx eas-cli build --profile development --platform all
bunx expo start --dev-client
```

Install development builds on physical phones. New photos and videos include a visible capture date/time stamp; this native processing, transport, and video compression require a development build. Run `bun run check` for lint, typecheck, and unit tests.

For iOS Simulator testing, build with `bunx eas-cli build --profile development-simulator --platform ios`, then install with `bunx eas-cli build:run --platform ios --profile development-simulator --latest`. Device builds cannot run on iOS Simulator. Test Bluetooth sharing on physical phones.

For standalone offline startup without Metro, build with `bunx eas-cli build --profile preview --platform all`.

For testers, use `bun run build:testflight` for iOS or `bun run build:android-release` for an installable Android release APK. Both use the `production` OTA channel. Publish compatible JavaScript/assets with `bun run update:production -- --message "Describe the change"`; native changes require new builds. Update checks download in the background at launch and apply on the next restart. See the release/OTA section in the architecture document for preview updates and testing.

Protocol limits, security boundaries, and device test steps are in [docs/mesh-architecture.md](docs/mesh-architecture.md).
