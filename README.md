# slopcoder-mobile

A React Native client for [slopcoder](https://git.sand.town/sand_head/slopcoder). It
creates sessions and watches them run — and, when the agent stops to ask permission,
lets you answer from wherever you are.

It is a **thin client**. The server owns the session; this app never executes anything.
Sessions it creates run in the server's Docker sandbox, the same as the web cockpit's.

## What it does

- Sign in with a password, or by scanning a pairing code from the web UI
- Create a session: repo search, remote nodes, model, facet, thinking level, approval mode
- Watch a turn stream in, steer it mid-flight, stop it
- Answer permission approvals and agent questions

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
src/state/        auth (keychain), the hub connection, one session's live view
src/screens/      login, sessions, session detail, new session, settings
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

## Developing

```bash
npm ci
npm start                 # Metro
npm run android           # or: npm run ios   (needs macOS + pods)
npx tsc --noEmit && npx eslint . --ext .ts,.tsx && npx jest
```

Point it at a slopcoder instance and sign in. For a local server see the `verify` skill in
the slopcoder repo — scratch Postgres, no Docker.

`scripts/wire-check.cjs` drives the compiled client against a running server and asserts
the five facts above — most importantly that `Delta` binds four arguments. Run it whenever
the seam or the hub changes; the unit tests cannot see any of it.

### Fonts

Geist, Geist Mono and Baloo 2 ExtraBold come from
`src/SlopCoder.Web/wwwroot/fonts/` in the slopcoder repo. They are `.woff2` there and need
converting to `.ttf` for native. Until they are added the app falls back to the system
font and looks close but not right.

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

## Next

**App Intents**, so Siri can start a session. They are Swift regardless of what the rest of
the app is written in, and they should call the seam directly from Swift rather than going
through the JS bridge — Siri can invoke an intent without launching the app, and booting
the React Native runtime to answer would be slow and fragile. The intent needs only the
keychain key and an HTTP call.

Then **native push**. The server already fires a notification when a turn ends or an
approval blocks, but over Web Push; APNs and FCM need a sender alongside it.
