# slopcoder-mobile

A React Native client for slopcoder, a self-hosted coding agent. It
creates sessions and watches them run — and, when the agent stops to ask permission,
lets you answer from wherever you are.

It is a **thin client**. The server owns the session; this app never executes anything.
Sessions it creates run in the server's Docker sandbox, the same as the web cockpit's.

## What it does

- Sign in with a password, or by scanning a pairing code from the web UI
- Create a session: repo search, remote nodes, model, facet, thinking level, approval mode
- Attach photos to a message, from the library or the camera, and see them in the transcript
- Watch a turn stream in, steer it mid-flight, stop it
- Answer permission approvals and agent questions
- Keep an eye on routines: what has run, what failed, what is next — pause one, run it
  now, retry a failure, fix its prompt, close a trigger, rotate a webhook's secret
- Write a routine: describe it in a sentence and the model drafts the form, or fill it in
  yourself — schedule in English, triggers, model, repositories and nodes, where the
  answer goes; edit an existing one; set the heartbeat's cadence, hours and model

## What it deliberately does not do

Code mode, the terminal, and the workspace diff panel. All three are SkiaSharp canvases
over WebAssembly in the web app and have no native path short of a rewrite. If you need
them, open the session on a computer.

## Layout

```
src/api/          the seam client — this is the part to read first
  contracts.ts    wire types, hand-ported from SlopCoder.Contracts
  seam.ts         HTTP; every command the app can issue
  hub.ts          SignalR; the live half
  stream.ts       reassembling a transcript from deltas
  transcript.ts   folding events into renderable items
  routines.ts     how a routine reads — a port of RoutineFormat.cs
  routineEditor.ts what the editor decides — a port of TriggerEdit.cs and Editor.razor's draft
src/state/        auth (keychain), the hub connection, one session's live view
src/screens/      login (+ scanner), sessions (list + launcher), session detail, routines, routine, routine editor, usage, settings
src/navigation/   the tab bar and the native-header options every stack shares
src/theme.ts      the web cockpit's tokens, converted to sRGB
```

## The protocol, in the five facts that matter

Everything here is enforced by a test, because each one fails *silently* in production.

1. **`X-Slopcoder-Client: 1` on every non-GET.** `SameOriginFilter` guards the whole
   `/api/seam` group and answers a missing header with a bare 403 and no body — bearer
   callers included.
2. **Enums travel as integers.** The server uses `JsonSerializerDefaults.Web`, which adds
   no string-enum converter. `ApprovalMode` reserves `3` for a retired member; never
   renumber it.
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

## Requirements

iOS 16 or later. VisionCamera is built on Nitro, which compiles Swift with C++ interop, and
Swift's `CxxStdlib` requires 16 — React Native's own default of 15.1 does not build.

## Developing

```bash
npm ci
npm start                 # Metro
npm run android           # or: npm run ios   (needs macOS + pods)
npx tsc --noEmit && npx eslint . --ext .ts,.tsx && npx jest
```

Point it at a slopcoder instance and sign in.

`scripts/wire-check.cjs` drives the compiled client against a running server and asserts
the five facts above — most importantly that `Delta` binds four arguments. Run it whenever
the seam or the hub changes; the unit tests cannot see any of it.

### Liquid Glass

The composer and the sheets are `GlassSurface`, which is `@callstack/liquid-glass` on iOS 26
and the card we already had everywhere else. `isLiquidGlassSupported` is false on Android and
below iOS 26, and the deployment target is 16 — so the fallback is not an edge case, it is
what most of the matrix renders, and it has to look finished on its own.

Glass refracts what is *behind* it, so it only earns its place on a surface that floats over
content. That made it a layout change rather than a material swap: in the cockpit the
composer is now absolutely positioned and the transcript scrolls under it, with the list's
bottom padding measured from the composer's own `onLayout` — it grows with the text and with
however many dials are off default.

Only those two surfaces use it. A glass panel over a plain background is a flat tint and not
worth a native view.

### Fonts

`assets/fonts/` holds five static cuts of Geist, Geist Mono and Baloo 2 — all SIL OFL 1.1,
see `assets/fonts/OFL.txt` and the notes beside them.

Geist and Geist Mono ship upstream as *variable* fonts, and React Native honours no weight
axis — it would render everything at 400 whatever `fontWeight` said. So they are instanced
with `fontTools` at the two weights this app actually uses, and each cut's PostScript name
is set equal to its filename, which is what lets one `fontFamily` string resolve on iOS
(which looks up a PostScript name) and Android (which looks up an asset filename).

