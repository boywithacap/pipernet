# PiperNet

PiperNet is an iOS and Android app for capturing small photos and videos, with nearby, offline sharing as the next step. Built with Expo and React Native.

Tap to take a photo, hold to record a video, and save captures to Queued. Inbox has separate Received and Queued views with media previews and local deletion.

**Current status:** capture, onboarding, and the basic UI are implemented. Captures stay on this device; nearby delivery and mesh relaying are not implemented yet.

## Run locally

```bash
bun install --frozen-lockfile
bunx expo start
```

Use a physical device to test capture. Run `bun run check` for lint, typecheck, and unit tests.

The current architecture and proposed mesh implementation are documented in [docs/mesh-architecture.md](docs/mesh-architecture.md).
