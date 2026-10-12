# PiperNet mesh architecture

Status: a foreground broadcast mesh and compression pipeline are implemented in source. Automated protocol tests run without radios. Native compilation and physical-device verification have separate evidence requirements; JavaScript tests do not establish iOS/Android interoperability or measured throughput.

## Product behavior

Inbox’s top-right gear opens Settings as a modal sheet, leaving Record and Inbox as the two tabs. Onboarding enables two persistent sharing controls after nearby access succeeds. **Auto-share captures** joins nearby sharing and automatically saves compressed captures to the outgoing queue. It also enrolls existing outgoing captures less than 24 hours old. **Relay received media** permits forwarding received files to other connected phones. Discovery, connection initiation, and Nearby handshake acceptance are automatic for compatible PiperNet phones. Settings shows connection state without Connect or code-confirmation buttons. Broadcast sharing does not authenticate a person or trusted device; nearby participants can keep shared media.

Onboarding requires camera and nearby access; microphone denial allows silent video. The nearby step has no skip action. It requests platform permissions, waits for the app to regain foreground/focus after OS prompts, then briefly starts/stops native discovery to validate access and surface iOS Bluetooth/local-network prompts. Only after success does it persist auto-sharing and relaying, then mark onboarding complete. The onboarding access probe stops before enabling the runtime; automatic connections begin after entering the app. Denied access stays on the step with retry/device-settings recovery; failed completion rolls back sharing settings. Permission tasks are exclusive and cancelled when a screen departs. Resume checks permissions without prompting and exposes revoked access in Settings. Record shows no persistent sharing banner or automatic-queue success toast.

This release shares media with everyone participating along the forwarding path. A receiving phone can view, retain, and (with relay enabled) forward it. This broadcast model replaces the earlier proposal's private-recipient assumption. Received media appears in Inbox; there is no hidden transit cache. A relay acknowledgment does not prove that every phone received a file.

No account or internet service participates in media delivery. Android requires Google Play services for the selected native transport. Bluetooth and Wi-Fi must remain enabled, and the app must remain in the foreground. Internet shutdowns do not inherently prevent local links. A jammer affecting the radios in use can prevent discovery and transfer; software cannot promise delivery through such interference. Captures persist and forwarding resumes after a usable link returns and a compatible phone connects automatically.

## Inspiration and transport