Pick a family, never a weight: `font.sans` / `font.sansMedium` / `font.mono` /
`font.monoSemiBold` / `font.display`. Setting `fontWeight` alongside one does nothing.

To add a weight: instance it, flatten its names the same way, drop it in `assets/fonts/`,
re-run `npx react-native-asset`, and add it to `font` in `src/theme.ts`.

## Building

CI is on GitHub because macOS runners are free for public repositories; this repo is
mirrored there from Forgejo for that reason.

- `ci.yml` — typecheck, lint, tests, an Android debug build, and an unsigned iOS simulator
  build. No secrets, so fork pull requests get real signal.
- `release.yml` — signed builds on a `v*` tag only. Android attaches an APK and AAB to the
  release; iOS uploads to TestFlight. iOS needs an Apple Developer Program membership.

Required secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`,
`IOS_PROVISIONING_PROFILE_BASE64`, `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`,
`APP_STORE_KEY_BASE64`.

## Siri

Three App Intents and an entity, in `ios/slopcoder_mobile/Intents/`:

- **Start a Session** — "Hey Siri, start a slopcoder session." Asks what to work on, and
  optionally which repository (offered from your recent ones).
- **Check Running Sessions** — "Hey Siri, what is slopcoder doing?" Says what is running,
  how far into its context, and whether anything has stopped to ask you something.
- **Open Session** — "Hey Siri, open the pairing QR session in slopcoder."
- **`SessionEntity`** — an intent describes what the app *does*; an entity describes what
  it *knows*. Without the second, sessions are only words in a spoken reply: Siri cannot
  refer back to one, resolve a spoken title to it, or offer it in Spotlight. Both the other
  intents return entities, so a follow-up or a downstream Shortcuts action operates on the
  sessions rather than on the sentence describing them.

All three are registered as App Shortcuts, so they work with no setup. Only **Open Session**
brings the app forward; `openAppWhenRun` is false on the other two, because the point is to
start or check work without stopping what you were doing.

Note on the layering: App Shortcuts supplies fixed phrases. iOS 27's **App Schemas** are the
semantic route that needs no phrases at all, but they are typed to Apple's domains — mail,
photos, books, journal, presentations, spreadsheets, system — and a coding session fits none
of them. If a developer-tools domain ever appears, conforming is the upgrade.

They are **Swift, and they do not go through the React Native bridge**. Siri can invoke an
intent without launching the app, and booting the JS runtime to make two HTTP calls would
be slow and would fail in ways that are hard to explain to someone holding a phone. So
`SeamClient.swift` is a second, deliberately small implementation of the same contract the
TypeScript client speaks, and `Credential.swift` reads the device key straight out of the
keychain item the JS side wrote — an intent runs in the app's own process, so no access
group or entitlement is needed.

There is **no approve-a-tool-call intent**, on purpose. Approving a command by voice is a
capability worth adding deliberately rather than by default.

Opening a session goes through the app's own URL scheme, `slopcoder://session/<id>`: the
AppDelegate posts the notification React Native's Linking already listens for, and React
Navigation's `linking` config routes it. That contract spans Swift and TypeScript with
nothing in between, so `__tests__/deep-link.test.ts` reads the URL out of the Swift, runs it
through the real router, and checks the scheme is in Info.plist.

Since there is no Swift toolchain on Linux, `__tests__/xcode-project.test.ts` checks that
every file the target compiles actually exists at the path the project claims — Xcode
resolves through the whole group chain, and a doubled path fails only on a macOS runner.

**Native push** works without the server ever holding an Apple key. The app trades its
APNs token for a Web Push endpoint at a *relay* — the slopcoder deployment that publishes
this app (`SLOPCODER_PUSH_RELAY` at build time) — and subscribes on whichever instance
it is signed in to with that endpoint and a keypair it made, exactly as a browser would.
The instance sends ordinary Web Push; the relay forwards the ciphertext to Apple; the
notification service extension (`ios/NotificationService/`) decrypts it on the phone.
The endpoint is kept with the token it was minted for and reused across launches; the
relay is only asked again when Apple rotates the token, so an instance holds one row
per phone rather than one per launch.
Anyone can host slopcoder and have this app notify them. Android is still to do: a
UnifiedPush distributor would need no relay at all, and FCM would need a second relay
backend.
