# PiperNet mesh architecture

Status: a foreground broadcast mesh and compression pipeline are implemented in source. Automated protocol tests run without radios. Native compilation and physical-device verification have separate evidence requirements; JavaScript tests do not establish iOS/Android interoperability or measured throughput.

As of October 14, 2026, **direct Bluetooth Low Energy (BLE) is the only sharing transport in source**. Google Nearby Connections, its platform SDKs, Wi-Fi/hotspot setup, and the transport selector have been removed. Existing journals migrate without losing sharing preferences, queued media, receipts, or tombstones. This native change and Save to Photos/Gallery require the next user-started tester release; previously uploaded binaries still contain Nearby. Physical-device BLE interoperability and throughput remain unverified.

## Product behavior

Inbox’s top-right gear opens Settings as a modal sheet, leaving Record and Inbox as the two tabs. Onboarding enables two persistent sharing controls after nearby access succeeds. **Auto-share captures** joins nearby sharing and automatically saves compressed captures to the outgoing queue. It also enrolls existing outgoing captures less than 24 hours old. **Relay received media** permits forwarding received files to other connected phones. Discovery, connection initiation, and link handshake acceptance are automatic for compatible PiperNet phones. Settings shows connection state without Connect or code-confirmation buttons. Broadcast sharing does not authenticate a person or trusted device; nearby participants can keep shared media.

Onboarding requires camera and Bluetooth access; microphone denial allows silent video. The Bluetooth step has no skip action. It requests platform permissions, waits for the app to regain foreground/focus after OS prompts, then briefly starts/stops native discovery to validate access and surface the iOS Bluetooth prompt. Only after success does it persist auto-sharing and relaying, then mark onboarding complete. The access probe stops before enabling the runtime; automatic connections begin after entering the app. Denied access stays on the step with retry/device-settings recovery; failed completion rolls back sharing settings. Permission tasks are exclusive and cancelled when a screen departs. Resume checks permissions without prompting and exposes revoked access in Settings. Record shows no persistent sharing banner or automatic-queue success toast.

This release shares media with everyone participating along the forwarding path. A receiving phone can view, retain, and (with relay enabled) forward it. This broadcast model replaces the earlier proposal's private-recipient assumption. Received media appears in Inbox; there is no hidden transit cache. A relay acknowledgment does not prove that every phone received a file.

No account or internet service participates in media delivery. BLE requires Bluetooth and supported advertising/GATT hardware, without Wi-Fi, location on Android 12+, or Google Play services. Android 11 and earlier require location access/services for BLE discovery. PiperNet must remain in the foreground. Internet shutdowns do not inherently prevent local links. A jammer affecting Bluetooth can prevent discovery and transfer; software cannot promise delivery through such interference. Captures persist and forwarding resumes after a usable link returns and a compatible phone connects automatically.

## Inspiration and transport