[Bitchat](https://github.com/permissionlesstech/bitchat) informs local discovery, duplicate suppression, limited propagation, and carrying messages between encounters. [Apple Find My](https://support.apple.com/guide/security/find-my-security-sec6cbc80fd0/web) informs the idea of nearby devices carrying reports. PiperNet does not implement either wire protocol, access Apple's Find My network, or inherit its privacy properties or internet reporting infrastructure.

The local Expo module wraps **Google Nearby Connections on both platforms**, using the same service ID and cluster strategy. Nearby selects local Bluetooth/BLE/Wi-Fi mediums and supplies encrypted connections and native file payloads. Cluster supplies direct links; the coordinator supplies multi-hop store-and-forward. Android Nearby and iOS Multipeer Connectivity do not share a protocol, so we do not combine them. BLE discovery does not establish an acceptable BLE-only video transfer rate. See [Nearby overview](https://developers.google.com/nearby/connections/overview), [verification](https://developers.google.com/nearby/connections/swift/manage-connections), and [strategies](https://developers.google.com/nearby/connections/strategies).

Existing React Native packages were considered before keeping the custom adapter:

| Package                                                                             | Decision for this release                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [expo-bitchat](https://github.com/quiint/expo-bitchat)                              | Exposes text/private-message mesh APIs, without a native media-file transfer API; still described by its authors as work in progress. It does not replace a bounded video transfer manager. |
| [expo-nearby-connections](https://github.com/puguhsudarma/expo-nearby-connections)  | Explicitly excludes iOS-to-Android P2P because its platform backends differ.                                                                                                                |
| [react-native-wifi-aware](https://github.com/mahdidavoodi7/react-native-wifi-aware) | Explicitly does not support iPhone-to-Android connectivity; requires compatible hardware and newer iOS.                                                                                     |
| [react-native-compressor](https://github.com/numandev1/react-native-compressor)     | Reused for native video encoding; no custom codec implementation.                                                                                                                           |

The custom portion is the Expo adapter, actual-media validation, and application queue/relay policy. Radio discovery, link encryption, medium negotiation, file transport, and video encoding remain established native library responsibilities. The adapter interface permits replacement when a library covers cross-platform file transfer. iOS explicitly selects local radio mediums and excludes WebRTC.

Native startup is scoped to one session generation. Backgrounding cancels a pending start, and callbacks from a stopped session cannot finish a later retry. iOS startup completions and lifecycle changes run on the main queue; advertiser/discoverer instances are reused because their SDK destructors stop the shared Nearby core. Both platforms wait for foreground after permission prompts before starting discovery. Android capture keeps one camera view while changing photo/video outputs, avoiding teardown of the process-wide CameraX provider by a replaced view.

## Automatic discovery and broadcast scheduling

The scheduler borrows Bitchat's bounded connection queue, retry cooldowns, duplicate suppression, and opportunistic encounters ([connection scheduler](https://github.com/permissionlesstech/bitchat/blob/main/bitchat/Services/BLE/BLEConnectionScheduler.swift), [whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md)). PiperNet keeps Nearby file transport for photos/videos rather than adopting Bitchat's BLE text packets.

Each advertisement carries the protocol version and stable installation UUID. The lexically lower UUID initiates, preventing symmetric dialing. The coordinator reserves a slot before calling native, accepts compatible incoming handshakes automatically, ignores self/duplicate identities, and bounds discovery to 32 candidates and two connecting/connected phones. Failed connections retry after 5 seconds with exponential backoff capped at 60 seconds; changing endpoint IDs preserves cooldown. Connection attempts time out after 30 seconds, and a missing application hello after 15 seconds. Stopped-session callbacks cannot cancel a new connection attempt.

When another phone is waiting, an idle connection rotates after 30 seconds with a 30-second cooldown. Active file transfers are not rotated. The two-link limit bounds simultaneous radio work, not the total recipients: each file remains eligible for later encounters until its hop/lifetime/byte limits expire. Sender receipts retain 128 recent recipients; receiver inventories, SHA-256 content IDs, durable library IDs, and deletion tombstones suppress duplicate deliveries even after receipt history rolls over. Stable advertisement IDs are scheduling handles, not privacy-preserving rotating identifiers.

## Implemented components

| Component                                   | Responsibility                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/app/(tabs)/index.tsx`                  | Capture, preview when sharing is off, automatic durable queuing when enabled                |
| `src/app/settings.tsx`                      | Sharing controls, permission recovery, automatic peer status, progress/errors               |
| `src/app/onboarding/nearby-permissions.tsx` | Required nearby access and enabling sharing before onboarding completion                    |
| `src/app/(tabs)/inbox.tsx`                  | Settings entry, media preview/deletion, and per-capture peer receipt count                  |
| `src/lib/media-files.ts`                    | JPEG compression, native video transcoding, validated drafts, thumbnails, owned files       |
| `src/lib/mesh/protocol.ts`                  | Versioned control frames, allowlisted fields, envelope/resource validation                  |
| `src/lib/mesh/coordinator.ts`               | Serialized scheduling, persistent journal, inventories, offers, receipts, retries, relaying |
| `src/hooks/use-mesh.ts`                     | Lifecycle ownership, library reconciliation, Zustand snapshots                              |
| `modules/nearby-transport/`                 | Swift/Kotlin radios, file streaming, incremental SHA-256, actual media inspection           |
| `modules/media-stamp/`                      | Native visible capture timestamps in JPEG pixels and video frames                          |
| `plugins/with-nearby.js`                    | CNG permissions, Bonjour service, hotspot entitlements, Swift-package integration           |

Native code transfers files and hashes in 64 KiB buffers. Whole videos and base64 media never enter JavaScript. Progress events are throttled to twice per second. Durable media lives in the document directory; incoming resources and adopted compression outputs use owned cache files. Remote filenames/paths never become library filenames.

## Compression and bandwidth

Photos re-encode to JPEG using 640 px / quality 0.35, 480 px / 0.25, then 320 px / 0.20, preserving aspect ratio and refusing output above **100 KiB**. Capture disables EXIF. Received metadata is never treated as trusted sender information.

New captures burn a two-line date/time stamp into the lower-left corner, with white text on a translucent dark background. It freezes the device's local date, time (including seconds), and UTC offset at the shutter press or video start. Photos resize to a lossless intermediate, then stamp and encode to JPEG at each quality pass; the byte limit applies to the stamped result. Video stamping uses AVFoundation on iOS and Media3 Transformer on Android, preserving display orientation and audio before the existing compression passes. This adds one native video export and requires a rebuilt development client. Originals and stamp intermediates are cleaned up after processing. Saved/received metadata preserves the original creation time, and Inbox shows both date and time. Received files are never stamped again; older files retain their existing pixels and timestamps. Device clocks are self-reported.

Videos record at 480p with a 400 kbit/s capture hint, then undergo real native transcoding through `react-native-compressor`. Manual passes use 480 px / 240 kbit/s, 360 px / 160 kbit/s, and 240 px / 96 kbit/s, always from the original. The first output within **3 MiB** wins. Output must contain H.264, have at most a 640 px encoded edge, and last at most 60 seconds (0.5 seconds of tolerance). Audio is retained. Bitrate is a target; actual bytes are checked. Oversized output is rejected with a shorter-clip suggestion. Encoders and audio overhead prevent a guaranteed compression ratio.

Incoming videos may use the protocol's 5 MiB hard limit for older captures. Nearby's opaque `.bin` resources are moved asynchronously into owned `.mp4` cache files before video inspection: AVFoundation rejects otherwise valid MP4 bytes under the `.bin` extension. This move does not change bytes or bypass validation. Native inspection checks image dimensions before thumbnail decoding, and checks video tracks/codec, dimensions, and duration. Thumbnails are generated locally and never transmitted. Compression, missing-only inventories, receipt suppression, and bounded concurrent connections reduce transmitted bytes. The delivery protocol uses no cellular connection.

## Protocol and durability

ASCII JSON frames contain `v: 1`. Types are `hello`, `inventory`, `offer`, `accept`, `busy`, `cancel`, and `receipt`. Hello exchanges a random installation UUID: a scheduling handle, **not a public-key identity**. Nearby encrypts the immediate link. Automatically accepting its handshake without comparing the code does not authenticate the neighboring device; the installation UUID is also self-reported. Display names identify the immediate sending phone and do not establish original authorship.

An envelope contains SHA-256 of compressed bytes as its ID, kind, byte length, creation/expiry times, and hop count. Its identity survives retries and relays. A hash proves byte equality with an offer, not authorship. A connected participant can originate untrusted content or alter unsigned routing metadata. Local quotas apply regardless of remote claims.

1. Discover a compatible `PN1:<installation UUID>` advertisement and connect automatically; exchange a matching hello and bounded pages of known hashes.
2. Offer missing files, preferring local captures, within relay/hop/expiry/byte limits.
3. Admit one incoming file, reserve expected size, and check free disk space before accepting. Reject unsolicited resources, streams, excessive lengths, and oversized controls.
4. Receive natively; verify actual length/hash, then inspect actual type, dimensions, and duration.
5. Save using deterministic library ID `mesh-<hash>`. Persist its mesh record and deletion-resistant tombstone, then send a receipt. Native completion alone is not a receipt.
6. Delete incoming temporary files, announce the new inventory, and relay when enabled.

The AsyncStorage journal stores settings, installation UUID, envelope/library mappings, source peer, forwarding receipts, and tombstones. Writes persist before publishing observable state. Library and journal commits remain separate; deterministic IDs reconcile a crash between them. The library must hydrate before journal pruning. Local capture remains usable when discovery is unavailable.

Deleting media removes its forwarding mapping and cancels local work; tombstones remain for 48 hours to suppress replay within the accepted lifetime. Existing disconnected copies cannot be recalled. Expiry stops network forwarding without deleting the user's library files. Received forwarding is also capped at 24 hours from local admission, bounding clock skew. There is no global broadcast delivery receipt.

Interrupted files restart from the beginning. Failed incoming validation releases admission and sends a cancellation so the sender can retry with backoff rather than waiting for the receipt timeout. Original and relocated temporary files are discarded after saving or failure. A successful receive or durable peer receipt clears the previous transfer warning in Settings. There are up to four attempts per peer encounter with exponential backoff and jitter. Attempt/backoff state is in memory and resets after process restart. Receipts and deduplication persist. Disabling relaying cancels outgoing relay work. Chunk resumption and durable retry backoff remain future work.

## Enforced limits

| Resource                           | Limit                                        |
| ---------------------------------- | -------------------------------------------- |
| Photo / video wire size            | 100 KiB / 5 MiB                              |
| Video output target / duration     | 3 MiB / 60 seconds                           |
| Network lifetime / clock allowance | 24 hours / 5 minutes                         |
| Forward depth / receipt history    | 3 hops / 128 recent recipient UUIDs per file |
| Indexed transferable media         | 50 MiB / 128 records                         |
| Tombstones / inventory page        | 512 hashes / 64 hashes                       |
| Connected phones                   | 2                                            |
| Bulk work                          | 1 outgoing and 1 incoming file               |
| Bytes per direction per session    | 10 MiB, including admitted/retried files     |
| Control frame / rate               | 8 KiB / 240 frames per minute per connection |
| Stall / connect / hello timeout    | 90 / 30 / 15 seconds                         |

Full records or tombstones pause admission rather than evicting duplicate protection. Cooperative bounds cannot constrain malicious global copying. Library storage is independent of the mesh index quota.

## Native builds

Custom radios and the video compressor require a development build, not Expo Go. Use [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [local Expo modules](https://docs.expo.dev/modules/get-started/). Generated `ios/` and `android/` projects stay outside the repository.

Android pins `play-services-nearby:19.3.0` and declares `defaultConfig.versionName`/`versionCode`, required by Expo SDK 57’s module publishing configuration even for a local library. iOS pins Google's Swift package revision `2e9ff95062bd003555e4c11d9096adb859cfce72`. A config-plugin Podfile hook registers the pinned package in both the app and Pods projects so EAS/Fastlane discovers it during workspace package resolution. It links the static product only into the PiperNearby module; linking it directly into the app again would duplicate native symbols. The plugin declares Google's hashed Bonjour service, permission descriptions, and hotspot/Wi-Fi entitlements. iOS location authorization permits hotspot joins; PiperNet never requests coordinates. Android requests OS-appropriate Bluetooth/Wi-Fi and legacy location/storage permissions. See [Swift setup](https://developers.google.com/nearby/connections/swift/get-started) and [Android setup](https://developers.google.com/nearby/connections/android/get-started).

`eas-build-post-install` resolves Swift packages into one explicit checkout directory and namespaces the pinned BoringSSL 0.7.x `sdallocx` allocator fallback before Fastlane compilation. That weak function collides with React Native Folly's variable of the same name and can crash during Nearby key exchange ([Nearby issue #2195](https://github.com/google/nearby/issues/2195), [upstream allocator fix](https://github.com/apple/swift-nio-ssl/pull/191)). The hook preserves cryptographic operations, reuses the patched checkout, and refuses unexpected dependency source changes. This is a likely cause matching the reported connect crash; physical-device confirmation is required. Generated native projects remain untouched by hand.

Select the intended Expo account and project:

```bash
bunx eas-cli login
bunx eas-cli whoami
bunx eas-cli init
bunx eas-cli build --profile development --platform all
bunx expo start --dev-client
```

iOS physical-device builds require Apple signing credentials and registered devices; follow EAS prompts. Android-only builds use `--platform android`. EAS must provision the hotspot capability. See [EAS setup](https://docs.expo.dev/build/setup/).

For a standalone app that starts without Metro, use `bunx eas-cli build --profile preview --platform all`. Development builds are for iteration; load the JavaScript bundle before disconnecting a development phone from its dev server.

The `development-simulator` profile inherits development settings and sets `ios.simulator: true`. Build it in EAS with `bunx eas-cli build --profile development-simulator --platform ios`, then install it with `bunx eas-cli build:run --platform ios --profile development-simulator --latest`. Physical-iPhone binaries cannot run on iOS Simulator. Simulator UI checks do not establish Bluetooth discovery, mesh throughput, or physical camera behavior.

## Tester releases and OTA updates

Expo Updates is configured for the existing EAS project with separate `preview` and `production` channels. `production` builds a store-signed iOS IPA for TestFlight and an Android AAB for Google Play; `production-apk` inherits its production environment/channel and makes a signed release APK for direct installation. These release builds embed the app bundle and start without Metro. EAS remotely increments build numbers/version codes. The development profiles remain development clients.

```bash
# Build and submit to App Store Connect/TestFlight (Apple credentials required).
bun run build:testflight
# Build a release APK that testers can install directly.
bun run build:android-release
# Optional Play Store bundle.
bunx eas-cli build --platform android --profile production
# Publish JavaScript/assets to the matching release environment and channel.
bun run update:production -- --message "Describe the change"
# Preview builds/updates use a separate channel for testing changes first.
bunx eas-cli build --profile preview --platform all
bun run update:preview -- --message "Describe the change"
```

`runtimeVersion.policy: fingerprint` calculates compatibility from native dependencies, app configuration, config plugins, and local native modules. A native change, including timestamp/transport changes or an Expo SDK upgrade, requires a new binary before its JavaScript can reach testers. Do not override runtime compatibility to push a native change via OTA. Keep the update's EAS environment aligned with its build profile. See [runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) and [EAS Update setup](https://docs.expo.dev/eas-update/getting-started/).

The app uses Expo's automatic launch check with a zero cache wait, preserving immediate offline startup. Downloads happen in the background and become active on a subsequent restart; recording or sharing is never interrupted by an automatic reload. Without internet, the app uses its embedded or previously downloaded bundle. OTA requires internet, while nearby media delivery remains local. To verify an update, install the corresponding release, connect to internet, close/reopen once to download and again to apply, then repeat a capture/transfer offline. Verify new native captures and timestamp rendering separately on physical phones.

TestFlight submission uploads to App Store Connect, where Apple processes the build. External tester distribution may require Beta App Review and an external group/public invitation link in App Store Connect. A completed EAS build is distinct from completed TestFlight processing and tester access.

## Verification and future work

EAS development builds completed successfully on October 12, 2026: [Android](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/e59423e4-385e-4901-a119-5387fc3b8738) and [iOS](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/c860d5f6-1fae-40bd-b04c-7bbc4b40afdd). The iOS artifact targets physical devices. Native cloud compilation is verified for these builds; installation, runtime behavior, and radio interoperability still need verification.

The [Android permission-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/8a22cdea-8eed-4927-812e-671fba75c456) and [iOS lifecycle-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/aea66aca-3d42-4ced-bc5f-6a9b1c695db0) also compiled successfully on October 12. Android includes OS-specific permission handling, `neverForLocation` declarations for Android 13+, radio checks, and native startup cancellation. iOS includes foreground validation, main-queue startup completion, session cancellation, and reusable SDK objects. Camera and dialog JavaScript changes made after the Android archive load through Metro. Install the updated binaries for native permission/lifecycle changes; physical-device acceptance remains separate from compilation.

The [iOS automatic-broadcast/allocator-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/5cea1f40-ebdd-4d62-ab53-360a27038eaf) compiled and archived successfully on October 12. Its cloud log confirms the allocator patch ran, Fastlane used `/tmp/pipernet-swift-packages` with resolution/automatic updates disabled, and the patched `mem.c` compiled. Inspection of the packaged app confirms `_pipernet_boringssl_sdallocx` is present, replacing the colliding allocator function. After installing it, the user confirmed sharing between physical Android and iOS phones. The paired iPhone's library and journal also contain received photos and durable outgoing receipts. This establishes a working encounter, not every radio or lifecycle case. Automatic `PN1` discovery changes can load through Metro on the previously compiled Android permission-fix binary.

The iPhone then showed `UnexpectedException: Cannot Open` in Settings while connected. A local AVFoundation diagnostic using one of its valid outgoing videos opened identical bytes as `.mp4` and rejected them as `.bin` with `AVFoundationErrorDomain -11828 Cannot Open`. Received video adoption and transfer-warning recovery are JavaScript fixes; they do not themselves require a new native build. Automated tests cover awaited adoption, retained format validation, failed-file cleanup, cancellation/backoff, and clearing errors only after successful transfers. The repaired video receive path still needs a physical-device retest.

Automated tests simulate automatic discovery/handshake, deterministic initiation, slot reservation/capacity, failed/late callbacks, endpoint changes, fair rotation, A → B → C across separate encounters, relay consent, loop suppression, retries/backoff, corrupt payload rejection, journal failures, expiry, pause, and replay after deletion. A compiled C regression fixture checks the allocator with a conflicting Folly-style variable symbol. They do not measure compression quality or radio behavior. Run `bun run check` before delivery. With the `xcodeproj` Ruby gem available (bundled with CocoaPods), `ruby tests/nearby-install.test.rb` checks saved project graphs for package registration, single linking, repeat-install behavior, and repair of missing links. These configuration checks do not resolve/download the package or compile native code; successful EAS builds and device tests remain separate requirements.

Physical-device acceptance:

1. Test iOS/iOS, Android/Android, and iOS/Android pairs in both directions, without cellular data or internet but with Bluetooth/Wi-Fi enabled. Confirm automatic discovery/connection without a Connect action. Both phones must load the current JavaScript bundle; older advertisements are ignored.
2. Capture photos and 5-, 30-, and 60-second videos. Check timestamp readability, front/back camera orientation, audio, actual duration/bytes, throughput, and battery use. Confirm the stamp survives transfer/relay, Inbox shows the original capture time, and there is one Inbox item and a durable peer receipt.
3. Disconnect during offers/transfers, reconnect automatically, restart apps, and confirm deleted received items do not return.
4. Have A share to relay-enabled B, disconnect A, then connect B to C. Confirm C receives once while A and C never meet. Disable B's relay setting and confirm forwarding stops.
5. Test denied/revoked permissions, disabled radios, low disk, failed connections, foreground/background transitions, quotas, and stalls. Locking the screen pauses the foreground mesh.

Private recipient routing, sender signatures/persistent key trust, end-to-end ciphertext-only relays, rotating identifiers, resumable chunks, background service, non-Google Android transport, and a cryptographic audit are **not implemented**. Encrypted immediate links must not be described as Find My privacy or confidential end-to-end relaying.
