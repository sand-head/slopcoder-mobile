# slopcoder-mobile

The iOS client for slopcoder, a self-hosted coding agent. It creates sessions and watches
them run — and, when the agent stops to ask permission, lets you answer from wherever you
are.

It is native Swift, one SwiftPM package, and **it builds on Linux**: `swift test` for the
logic, [xtool](https://github.com/xtool-org/xtool) for the app. There is no Xcode project
and nothing here needs a Mac.

It is a **thin client**. The server owns the session; the phone never executes repository
code or session commands. Sessions it creates run in the server's Docker sandbox, the same
as the web cockpit's. Self-contained HTML artifacts are the deliberate exception: they
run in an OS WebView under the server's opaque-origin sandbox, without an app bridge or
access to the device credential.

> **Status of the port.** This was a React Native app until commit `3c8a82f`; that tree is
> the reference if a behaviour here looks wrong. `SlopcoderCore` — about 17,000 lines, every
> rule about what the app says and does — is compiled and tested on Linux, largely against
> fixtures recorded from the TypeScript it replaces. The SwiftUI layer and the notification
> extension (about 13,000 lines) compile against the iOS 27.2 SDK and package into a
> well-formed `.ipa` on Linux — but the app **has not yet been launched on a device**, so
> nothing visual or interactive has been seen working. See
> [What has and has not been verified](#what-has-and-has-not-been-verified).

## What it does

- Sign in with a password, or by scanning a pairing code from the web UI
- Create a session: repo search, remote nodes, model, facet, thinking level, approval mode — the
  thinking dial offers what the chosen model offers (no Off on a model that always thinks)
- Attach photos to a message, from the library or the camera, and see them in the transcript
- Watch a turn stream in, steer it mid-flight, stop it; open the session's terminal
- Answer permission approvals and agent questions
- Read a session's code reviews: findings with the lines they anchor to, dismiss or reopen
  one, start a session to fix one, and publish to the forge behind a preview of exactly what
  will be posted
- Keep an eye on routines: what has run, what failed, what is next — pause one, run it
  now, retry a failure, fix its prompt, close a trigger, rotate a webhook's secret
- Write a routine: describe it in a sentence and the model drafts the form, or fill it in
  yourself; edit an existing one; set the heartbeat's cadence, hours and model
- Read and interact with what the agent published: reports, logs, self-contained HTML mini
  apps, and full-screen photos with pinch/double-tap zoom; share an unlisted link
- See what's left of a ChatGPT (Codex) or Claude (Claude Code) plan's windows on Usage
- Settings, the same eleven pages the web has: provider connections, MCP servers, remote
  nodes, terminal defaults, git identity, facets, hooks and permission rules, memory, skills,
  channels and API keys

Two settings stay web-only for a reason other than effort: the account's profile and SSO
sign-ins are Identity's cookie pages, which a device key cannot reach, and connecting a
git account is an OAuth round trip that lands on a cookie session. The phone lists and
disconnects git accounts and says where to connect one.

## Layout

```
Package.swift                 one package: iOS 17+, no third-party dependencies
xtool.yml                     how xtool wraps the products into slopcoder.app
App/                          Info.plists, entitlements, icon — everything that is not code
Sources/
  SlopcoderCore/              Foundation only. Builds and is tested on Linux.
    API/                      the seam client — read this first
      Contracts.swift           wire types, ported from SlopCoder.Contracts
      Seam.swift                HTTP; every command the app can issue
      Hub.swift                 SignalR, with its own WebSocket and long-polling transports
      Stream.swift              reassembling a transcript from deltas
      Transcript.swift          folding events into renderable items
    Presentation/             what each screen says: tool cards, routines, reviews, settings, markdown
    Terminal/                 a VT emulator for the session terminal
    State/                    auth, the hub connection, one session's live view, navigation
  SlopcoderPush/              Web Push decryption (RFC 8291), shared by the app and the extension
  Slopcoder/                  the app: SwiftUI. Compiles only against Apple's SDK.
    Kit/ Theme/               the design system
    Screens/                  one file per screen; Settings/ has the eleven pages
    Transcript/               transcript rows and tool cards
    Platform/                 Keychain, push registration, camera, haptics
    Intents/                  Siri and Shortcuts
  NotificationService/        the extension that decrypts a push before iOS shows it
Tests/SlopcoderCoreTests/     Swift Testing; Fixtures/ holds the recorded cases
```

Everything in `Slopcoder` and `NotificationService` sits inside `#if canImport(UIKit)` (or
the framework it needs), so `swift build` on Linux parses those files and compiles the rest.

## The protocol, in the five facts that matter

Everything here is enforced by a test, because each one fails *silently* in production.

1. **`X-Slopcoder-Client: 1` on every request.** `SameOriginFilter` guards the whole
   `/api/seam` group and answers a missing header with a bare 403 and no body — bearer
   callers included.
2. **Enums travel as integers.** The server uses `JsonSerializerDefaults.Web`, which adds
   no string-enum converter. An unknown value has to survive a round trip, so each is a
   struct around its raw value rather than a Swift `enum`. `ApprovalMode` reserves `3` for a
   retired member; never renumber it.
3. **`payloadJson` is a JSON *string*.** Parse it twice. `SubagentEvent` nests a second
   envelope inside the first.
4. **`Delta` takes exactly four arguments.** A SignalR arity mismatch never throws — the
   client cannot bind the invocation, drops it, and every live update dies while the tests
   stay green.
5. **Approval liveness comes from `state.pendingApprovalIds`**, never from the transcript.
   An approval answered on a laptop is still sitting in the scrollback here.

A missed push is expected, not exceptional: `SessionStream` notices a gap in the ordinals
and pulls scrollback; `LiveAccumulator` notices when it has fallen behind the sender and
asks for a fresh seed. Backgrounding a phone produces both constantly.

## Developing

Open the folder in the dev container (`.devcontainer/`): Swift 6.4, xtool, and the
libimobiledevice tools. Or install [Swift 6.4](https://www.swift.org/install/linux/) and run
`scripts/install-xtool.sh` yourself.

```bash
swift build          # the core, and a parse of everything else
swift test           # 207 tests; needs no SDK and no network
```

### Building the app

The app compiles against Apple's iOS SDK, which Apple does not let anyone redistribute — so
it is the one thing you bring. Download Xcode (`Xcode_*.xip`) from
[developer.apple.com](https://developer.apple.com/download/all/) with your own account, then:

```bash
scripts/install-darwin-sdk.sh ~/Downloads/Xcode_27.2.xip   # once; about a minute
xtool dev build                 # → xtool/Slopcoder.app, unsigned
xtool dev build --ipa           # → xtool/Slopcoder.ipa
```

The script also takes an `https://` URL, or a `darwin.xtoolsdk` (what `xtool sdk build`
unpacks from the `.xip` — larger than it, 3.3 GB against 2.0 GB). CI needs none of this;
see [CI](#ci).

To run it on a phone plugged into the machine:

```bash
xtool auth login                # your Apple ID
xtool dev run                   # builds, signs for development, installs, launches
```

A free Apple ID can sign an app for your own phone, but not this one as it stands: push
notifications and the App Group both need a paid Developer Program membership. Inside the
dev container the phone is only visible if the host's `usbmuxd` socket is shared
with it; `devcontainer.json` has the line to uncomment.

### What xtool cannot do (yet), and what that costs

- **No asset catalog.** There is no `actool` off a Mac, so the bundle carries one icon PNG
  (`App/AppIcon.png`) and no dark or tinted variants, and the launch screen is the system's
  plain background rather than the logo. `App/Assets.xcassets` keeps the full icon set for
  the day something can compile it.
- **No App Intents metadata.** Siri and Shortcuts find intents through a file Xcode's build
  extracts. The intents in `Sources/Slopcoder/Intents/` compile, but a Linux build does not
  list them with the system. Deep links (`slopcoder://session/<id>`) are unaffected.
- **Development signing only, and no upload.** `xtool dev run` signs for a registered
  device. Distribution signing and TestFlight are not wired; see
  [docs/testflight.md](docs/testflight.md).

### Design notes

- **Fonts.** Allo (sans) and Geist Mono, static cuts under SIL OFL 1.1, in
  `Sources/Slopcoder/Resources/Fonts/` and registered at launch — see
  [docs/fonts.md](docs/fonts.md). Pick a family from `AppFont`, never a weight.
- **Liquid Glass.** The composer and sheets use `glassEffect` on iOS 26 and a plain card
  below it. The fallback is what most of the matrix renders, so it has to look finished.
- **Artwork** is described in [docs/artwork.md](docs/artwork.md);
  `scripts/generate-fold-icons.py` regenerates the app icons from `assets/brand/`.

## Requirements

iOS 17 or later (the React Native app supported 16; the port uses the Observation
framework, which is 17+). iPhone, portrait.

Swift 6.4 and xtool 1.24 on the build machine, and an iOS SDK from a current Xcode (the
React Native build used Xcode 27.2's). One API newer than iOS 17 is used — `glassEffect`,
behind an availability check — so an SDK older than iOS 26 will not compile it.

## CI

Nothing to configure: no URL, variable or secret.

Apple's SDK cannot be redistributed and its download needs a sign-in, so a Linux job cannot
fetch it. A macOS runner already has Xcode installed, though. So **`xcode-sdk.yml`**, a
short job on a Mac runner, copies out of Xcode just the parts xtool builds its SDK from
(`scripts/lend-xcode.sh`, about 2 GB) into the repository's own Actions cache; the Linux
jobs restore that and run `xtool sdk install --slim`. It takes seconds when the cache is
warm, and refills it by itself when GitHub has expired it. Apple's files never leave the
repository's cache. This is the pattern other xtool projects use; xtool's own CI goes one
further and runs a Linux VM on a Mac to mount Xcode directly.

- **`ci.yml`**, on every push and pull request:
  - `test` — builds the package and runs the tests on Linux. No SDK.
  - `ios` — builds the unsigned `.ipa` and a simulator build with xtool, on Linux.
  - `simulator` — on a Mac runner, opens the Linux-built app on a simulated iPhone, fails
    if it exits within 15 seconds, and keeps a screenshot as an artifact.
- **`release.yml`**, started by hand: runs the tests, stamps the version (the date), the
  build number (the run number), the push relay (`SLOPCODER_PUSH_RELAY`, a repository
  variable) and the production APNs environment with `scripts/stamp.py`, builds in release
  configuration, and keeps the unsigned `.ipa` as the run's artifact. It does not sign for
  distribution or upload — the React Native release did, on a Mac runner.

The compiling is all on Linux; the Mac runner only lends files and hosts the simulator.

None of these has run on a runner yet. The Linux half has been replayed by hand — the
lending script run against a real Xcode 27.2, a slim SDK installed from its output, and the
`.ipa` and the simulator build made from a clean copy of the tree. The Mac half (finding
Xcode on the runner, the cross-OS cache, the simulator launch) is what a first run will test.

## Siri

Three App Intents and an entity, in `Sources/Slopcoder/Intents/`:

- **Start a Session** — asks what to work on, and optionally which repository (offered from
  your recent ones).
- **Check Running Sessions** — says what is running, how far into its context, and whether
  anything has stopped to ask you something.
- **Open Session** — brings the app forward on a session, through `slopcoder://session/<id>`.
- **`SessionEntity`** — an intent describes what the app *does*; an entity describes what
  it *knows*. Both of the other intents return entities, so a follow-up or a downstream
  Shortcuts action operates on the sessions rather than on the sentence describing them.

They use the same `Seam` client as the app and read the device key straight from the
Keychain, so they can run without the app being launched. There is **no approve-a-tool-call
intent**, on purpose: approving a command by voice is a capability worth adding deliberately
rather than by default. As noted above, a Linux build does not yet register them with the
system.

## Push

Native push works without the server ever holding an Apple key. The app trades its APNs
token for a Web Push endpoint at a *relay* — the slopcoder deployment that publishes this
app (`SlopcoderPushRelay` in Info.plist, stamped at release) — and subscribes on whichever
instance it is signed in to with that endpoint and a keypair it made, exactly as a browser
would. The instance sends ordinary Web Push; the relay forwards the ciphertext to Apple; the
notification service extension decrypts it on the phone. The endpoint is kept with the token
it was minted for and reused across launches.

The app and the extension share the push keys through the App Group
`group.codes.sand.slopcoder`, used as the Keychain access group. The React Native build used
the app's own identifier group instead; xtool's signer rewrites that entitlement per bundle,
which would leave the extension unable to read what the app wrote. The App Group has to be
registered in the developer portal and enabled on both App IDs. Keys written by the old
build are still read from where it left them.

The sign-in itself is the same Keychain item the React Native app used (service
`codes.sand.slopcoder`), so an update over the old app stays signed in.

## What has and has not been verified

Verified, on Linux, by `swift test`:

- The wire client, the SignalR hub (handshake, reconnect, long-polling fallback), stream
  reassembly and transcript folding — ported tests plus the original server fixtures.
- Tool cards, routine and settings wording, the routine editor, markdown, and the terminal
  emulator — replayed against some 4,200 cases recorded from the TypeScript implementation
  (`Tests/SlopcoderCoreTests/Fixtures/*-differential.json`). The recorder needed that
  TypeScript, which is gone from this tree; the fixtures are now the specification.
- The bundle's plists, entitlements and `xtool.yml` agree with each other and the sources.

Verified, on Linux, with xtool 1.24 and the iOS 27.2 SDK:

- `xtool dev build` and `xtool dev build -c release --ipa` succeed from a clean tree, in
  about a minute, with no warnings in the app or the extension.
- The bundle holds what it should: the app binary and its resource bundle, the extension
  under `PlugIns/` with its principal class linked in, both Info.plists merged as intended,
  and each binary carrying its own entitlements.

Not verified:

- Anything at run time. The app has never been launched: no screen has been seen, no
  sign-in made, no push received. The screens follow the React Native ones in structure
  and wording, not pixel for pixel; the session switcher is a sheet rather than a drawer,
  and code blocks are not syntax-highlighted.
- Signing with a real identity, and installing on a phone (`xtool dev run`).
- The dev container image, and the workflows on an actual runner (see [CI](#ci)).

Two deliberate differences from the TypeScript, both of which were bugs there: a schedule
confirmation never says "Invalid Date" or "null", and U+0085 is trimmed as whitespace, as
the server does.
