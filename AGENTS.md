This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Documentation

- Keep `README.md` short: the app's purpose, current status, and basic run instructions.
- Use `docs/` when architecture, a substantial implementation plan, or a lasting design decision needs documentation. Do not create docs for every change or duplicate code-level details.
- Extend an existing relevant document when possible. The proposed mesh architecture lives in `docs/mesh-architecture.md`; clearly distinguish implemented behavior from proposals.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Write each screen directly in its route file as the default export, including its JSX, local state, and screen-specific helper components. Do not create separate screen files under `features/` or route files that only import/re-export a screen.
- Keep reusable UI in `src/components/` (shared controls in `src/components/ui/`), reusable hooks in `src/hooks/`, and shared state in `src/stores/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

### Physical-device testing

- Default to standalone tester releases: `bun run build:testflight` for iOS (production build with automatic TestFlight submission) and `bun run build:android-release` for Android (signed release APK for direct installation).
- These builds embed the JavaScript bundle and run without Metro. Use them for Bluetooth/mesh acceptance tests on physical phones.
- Only build development clients or simulator builds when explicitly requested for debugging. Native changes require a new tester binary; compatible JavaScript/assets can use the existing EAS Update workflow.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a new native build; use the standalone tester release commands above by default.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
