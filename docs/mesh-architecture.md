# PiperNet mesh architecture

Status: a foreground broadcast mesh and compression pipeline are implemented in source. Automated protocol tests run without radios. Native compilation and physical-device verification have separate evidence requirements; JavaScript tests do not establish iOS/Android interoperability or measured throughput.

As of October 13, 2026, direct BLE is the default transport in the latest tester releases, with Nearby selectable in Settings. The October 12 binaries below contain only Nearby; install the October 13 TestFlight build `1.0.0 (3)` or Android release APK with version code `4` for BLE testing. Physical-device acceptance is still pending. Simultaneous BLE/Nearby operation and automatic transport handoff remain proposals.

## Product behavior

Inbox’s top-right gear opens Settings as a modal sheet, leaving Record and Inbox as the two tabs. Onboarding enables two persistent sharing controls after nearby access succeeds. **Auto-share captures** joins nearby sharing and automatically saves compressed captures to the outgoing queue. It also enrolls existing outgoing captures less than 24 hours old. **Relay received media** permits forwarding received files to other connected phones. Discovery, connection initiation, and link handshake acceptance are automatic for compatible PiperNet phones. Settings shows connection state without Connect or code-confirmation buttons. Broadcast sharing does not authenticate a person or trusted device; nearby participants can keep shared media.

Onboarding requires camera and Bluetooth access; microphone denial allows silent video. The nearby step has no skip action. It requests platform permissions, waits for the app to regain foreground/focus after OS prompts, then briefly starts/stops native discovery to validate access and surface the iOS Bluetooth prompt. Optional Nearby access additionally requests local-network and hotspot location access. Only after success does it persist auto-sharing and relaying, then mark onboarding complete. The onboarding access probe stops before enabling the runtime; automatic connections begin after entering the app. Denied access stays on the step with retry/device-settings recovery; failed completion rolls back sharing settings. Permission tasks are exclusive and cancelled when a screen departs. Resume checks permissions without prompting and exposes revoked access in Settings. Record shows no persistent sharing banner or automatic-queue success toast.

This release shares media with everyone participating along the forwarding path. A receiving phone can view, retain, and (with relay enabled) forward it. This broadcast model replaces the earlier proposal's private-recipient assumption. Received media appears in Inbox; there is no hidden transit cache. A relay acknowledgment does not prove that every phone received a file.

No account or internet service participates in media delivery. Direct BLE requires Bluetooth and supported advertising/GATT hardware; it does not check Wi-Fi, location on Android 12+, or Google Play services. Android 11 and earlier require location access/services for BLE discovery. Optional Nearby requires Bluetooth/Wi-Fi and, on Android, Google Play services. The app must remain in the foreground in both modes. Internet shutdowns do not inherently prevent local links. A jammer affecting the radios in use can prevent discovery and transfer; software cannot promise delivery through such interference. Captures persist and forwarding resumes after a usable link returns and a compatible phone connects automatically.

## Inspiration and transport

