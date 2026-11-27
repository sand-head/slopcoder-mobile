# Working on this repository

Read `README.md` for the layout and the rules the code follows. This file is the short
version of how to build and check things from an agent session.

## Build and test

- `swift build` and `swift test` — the core and its tests, on Linux. No SDK needed. If
  `swift` is not on PATH, try `export PATH=/opt/swift/usr/bin:$PATH`.
- `scripts/build-app.sh` — the iOS app, with xtool. Add `-c release --ipa` for an `.ipa`,
  or `--triple arm64-apple-ios17.0-simulator` for the simulator. **Use this script rather
  than calling `xtool dev build` yourself** (see the next section).
- `Sources/Slopcoder` and `Sources/NotificationService` are inside `#if canImport(UIKit)`,
  so a Linux `swift build` only parses them. Only `scripts/build-app.sh` type-checks them.
  Run it before saying a change to the app compiles.
- Nobody can run the app from here. Say what you could not verify.

## The iOS SDK, and the "epoll" crash

The app compiles against Apple's iOS SDK, which xtool makes from an Xcode archive. Apple
does not allow that archive to be redistributed, so **it is not in this repository and
must never be committed**, uploaded, or baked into an image.

- The owner's copy is at `../home/xcode/Xcode_<version>.xip`. `./home` is one directory
  shared by all of the owner's sessions; it outlives containers. `../home/xcode/README.md`
  says more.
- The SDK itself is installed per container (`~/.swiftpm/swift-sdks/`), so a new or
  recreated container has none until it is installed. `scripts/install-darwin-sdk.sh`
  with no argument installs it from the shared copy in about half a minute;
  `scripts/build-app.sh` does that for you when it is missing, and the dev container's
  setup script does it when the container is created.
- If you see

      Fatal error: … epoll_ctl(epfd:op:fd:event:): Operation not permitted

  from xtool, **the SDK is not installed**. Nothing is blocking epoll. With no SDK,
  `xtool dev build` asks for the path to Xcode.xip on standard input; an agent's shell has
  no terminal there, and xtool's networking library aborts trying to read from it. Run
  `scripts/install-darwin-sdk.sh`, or just use `scripts/build-app.sh`.
- If the shared copy is missing, you cannot build the app. Say so and stop; do not look
  for the SDK on the internet. Ask the owner to put `Xcode_*.xip` in `../home/xcode`.

## Where changes go

Development is on Forgejo; `main` is mirrored to GitHub, where CI and the release run.
Workflows therefore run only after a change reaches `main`. Open a pull request for app
changes unless the owner has said otherwise.