[Bitchat](https://github.com/permissionlesstech/bitchat) informs local discovery, duplicate suppression, limited propagation, and carrying messages between encounters. [Apple Find My](https://support.apple.com/guide/security/find-my-security-sec6cbc80fd0/web) informs the idea of nearby devices carrying reports. PiperNet does not implement either wire protocol, access Apple's Find My network, or inherit its privacy properties or internet reporting infrastructure.

BLE-only sharing removes Wi-Fi/hotspot negotiation and Google SDK dependencies. It simplifies the radio and permission model, but does not imply faster file delivery: Nearby Connections also works without internet, and can use faster Wi-Fi links ([Nearby overview](https://developers.google.com/nearby/connections/overview)). BLE transfer speeds depend on phones, radio conditions, and concurrent links. Photos and short compressed clips are the practical starting point for testing; no throughput claim has been established.

The BLE module uses OS GATT APIs, an established Noise implementation, and the shared native framing/file engine below. Video encoding remains in native libraries through `react-native-compressor`. File hashing and media validation live in a separate system-API-only module, `modules/media-inspector/`, so they no longer depend on any radio SDK.

Native startup is scoped to one session generation. Backgrounding cancels a pending start, and callbacks from a stopped session cannot finish a later retry. Both platforms wait for foreground after permission prompts before starting discovery. Android capture keeps one camera view while changing photo/video outputs, avoiding teardown of the process-wide CameraX provider by a replaced view. On iOS, Inbox uses native scroll insets and a full-height list behind the floating tab bar; fixed capture controls and Android screens retain bottom safe-area padding.

## Implemented BLE transport

`modules/ble-transport/` implements automatic BLE advertising/scanning, iOS Core Bluetooth central/peripheral roles, and Android GATT client/server roles. There is no Bluetooth Settings pairing, account, or connection button. Participating foreground phones advertise the PiperNet service, probe its identity characteristic, establish an encrypted stream, and enter the existing coordinator's automatic admission/hello flow. This is an application mesh over GATT, not Bluetooth SIG Mesh, and it does not interoperate with Bitchat.

Settings controls auto-sharing and relaying, with Bluetooth connection status and permission recovery. There is no transport selector, fallback, or Wi-Fi upgrade. Startup failures surface in Settings. `session-transport.ts` rejects late callbacks from stopped or failed Bluetooth sessions.

### Discovery and encrypted records

The service UUID is `BE516B00-5E69-4F91-A91F-3A86A4C10701`; identity and stream characteristics use `BE516B01` and `BE516B02` with the same suffix. Advertisements carry the service UUID only. A read-only characteristic carries the 16-byte installation UUID. The lexically smaller `PN1:<UUID>` initiates the encrypted stream after subscribing to notifications, avoiding symmetric connection attempts. The encrypted identity must match the discovery read. Stable installation IDs are untrusted scheduling handles, not authenticated people or rotating privacy identifiers.

Both platforms compile the same C engine in `shared/PiperBle.c`. It uses **Noise_NN_25519_ChaChaPoly_SHA256**, with prologue `PiperNet BLE stream v1`, from [Noise-C](https://github.com/rweather/noise-c/tree/cfe25410979a87391bb9ac8d4d4bef64e9f268c6). Vendored sources are pinned and checked against `vendor/noise/manifest.json`; its upstream license is retained. Only the required algorithms are compiled via `sources.json`. Noise NN supplies ephemeral encryption and detects altered encrypted records; **it does not authenticate identities or resist an active man-in-the-middle**. It does not implement Bitchat's static-key/Noise XX trust model. Broadcast participants can still read and keep media. A cryptographic audit and authenticated persistent keys remain future work.

Records use a two-byte network-order length prefix and bounded encrypted identity, control, file-start, acknowledgment, data, and cancellation payloads. Controls retain the existing ASCII JSON v1 protocol. The length prefix is untrusted and capped before allocation; malformed or tampered records close the session. There is a 64 KiB outgoing queue, an 8 KiB control limit, and a 32-event native queue. Before coordinator acceptance, at most eight controls are buffered.

GATT fragments honor the actual write/notification size. Central writes wait for write completion; peripheral sends respect platform notification backpressure. Android requests a larger MTU but supports the 20-byte baseline. All session state/file work runs on one serial native worker per platform. Progress crosses the bridge at most twice per second per direction; whole media never enters JavaScript.

### Files and resumption

BLE carries both photos and full videos under the existing 100 KiB photo / 5 MiB video limits. Files use 4 KiB native chunks with content hash, total size, contiguous offset, and stop-and-wait acknowledgments. At most one bulk chunk per direction awaits acknowledgment, bounding the bulk data ahead of new controls. The receiver opens a file only after coordinator admission. A reconnect creates a fresh encrypted session and resumes from the receiver's retained `.part` length. Completion still requires the coordinator's full-file SHA-256, length, and media-format checks, durable library/journal commits, and final receipt.

Partials live under the app cache directory, use hash-derived names, expire after 24 hours, and reserve space within 50 MiB / 128-file limits before admission. Cleanup runs on startup/admission; the OS may also evict cache files, in which case transfer restarts. Partials survive an ordinary disconnect or process restart, but cancellation can interrupt both file directions and in-flight records may close the link. Retrying resumes retained bytes. A corrupt completed partial is deleted by validation rather than accepted as delivery.

BLE supports the complete media workload in source, but throughput is unmeasured. At an **assumed** sustained 10 KiB/s, a 100 KiB photo takes 10 seconds and a 3 MiB video about 5.1 minutes per link, before setup, contention, and retries. These are arithmetic examples, not benchmarks. Every store-and-forward hop copies and validates the full file.

### Runtime limits and native integration

BLE tracks at most 32 scan candidates and three raw links (including an identity probe); the coordinator admits at most two media peers. Only one unresolved outbound connection is dialed at a time. Native links have a 20-second setup/acceptance deadline, a 15-second reconnect cooldown, and a 100-second inactivity deadline. Idle links rotate when other candidates are waiting. Application transfer progress refreshes the existing 90-second stall deadline, so a continuously progressing video is not subject to a 90-second total-transfer deadline.

Android 12+ requests only Bluetooth scan/advertise/connect permissions for sharing, with `neverForLocation` on scanning. Android 11 and earlier request the required location access; unsupported advertising and disabled radios produce actionable errors. `plugins/with-bluetooth.js` supplies Bluetooth declarations and caps legacy Bluetooth/location permissions at API 30. There are no Nearby Wi-Fi permissions, hotspot/Wi-Fi entitlements, Google Bonjour services, or iOS location requests. Expo’s development launcher adds its own local-network/Bonjour entries for Metro and removes them in Release builds. Gallery saving has separate add/write-only permissions.

The [Expo SDK 57 local module workflow](https://docs.expo.dev/modules/get-started/) autolinks the Swift/Kotlin wrappers. CocoaPods and CMake compile the same source list; Android links the shared library for 16 KiB page alignment. New native builds are required; this cannot ship solely by OTA. Foreground-only lifecycle remains intentional. Native background hooks stop radios and pending startup even when JavaScript is delayed; the coordinator reconciles sharing on app resume. [iOS background advertising restrictions](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html) and [Android background execution requirements](https://developer.android.com/develop/connectivity/bluetooth/ble/background) need separate design and device evidence before promising background relaying.

## Automatic discovery and broadcast scheduling

The scheduler borrows Bitchat's bounded connection queue, retry cooldowns, duplicate suppression, and opportunistic encounters ([connection scheduler](https://github.com/permissionlesstech/bitchat/blob/main/bitchat/Services/BLE/BLEConnectionScheduler.swift), [whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md)). BLE probes identities and schedules raw radio links natively. The coordinator then owns automatic admission, application handshakes, media exchange, and relaying.

Service advertisements lead to an identity-characteristic read; the lower installation UUID initiates the encrypted stream. The coordinator accepts compatible incoming handshakes automatically, ignores self/duplicate identities, and bounds admitted media peers to two. It retains connection-generation checks and bounded retry/candidate scheduling. A missing application hello times out after 15 seconds. Stopped-session callbacks cannot cancel a new connection attempt.

When another phone is waiting, an idle connection rotates after 30 seconds with a 30-second cooldown. Active file transfers are not rotated. The two-link limit bounds simultaneous radio work, not the total recipients: each file remains eligible for later encounters until its hop/lifetime/byte limits expire. Sender receipts retain 128 recent recipients; receiver inventories, SHA-256 content IDs, durable library IDs, and deletion tombstones suppress duplicate deliveries even after receipt history rolls over. Stable installation IDs are scheduling handles, not privacy-preserving rotating identifiers.

## Implemented components

| Component                                      | Responsibility                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/app/(tabs)/index.tsx`                     | Capture, preview when sharing is off, automatic durable queuing when enabled                |
| `src/app/settings.tsx`                         | Sharing controls, permission recovery, automatic peer status, progress/errors               |
| `src/app/onboarding/bluetooth-permissions.tsx` | Required Bluetooth access and enabling sharing before onboarding completion                 |
| `src/app/(tabs)/inbox.tsx`                     | Settings entry, media preview/saving/deletion, and per-capture peer receipt count           |
| `src/lib/media-files.ts`                       | JPEG compression, native video transcoding, validated drafts, thumbnails, owned files       |
| `src/lib/mesh/protocol.ts`                     | Versioned control frames, allowlisted fields, envelope/resource validation                  |
| `src/lib/mesh/session-transport.ts`            | Bluetooth lifecycle and late-event isolation                                                |
| `modules/ble-transport/`                       | BLE central/peripheral roles, shared Noise records, native resumable files                  |
| `src/lib/mesh/coordinator.ts`                  | Serialized scheduling, persistent journal, inventories, offers, receipts, retries, relaying |
| `src/hooks/use-mesh.ts`                        | Lifecycle ownership, library reconciliation, Zustand snapshots                              |
| `modules/media-inspector/`                     | Incremental SHA-256 and actual media inspection using platform APIs                         |
| `modules/media-stamp/`                         | Native visible capture timestamps in JPEG pixels and video frames                           |
| `plugins/with-bluetooth.js`                    | CNG Bluetooth permissions and legacy Android location declarations                          |

BLE uses 4 KiB file chunks. Hashing uses 64 KiB native buffers. Whole videos and base64 media never enter JavaScript. Progress events are throttled to twice per second per transfer direction. Durable media lives in the document directory; incoming resources and adopted compression outputs use owned cache files. Remote filenames/paths never become library filenames.

## Compression and bandwidth

Photos re-encode to JPEG using 640 px / quality 0.35, 480 px / 0.25, then 320 px / 0.20, preserving aspect ratio and refusing output above **100 KiB**. Capture disables EXIF. Received metadata is never treated as trusted sender information.

New captures burn a compact two-line date/time stamp into the lower-left corner: for example, `14 Oct 2026` and `10:08 AM`. White text with a thin dark outline and shadow stays legible without a background panel. It freezes the device's local date and 12-hour time at the shutter press or video start; the original millisecond timestamp remains in metadata. Photos resize to a lossless intermediate, then stamp and encode to JPEG at each quality pass; the byte limit applies to the stamped result. Video stamping uses AVFoundation on iOS and Media3 Transformer on Android, preserving display orientation and audio before the existing compression passes. Android accepts camera quality fallbacks such as 720×480 or HD, accounts for display rotation, and resizes to even dimensions within 640 px before applying the overlay. The overlay bitmap is allocated at this bounded output size. This adds one native video export and requires new TestFlight/Android release binaries. Originals and stamp intermediates are cleaned up after processing. Saved/received metadata preserves the original creation time, and Inbox shows both date and time. Received files are never stamped again; older files retain their existing pixels and timestamps. Device clocks are self-reported.

The full-screen Inbox preview offers **Save to Photos** (iOS) or **Save to Gallery** (Android) for received and queued photos/videos. This copies the complete local file, including its existing watermark, without moving the PiperNet copy or re-encoding it. A busy state prevents overlapping save/delete actions, and a completed save stays marked in the current preview to avoid accidental duplicate taps. Permission denial offers a retry or device Settings. The [SDK 57 `expo-media-library`](https://docs.expo.dev/versions/v57.0.0/sdk/media-library/) implementation uses add-only access on iOS, MediaStore without a permission prompt on Android 11+, and write-only storage access on older Android. No gallery read or media-location access is requested by this feature. It adds a native dependency and requires the next user-started tester build; the October 14 iOS build `4` and Android version code `5` were submitted before this feature and do not include it.

Videos record at 480p with a 400 kbit/s capture hint, then undergo real native transcoding through `react-native-compressor`. Manual passes use 480 px / 240 kbit/s, 360 px / 160 kbit/s, and 240 px / 96 kbit/s, always from the original. The first output within **3 MiB** wins. Output must contain H.264, have at most a 640 px encoded edge, and last at most 60 seconds (0.5 seconds of tolerance). Audio is retained. Bitrate is a target; actual bytes are checked. Oversized output is rejected with a shorter-clip suggestion. Encoders and audio overhead prevent a guaranteed compression ratio.

Incoming videos may use the protocol's 5 MiB hard limit for older captures. Legacy opaque `.bin` resources are moved asynchronously into owned `.mp4` cache files before video inspection: AVFoundation rejects otherwise valid MP4 bytes under the `.bin` extension. This move does not change bytes or bypass validation. Native inspection checks image dimensions before thumbnail decoding, and checks video tracks/codec, dimensions, and duration. Thumbnails are generated locally and never transmitted. Compression, missing-only inventories, receipt suppression, and bounded concurrent connections reduce transmitted bytes. The delivery protocol uses no cellular connection.

## Protocol and durability

ASCII JSON frames contain `v: 1`. Types are `hello`, `inventory`, `offer`, `accept`, `busy`, `cancel`, and `receipt`. Hello exchanges a random installation UUID: a scheduling handle, **not a public-key identity**. BLE encrypts the immediate link but Noise NN has no static-key authentication; the installation UUID is self-reported. Display names identify the immediate sending phone and do not establish original authorship.

An envelope contains SHA-256 of compressed bytes as its ID, kind, byte length, creation/expiry times, and hop count. Its identity survives retries and relays. A hash proves byte equality with an offer, not authorship. A connected participant can originate untrusted content or alter unsigned routing metadata. Local quotas apply regardless of remote claims.

1. Discover a compatible PiperNet service/`PN1:<installation UUID>` identity and connect automatically; exchange a matching hello and bounded pages of known hashes.
2. Offer missing files, preferring local captures, within relay/hop/expiry/byte limits.
3. Admit one incoming file, reserve expected size, and check free disk space before accepting. Reject unsolicited resources, streams, excessive lengths, and oversized controls.
4. Receive natively; verify actual length/hash, then inspect actual type, dimensions, and duration.
5. Save using deterministic library ID `mesh-<hash>`. Persist its mesh record and deletion-resistant tombstone, then send a receipt. Native completion alone is not a receipt.
6. Delete incoming temporary files, announce the new inventory, and relay when enabled.

The AsyncStorage journal stores settings, installation UUID, envelope/library mappings, source peer, forwarding receipts, and tombstones. Writes persist before publishing observable state. Library and journal commits remain separate; deterministic IDs reconcile a crash between them. The library must hydrate before journal pruning. Local capture remains usable when discovery is unavailable.

Deleting media removes its forwarding mapping and cancels local work; tombstones remain for 48 hours to suppress replay within the accepted lifetime. Existing disconnected copies cannot be recalled. Expiry stops network forwarding without deleting the user's library files. Received forwarding is also capped at 24 hours from local admission, bounding clock skew. There is no global broadcast delivery receipt.

Interrupted BLE transfers resume retained contiguous chunks. Failed incoming validation releases admission and sends a cancellation so the sender can retry with backoff rather than waiting for the receipt timeout. Original and relocated temporary files are discarded after saving or failure. A successful receive or durable peer receipt clears the previous transfer warning in Settings. There are up to four attempts per peer encounter with exponential backoff and jitter. Attempt/backoff state is in memory and resets after process restart. Receipts and deduplication persist. Disabling relaying cancels outgoing relay work. Durable retry backoff remains future work; BLE partial bytes are retained independently of that in-memory attempt counter.

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

`modules/media-inspector/` autolinks independently on iOS and Android and uses system APIs for incremental SHA-256 and bounded JPEG/H.264 inspection. No Google Nearby Gradle dependency, Swift package, Podfile hook, or allocator patch remains. The shared BLE engine and its vendored Noise dependency remain unchanged. Generated native projects remain untouched by hand.

Select the intended Expo account and project:

```bash
bunx eas-cli login
bunx eas-cli whoami
bun run build:testflight
bun run build:android-release
```

iOS TestFlight builds require Apple signing credentials and App Store Connect access; testers install through TestFlight without registering device UDIDs. Android testers install the signed release APK directly. See [EAS setup](https://docs.expo.dev/build/setup/).

TestFlight and Android release APKs are the default for physical-device testing. Prepare changes and run local checks, then let the user start the release commands; do not launch builds or submissions without an explicit request. Both embed the JavaScript bundle and start without Metro, including with Wi-Fi disabled. Only create development clients when explicitly requested for debugging: `bunx eas-cli build --profile development --platform all`, then `bunx expo start --dev-client`. Internal iOS development/preview distribution requires registered devices. Preview releases remain available for separate OTA testing.

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

The October 13 [iOS BLE release](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/4ff57df8-54fc-44e8-840c-a6bbe4e8b1a4), version `1.0.0 (3)`, and [Android BLE APK](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/178f9549-1c47-43c8-b6fd-b63646f5885f), version code `4`, compiled successfully with embedded bundles and the BLE module. These older releases still offer Nearby. Successful packaging does not establish physical BLE interoperability or throughput.

The October 14 [iOS capture/UI fix build](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/9abc75d3-72ca-4b1a-b7b0-687e292bae58) compiled as `1.0.0 (4)`. Its restored [TestFlight submission](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/submissions/7ec9ca5c-c4c8-45b8-b7ad-90982d6c3b42) and the [Android capture/UI fix APK](https://expo.dev/accounts/sreedhar_k.s/projects/pipernet/builds/c4471ba1-7572-4e44-b5d3-e8f2397754d1), version code `5`, were queued at the last check. Those snapshots include the Android dimension fix, floating Inbox content, and compact timestamp, but **not** Save to Photos/Gallery or the removal of Nearby. No additional builds were started for these later changes.

The App Store Connect app ID is `6821802740`, saved in the production submit profile. Its listing name is `PiperNet (ce5d76)` because `PiperNet` was taken; the installed app retains the name PiperNet. Earlier physical cross-platform sharing was confirmed using Nearby only, and is not evidence for the current BLE path.

## Verification and future work

The Bluetooth-only source passes lint, typecheck, and all **114 automated tests**. Regression coverage includes migration from both saved transport choices without losing media/receipts/tombstones, failed migration writes and retry, stale Bluetooth session callbacks, platform permission boundaries, Expo config introspection, and autolinking the independent media inspector on both platforms without Nearby or `expo-location`. Local Swift/Kotlin compiler checks validate the extracted inspector against real platform APIs using Expo bridge stubs; they do not replace a full native build or device tests.

The native BLE engine runs under address/undefined-behavior sanitizers against an independent Noise NN vector, one-byte handshake fragmentation, 20-byte controls, interrupted/resumed transfers, a full 5 MiB file with reverse traffic, tampering, unsolicited files, and queue/size bounds. Protocol tests simulate automatic discovery/handshake, capacity, failed/late callbacks, fair rotation, A → B → C across separate encounters, relay consent, loop suppression, retries/backoff, corrupt payload rejection, journal failures, expiry, pause, and replay after deletion.

Capture tests cover midnight/noon formatting and invalid timestamps. The JVM fixture `tests/native/capture-video-geometry.kt`, compiled with production `CaptureVideoGeometry.kt`, passes 11 source-size/rotation cases and rejects seven invalid inputs. The iOS timestamp renderer typechecks against the Apple SDK. Gallery-save tests cover add-only access, existing grants, denial/Settings recovery, Android version differences, and failed saves followed by retry. The last Expo Doctor check passed 20/21 checks, recommending newer patch versions for ten existing Expo packages; `expo-media-library` matches the installed SDK’s `~57.0.5` requirement.

Run `bun run check` before delivery. Native changes require the next user-started TestFlight/Android APK release; no new build was launched for this removal or gallery saving. Physical-device checks remain necessary.

Physical-device acceptance:

1. Install newly built BLE-only binaries and test iOS/iOS, Android/Android, and iOS/Android pairs in both directions with internet and Wi-Fi **off** and Bluetooth on. Include Android without usable Play services. Confirm automatic discovery/connection without a Connect action or OS pairing. Upgrade a device previously set to Nearby and verify that its queue, receipts, and sharing preferences survive.
2. Capture photos and 5-, 30-, and 60-second videos. Check timestamp readability, Android portrait/landscape output, front/back camera orientation, audio, actual duration/bytes, throughput, and battery use. Confirm the stamp survives transfer/relay, Inbox shows the original capture time, and there is one Inbox item and a durable peer receipt. Confirm iOS Inbox content flows behind the floating tabs and the last row stays reachable.
3. Disconnect during offers/transfers, reconnect automatically, restart apps, and verify BLE resumes retained bytes before producing a durable receipt. Exercise zero-length/full partials, cache eviction, and quota exhaustion. Confirm deleted received items do not return.
4. Have A share to relay-enabled B, disconnect A, then connect B to C. Confirm C receives once while A and C never meet. Disable B's relay setting and confirm forwarding stops.
5. Save received and queued photos/videos from Inbox to Photos/Gallery. Check the full file, watermark, original PiperNet copy, denial/retry/Settings recovery, and save failure recovery on both platforms.
6. Test denied/revoked permissions, disabled Bluetooth, legacy Android location requirements, low disk, failed connections, foreground/background transitions, quotas, and stalls. Locking the screen pauses the foreground mesh.

Private recipient routing, sender signatures/persistent key trust, end-to-end ciphertext-only relays, rotating identifiers, background service, and a cryptographic audit are **not implemented**. Encrypted immediate links must not be described as Find My privacy or confidential end-to-end relaying.