[Bitchat](https://github.com/permissionlesstech/bitchat) informs local discovery, duplicate suppression, limited propagation, and carrying messages between encounters. [Apple Find My](https://support.apple.com/guide/security/find-my-security-sec6cbc80fd0/web) informs the idea of nearby devices carrying reports. PiperNet does not implement either wire protocol, access Apple's Find My network, or inherit its privacy properties or internet reporting infrastructure.

The optional `modules/nearby-transport/` wraps **Google Nearby Connections on both platforms**, using the same service ID and cluster strategy. Nearby selects local Bluetooth/BLE/Wi-Fi mediums and supplies encrypted connections and native file payloads. Cluster supplies direct links; the coordinator supplies multi-hop store-and-forward. Android Nearby and iOS Multipeer Connectivity do not share a protocol, so we do not combine them. BLE discovery does not establish an acceptable BLE-only video transfer rate. See [Nearby overview](https://developers.google.com/nearby/connections/overview), [verification](https://developers.google.com/nearby/connections/swift/manage-connections), and [strategies](https://developers.google.com/nearby/connections/strategies).

Existing React Native packages were considered before keeping the custom adapter:

| Package                                                                             | Decision for this release                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [expo-bitchat](https://github.com/quiint/expo-bitchat)                              | Exposes text/private-message mesh APIs, without a native media-file transfer API; still described by its authors as work in progress. It does not replace a bounded video transfer manager. |
| [expo-nearby-connections](https://github.com/puguhsudarma/expo-nearby-connections)  | Explicitly excludes iOS-to-Android P2P because its platform backends differ.                                                                                                                |
| [react-native-wifi-aware](https://github.com/mahdidavoodi7/react-native-wifi-aware) | Explicitly does not support iPhone-to-Android connectivity; requires compatible hardware and newer iOS.                                                                                     |
| [react-native-compressor](https://github.com/numandev1/react-native-compressor)     | Reused for native video encoding; no custom codec implementation.                                                                                                                           |

Nearby delegates encryption, medium negotiation, and file transport to Google’s native libraries. The independent BLE module uses OS GATT APIs, an established Noise implementation for encryption, and a shared native framing/file engine described below. Video encoding remains in native libraries. Nearby on iOS selects local radio mediums and excludes WebRTC.

Nearby native startup is scoped to one session generation. Backgrounding cancels a pending start, and callbacks from a stopped session cannot finish a later retry. iOS startup completions and lifecycle changes run on the main queue; advertiser/discoverer instances are reused because their SDK destructors stop the shared Nearby core. Both platforms wait for foreground after permission prompts before starting discovery. Android capture keeps one camera view while changing photo/video outputs, avoiding teardown of the process-wide CameraX provider by a replaced view.

## Implemented BLE transport

`modules/ble-transport/` implements automatic BLE advertising/scanning, iOS Core Bluetooth central/peripheral roles, and Android GATT client/server roles. There is no Bluetooth Settings pairing, account, or connection button. Participating foreground phones advertise the PiperNet service, probe its identity characteristic, establish an encrypted stream, and enter the existing coordinator's automatic admission/hello flow. This is an application mesh over GATT, not Bluetooth SIG Mesh, and it does not interoperate with Bitchat.

Settings chooses **Bluetooth** (default, including migrated journals without a saved mode) or **Nearby**. Both phones must select the same mode. One adapter runs at a time; switching stops old links, rejects late callbacks, and preserves captures, receipts, and tombstones. This implementation does not negotiate simultaneous links or automatically upgrade transfers to Wi-Fi. BLE startup failures surface in Settings without silently starting Nearby.

### Discovery and encrypted records

The service UUID is `BE516B00-5E69-4F91-A91F-3A86A4C10701`; identity and stream characteristics use `BE516B01` and `BE516B02` with the same suffix. Advertisements carry the service UUID only. A read-only characteristic carries the 16-byte installation UUID. The lexically smaller `PN1:<UUID>` initiates the encrypted stream after subscribing to notifications, avoiding symmetric connection attempts. The encrypted identity must match the discovery read. Stable installation IDs are untrusted scheduling handles, not authenticated people or rotating privacy identifiers.

Both platforms compile the same C engine in `shared/PiperBle.c`. It uses **Noise_NN_25519_ChaChaPoly_SHA256**, with prologue `PiperNet BLE stream v1`, from [Noise-C](https://github.com/rweather/noise-c/tree/cfe25410979a87391bb9ac8d4d4bef64e9f268c6). Vendored sources are pinned and checked against `vendor/noise/manifest.json`; its upstream license is retained. Only the required algorithms are compiled via `sources.json`. Noise NN supplies ephemeral encryption and detects altered encrypted records; **it does not authenticate identities or resist an active man-in-the-middle**. It does not implement Bitchat's static-key/Noise XX trust model. Broadcast participants can still read and keep media. A cryptographic audit and authenticated persistent keys remain future work.

Records use a two-byte network-order length prefix and bounded encrypted identity, control, file-start, acknowledgment, data, and cancellation payloads. Controls retain the existing ASCII JSON v1 protocol. The length prefix is untrusted and capped before allocation; malformed or tampered records close the session. There is a 64 KiB outgoing queue, an 8 KiB control limit, and a 32-event native queue. Before coordinator acceptance, at most eight controls are buffered.

GATT fragments honor the actual write/notification size. Central writes wait for write completion; peripheral sends respect platform notification backpressure. Android requests a larger MTU but supports the 20-byte baseline. All session state/file work runs on one serial native worker per platform. Progress crosses the bridge at most twice per second per direction; whole media never enters JavaScript.

### Files and resumption

BLE carries both photos and full videos under the existing 100 KiB photo / 5 MiB video limits. Files use 4 KiB native chunks with content hash, total size, contiguous offset, and stop-and-wait acknowledgments. At most one bulk chunk per direction awaits acknowledgment, bounding the bulk data ahead of new controls. The receiver opens a file only after coordinator admission. A reconnect creates a fresh encrypted session and resumes from the receiver's retained `.part` length. Completion still requires the coordinator's full-file SHA-256, length, and media-format checks, durable library/journal commits, and final receipt.

Partials live under the app cache directory, use hash-derived names, expire after 24 hours, and reserve space within 50 MiB / 128-file limits before admission. Cleanup runs on startup/admission; the OS may also evict cache files, in which case transfer restarts. Partials survive an ordinary disconnect or process restart, but cancellation can interrupt both file directions and in-flight records may close the link. Retrying resumes retained bytes. A corrupt completed partial is deleted by validation rather than accepted as delivery. Switching to Nearby restarts its native payload from byte zero.

BLE supports the complete media workload in source, but throughput is unmeasured. At an **assumed** sustained 10 KiB/s, a 100 KiB photo takes 10 seconds and a 3 MiB video about 5.1 minutes per link, before setup, contention, and retries. These are arithmetic examples, not benchmarks. Every store-and-forward hop copies and validates the full file.

### Runtime limits and native integration

BLE tracks at most 32 scan candidates and three raw links (including an identity probe); the coordinator admits at most two media peers. Only one unresolved outbound connection is dialed at a time. Native links have a 20-second setup/acceptance deadline, a 15-second reconnect cooldown, and a 100-second inactivity deadline. Idle links rotate when other candidates are waiting. Application transfer progress refreshes the existing 90-second stall deadline, so a continuously progressing video is not subject to a 90-second total-transfer deadline.

Modern Android requests only Bluetooth scan/advertise/connect permissions in BLE mode. Legacy Android requests the required location access; unsupported advertising and disabled radios produce actionable errors. The existing CNG plugin supplies both transports' manifest/plist declarations. `PiperNearby` remains compiled because its incremental hash/media-inspection utilities and the optional Nearby mode are retained; those utilities do not start Nearby radios or check Google Play services. Running the default transport therefore does not require Play services, but shipping a binary with the Google dependency entirely removed is not implemented.

The [Expo SDK 57 local module workflow](https://docs.expo.dev/modules/get-started/) autolinks the Swift/Kotlin wrappers. CocoaPods and CMake compile the same source list; Android links the shared library for 16 KiB page alignment. New native builds are required; this cannot ship solely by OTA. Foreground-only lifecycle remains intentional. Native background hooks stop radios and pending startup even when JavaScript is delayed; the coordinator reconciles sharing on app resume. [iOS background advertising restrictions](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html) and [Android background execution requirements](https://developer.android.com/develop/connectivity/bluetooth/ble/background) need separate design and device evidence before promising background relaying.

## Automatic discovery and broadcast scheduling

The scheduler borrows Bitchat's bounded connection queue, retry cooldowns, duplicate suppression, and opportunistic encounters ([connection scheduler](https://github.com/permissionlesstech/bitchat/blob/main/bitchat/Services/BLE/BLEConnectionScheduler.swift), [whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md)). The coordinator owns relaying and media admission for either transport. The following discovery-event scheduler describes the Nearby adapter; BLE performs its initial radio probing natively as described above, then enters the same pairing/admission flow.

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
| `src/lib/mesh/selectable-transport.ts`      | One active transport, persisted selection, late-event isolation                             |
| `modules/ble-transport/`                    | BLE central/peripheral roles, shared Noise records, native resumable files                  |
| `src/lib/mesh/coordinator.ts`               | Serialized scheduling, persistent journal, inventories, offers, receipts, retries, relaying |
| `src/hooks/use-mesh.ts`                     | Lifecycle ownership, library reconciliation, Zustand snapshots                              |
| `modules/nearby-transport/`                 | Swift/Kotlin radios, file streaming, incremental SHA-256, actual media inspection           |
| `modules/media-stamp/`                      | Native visible capture timestamps in JPEG pixels and video frames                           |
| `plugins/with-nearby.js`                    | CNG permissions, Bonjour service, hotspot entitlements, Swift-package integration           |

Nearby uses native file payloads; BLE uses 4 KiB file chunks. Hashing uses 64 KiB native buffers. Whole videos and base64 media never enter JavaScript. Progress events are throttled to twice per second per transfer direction. Durable media lives in the document directory; incoming resources and adopted compression outputs use owned cache files. Remote filenames/paths never become library filenames.

## Compression and bandwidth

Photos re-encode to JPEG using 640 px / quality 0.35, 480 px / 0.25, then 320 px / 0.20, preserving aspect ratio and refusing output above **100 KiB**. Capture disables EXIF. Received metadata is never treated as trusted sender information.

New captures burn a two-line date/time stamp into the lower-left corner, with white text on a translucent dark background. It freezes the device's local date, time (including seconds), and UTC offset at the shutter press or video start. Photos resize to a lossless intermediate, then stamp and encode to JPEG at each quality pass; the byte limit applies to the stamped result. Video stamping uses AVFoundation on iOS and Media3 Transformer on Android, preserving display orientation and audio before the existing compression passes. This adds one native video export and requires a rebuilt development client. Originals and stamp intermediates are cleaned up after processing. Saved/received metadata preserves the original creation time, and Inbox shows both date and time. Received files are never stamped again; older files retain their existing pixels and timestamps. Device clocks are self-reported.

Videos record at 480p with a 400 kbit/s capture hint, then undergo real native transcoding through `react-native-compressor`. Manual passes use 480 px / 240 kbit/s, 360 px / 160 kbit/s, and 240 px / 96 kbit/s, always from the original. The first output within **3 MiB** wins. Output must contain H.264, have at most a 640 px encoded edge, and last at most 60 seconds (0.5 seconds of tolerance). Audio is retained. Bitrate is a target; actual bytes are checked. Oversized output is rejected with a shorter-clip suggestion. Encoders and audio overhead prevent a guaranteed compression ratio.

Incoming videos may use the protocol's 5 MiB hard limit for older captures. Nearby's opaque `.bin` resources are moved asynchronously into owned `.mp4` cache files before video inspection: AVFoundation rejects otherwise valid MP4 bytes under the `.bin` extension. This move does not change bytes or bypass validation. Native inspection checks image dimensions before thumbnail decoding, and checks video tracks/codec, dimensions, and duration. Thumbnails are generated locally and never transmitted. Compression, missing-only inventories, receipt suppression, and bounded concurrent connections reduce transmitted bytes. The delivery protocol uses no cellular connection.

## Protocol and durability

ASCII JSON frames contain `v: 1`. Types are `hello`, `inventory`, `offer`, `accept`, `busy`, `cancel`, and `receipt`. Hello exchanges a random installation UUID: a scheduling handle, **not a public-key identity**. Both transports encrypt the immediate link. BLE Noise NN has no static-key authentication; automatically accepting Nearby without comparing its code also does not authenticate the neighboring device; the installation UUID is also self-reported. Display names identify the immediate sending phone and do not establish original authorship.

An envelope contains SHA-256 of compressed bytes as its ID, kind, byte length, creation/expiry times, and hop count. Its identity survives retries and relays. A hash proves byte equality with an offer, not authorship. A connected participant can originate untrusted content or alter unsigned routing metadata. Local quotas apply regardless of remote claims.

1. Discover a compatible PiperNet service/`PN1:<installation UUID>` identity and connect automatically; exchange a matching hello and bounded pages of known hashes.
2. Offer missing files, preferring local captures, within relay/hop/expiry/byte limits.
3. Admit one incoming file, reserve expected size, and check free disk space before accepting. Reject unsolicited resources, streams, excessive lengths, and oversized controls.
4. Receive natively; verify actual length/hash, then inspect actual type, dimensions, and duration.
5. Save using deterministic library ID `mesh-<hash>`. Persist its mesh record and deletion-resistant tombstone, then send a receipt. Native completion alone is not a receipt.
6. Delete incoming temporary files, announce the new inventory, and relay when enabled.

The AsyncStorage journal stores settings, installation UUID, envelope/library mappings, source peer, forwarding receipts, and tombstones. Writes persist before publishing observable state. Library and journal commits remain separate; deterministic IDs reconcile a crash between them. The library must hydrate before journal pruning. Local capture remains usable when discovery is unavailable.

Deleting media removes its forwarding mapping and cancels local work; tombstones remain for 48 hours to suppress replay within the accepted lifetime. Existing disconnected copies cannot be recalled. Expiry stops network forwarding without deleting the user's library files. Received forwarding is also capped at 24 hours from local admission, bounding clock skew. There is no global broadcast delivery receipt.

Interrupted Nearby payloads restart from the beginning; BLE resumes retained contiguous chunks. Failed incoming validation releases admission and sends a cancellation so the sender can retry with backoff rather than waiting for the receipt timeout. Original and relocated temporary files are discarded after saving or failure. A successful receive or durable peer receipt clears the previous transfer warning in Settings. There are up to four attempts per peer encounter with exponential backoff and jitter. Attempt/backoff state is in memory and resets after process restart. Receipts and deduplication persist. Disabling relaying cancels outgoing relay work. Durable retry backoff remains future work; BLE partial bytes are retained independently of that in-memory attempt counter.

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

Custom radios and the video compressor require a native development or release build, not Expo Go. The BLE module adds no JavaScript dependency; Noise-C is vendored under the module and linked on both platforms. Use [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [local Expo modules](https://docs.expo.dev/modules/get-started/). Generated `ios/` and `android/` projects stay outside the repository.

Android pins `play-services-nearby:19.3.0` and declares `defaultConfig.versionName`/`versionCode`, required by Expo SDK 57’s module publishing configuration even for a local library. iOS pins Google's Swift package revision `2e9ff95062bd003555e4c11d9096adb859cfce72`. A config-plugin Podfile hook registers the pinned package in both the app and Pods projects so EAS/Fastlane discovers it during workspace package resolution. It links the static product only into the PiperNearby module; linking it directly into the app again would duplicate native symbols. The plugin declares Google's hashed Bonjour service, permission descriptions, and hotspot/Wi-Fi entitlements. iOS location authorization permits hotspot joins; PiperNet never requests coordinates. Android requests OS-appropriate Bluetooth/Wi-Fi and legacy location/storage permissions. See [Swift setup](https://developers.google.com/nearby/connections/swift/get-started) and [Android setup](https://developers.google.com/nearby/connections/android/get-started).

`eas-build-post-install` resolves Swift packages into one explicit checkout directory and namespaces the pinned BoringSSL 0.7.x `sdallocx` allocator fallback before Fastlane compilation. That weak function collides with React Native Folly's variable of the same name and can crash during Nearby key exchange ([Nearby issue #2195](https://github.com/google/nearby/issues/2195), [upstream allocator fix](https://github.com/apple/swift-nio-ssl/pull/191)). The hook preserves cryptographic operations, reuses the patched checkout, and refuses unexpected dependency source changes. This is a likely cause matching the reported connect crash; physical-device confirmation is required. Generated native projects remain untouched by hand.

Select the intended Expo account and project:

```bash
bunx eas-cli login
bunx eas-cli whoami
bun run build:testflight
bun run build:android-release
```

iOS TestFlight builds require Apple signing credentials and App Store Connect access; testers install through TestFlight without registering device UDIDs. Android testers install the signed release APK directly. EAS must provision the hotspot capability. See [EAS setup](https://docs.expo.dev/build/setup/).

As of October 13, TestFlight and Android release APKs are the default for physical-device testing. Both embed the JavaScript bundle and start without Metro, including with Wi-Fi disabled. Only create development clients when explicitly requested for debugging: `bunx eas-cli build --profile development --platform all`, then `bunx expo start --dev-client`. Internal iOS development/preview distribution requires registered devices. Preview releases remain available for separate OTA testing.

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

`fingerprint.config.js` normalizes only EAS submission metadata to the empty production submit profile used by the initial OTA-enabled builds. App Store Connect IDs and other upload settings do not change native behavior. Build profiles, environment settings, ignore rules, app configuration, dependencies, and native source files retain their hashes. The shared BLE C/Noise directory is explicitly included through `extraSources`, because Android autolinking otherwise hashes only the module’s platform folder. A regression test changes native C bytes and confirms that both platform runtime hashes change. Tests protect these boundaries; compare production fingerprints with the release builds before publishing updates. See [Expo fingerprint customization](https://docs.expo.dev/versions/v57.0.0/sdk/fingerprint/).

The app uses Expo's automatic launch check with a zero cache wait, preserving immediate offline startup. Downloads happen in the background and become active on a subsequent restart; recording or sharing is never interrupted by an automatic reload. Without internet, the app uses its embedded or previously downloaded bundle. OTA requires internet, while nearby media delivery remains local. To verify an update, install the corresponding release, connect to internet, close/reopen once to download and again to apply, then repeat a capture/transfer offline. Verify new native captures and timestamp rendering separately on physical phones.

TestFlight submission uploads to App Store Connect, where Apple processes the build. External tester distribution may require Beta App Review and an external group/public invitation link in App Store Connect. A completed EAS build is distinct from completed TestFlight processing and tester access.

On October 12, 2026, the [iOS production build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/8119b43b-0ebd-4b95-8e40-d02bc7aea380) compiled with permanent capture timestamps and Expo Updates. Its [TestFlight submission](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/submissions/25f7e7cf-16d8-422c-8f29-000e7cf195ac) succeeded. Apple reports version `1.0.0 (2)` as `VALID` and `IN_BETA_TESTING` for internal testers, with external distribution `READY_FOR_BETA_SUBMISSION`. The App Store Connect app ID is `6821802740`, saved in the production submit profile; its listing name is `PiperNet (ce5d76)` because `PiperNet` was already taken. The installed app retains the name PiperNet.

The initial production OTA release was published on October 12 for [iOS](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/updates/e7c8f068-54d0-4060-8588-50550f75c24f) and [Android](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/updates/14c4dd01-830a-4b6e-b8c9-7539d2729d8e). Requests to the configured update endpoint with each platform's production channel/runtime returned HTTP 200 and the exact published manifest. The runtime hashes are `c01815d8ec4659444c68fde4897b5cf8951da861` (iOS) and `04b3ecdc38b4d598a4861a9bd4fbb74a4881dd83` (Android). This verifies server routing and compatibility; on-device download, activation, and offline capture/transfer still need a tester check.

The final [Android production APK build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/f856fe8d-bd20-4b76-b062-a98bbf1470e9) compiled and signed successfully on October 12, version `1.0.0`, version code `3`. For that Nearby-only release, use this build for tester installation; its production runtime matches the published Android OTA release. Archive inspection confirms the matching embedded runtime fingerprints in both the APK and TestFlight IPA. Lint, typecheck, all 99 automated tests, and Expo Doctor's 21 checks passed for the release setup.

On October 13, the [standalone iOS BLE release](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/4ff57df8-54fc-44e8-840c-a6bbe4e8b1a4) compiled and its [TestFlight submission](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/submissions/82f8f499-00be-49ff-80d9-b10c2071529b) succeeded. Apple reports `1.0.0 (3)` as `VALID` and `IN_BETA_TESTING` for internal testers; external distribution is `READY_FOR_BETA_SUBMISSION`. Archive inspection confirms the embedded `main.jsbundle`, store provisioning without registered-device restrictions, and `get-task-allow: false`. It starts without Metro. Physical Bluetooth acceptance remains a separate test.

The October 13 [Android BLE release APK](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/178f9549-1c47-43c8-b6fd-b63646f5885f) also compiled and signed successfully: version `1.0.0`, version code `4`, using `production-apk`. Archive inspection confirms `assets/index.android.bundle`, the embedded update manifest, and `libpiperble.so` for all four supported ABIs. Use this standalone APK for current Android testing; Metro is not required. Lint, typecheck, and all 106 tests passed before these releases.

## Verification and future work

For BLE on October 13, `bun run check` passes lint, typecheck, and all **106 tests**. The native engine runs under address/undefined-behavior sanitizers against an independent Noise NN vector, one-byte handshake fragmentation, 20-byte controls, interrupted/resumed transfers, a full 5 MiB file with reverse traffic, tampering, unsolicited files, and queue/size bounds. Adapter tests cover transport selection, persisted settings/queues/receipts, late callbacks, permission separation, and failure without a Nearby fallback. Local compiler checks cover the shared C/JNI and platform radio code against the real iOS/Android APIs, with Expo bridge stubs; these do not replace full native builds or device tests.

The October 13 BLE development builds completed successfully for [iOS](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/c9f2cdae-db4d-4c3f-b62f-ad48d379aba5) and [Android](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/1184b0d9-0691-42b8-9cfb-f4eb6dcfac52), including independent send/receive progress throttles. Both platforms compiled and packaged the native BLE module and shared Noise engine. CocoaPods source discovery was checked against all 25 native source/header files after moving the podspec to the module root and declaring its path explicitly. This verifies native integration, not physical radio behavior. Development clients need the current Metro bundle before testing with Wi-Fi disabled.

EAS development builds completed successfully on October 12, 2026: [Android](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/e59423e4-385e-4901-a119-5387fc3b8738) and [iOS](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/c860d5f6-1fae-40bd-b04c-7bbc4b40afdd). The iOS artifact targets physical devices. Native cloud compilation is verified for these builds; installation, runtime behavior, and radio interoperability still need verification.

The [Android permission-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/8a22cdea-8eed-4927-812e-671fba75c456) and [iOS lifecycle-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/aea66aca-3d42-4ced-bc5f-6a9b1c695db0) also compiled successfully on October 12. Android includes OS-specific permission handling, `neverForLocation` declarations for Android 13+, radio checks, and native startup cancellation. iOS includes foreground validation, main-queue startup completion, session cancellation, and reusable SDK objects. Camera and dialog JavaScript changes made after the Android archive load through Metro. Install the updated binaries for native permission/lifecycle changes; physical-device acceptance remains separate from compilation.

The [iOS automatic-broadcast/allocator-fix development build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/5cea1f40-ebdd-4d62-ab53-360a27038eaf) compiled and archived successfully on October 12. Its cloud log confirms the allocator patch ran, Fastlane used `/tmp/pipernet-swift-packages` with resolution/automatic updates disabled, and the patched `mem.c` compiled. Inspection of the packaged app confirms `_pipernet_boringssl_sdallocx` is present, replacing the colliding allocator function. After installing it, the user confirmed sharing between physical Android and iOS phones. The paired iPhone's library and journal also contain received photos and durable outgoing receipts. This establishes a working encounter, not every radio or lifecycle case. Automatic `PN1` discovery changes can load through Metro on the previously compiled Android permission-fix binary.

The iPhone then showed `UnexpectedException: Cannot Open` in Settings while connected. A local AVFoundation diagnostic using one of its valid outgoing videos opened identical bytes as `.mp4` and rejected them as `.bin` with `AVFoundationErrorDomain -11828 Cannot Open`. Received video adoption and transfer-warning recovery are JavaScript fixes; they do not themselves require a new native build. Automated tests cover awaited adoption, retained format validation, failed-file cleanup, cancellation/backoff, and clearing errors only after successful transfers. The repaired video receive path still needs a physical-device retest.

Automated tests simulate automatic discovery/handshake, deterministic initiation, slot reservation/capacity, failed/late callbacks, endpoint changes, fair rotation, A → B → C across separate encounters, relay consent, loop suppression, retries/backoff, corrupt payload rejection, journal failures, expiry, pause, and replay after deletion. A compiled C regression fixture checks the allocator with a conflicting Folly-style variable symbol. They do not measure compression quality or radio behavior. Run `bun run check` before delivery. With the `xcodeproj` Ruby gem available (bundled with CocoaPods), `ruby tests/nearby-install.test.rb` checks saved project graphs for package registration, single linking, repeat-install behavior, and repair of missing links. These configuration checks do not resolve/download the package or compile native code; successful EAS builds and device tests remain separate requirements.

Physical-device acceptance:

1. Install newly built BLE binaries and test iOS/iOS, Android/Android, and iOS/Android pairs in both directions with internet and Wi-Fi **off** and Bluetooth on. Include Android without usable Play services. Separately repeat Nearby with both phones in Nearby mode and Bluetooth/Wi-Fi enabled. Confirm automatic discovery/connection without a Connect action. Both phones must load the current JavaScript bundle; older advertisements are ignored.
2. Capture photos and 5-, 30-, and 60-second videos. Check timestamp readability, front/back camera orientation, audio, actual duration/bytes, throughput, and battery use. Confirm the stamp survives transfer/relay, Inbox shows the original capture time, and there is one Inbox item and a durable peer receipt.
3. Disconnect during offers/transfers, reconnect automatically, restart apps, and verify BLE resumes retained bytes before producing a durable receipt. Exercise zero-length/full partials, cache eviction, quota exhaustion, and transport switching. Confirm deleted received items do not return.
4. Have A share to relay-enabled B, disconnect A, then connect B to C. Confirm C receives once while A and C never meet. Disable B's relay setting and confirm forwarding stops.
5. Test denied/revoked permissions, disabled radios, low disk, failed connections, foreground/background transitions, quotas, and stalls. Locking the screen pauses the foreground mesh.

Private recipient routing, sender signatures/persistent key trust, end-to-end ciphertext-only relays, rotating identifiers, simultaneous transport handoff, background service, and a cryptographic audit are **not implemented**. Encrypted immediate links must not be described as Find My privacy or confidential end-to-end relaying.
