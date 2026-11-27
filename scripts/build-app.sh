#!/usr/bin/env bash
# Build the iOS app with xtool, from any shell — including an agent's, which
# has no terminal.
#
#   scripts/build-app.sh                       # → xtool/Slopcoder.app (device, debug)
#   scripts/build-app.sh -c release --ipa      # → xtool/Slopcoder.ipa
#   scripts/build-app.sh --triple arm64-apple-ios17.0-simulator
#
# It exists because of how xtool fails without an iOS SDK: it asks for the path
# to Xcode.xip on standard input, and where standard input is not a terminal
# its networking library aborts with
#
#     Fatal error: … epoll_ctl(epfd:op:fd:event:): Operation not permitted
#
# which reads as a sandbox blocking epoll and is nothing of the kind. So this
# makes sure there is an SDK first — installing it from the shared copy of
# Xcode if there is one (see scripts/install-darwin-sdk.sh) — and says so
# plainly if it cannot.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v swiftc > /dev/null && [ -x /opt/swift/usr/bin/swiftc ]; then
  export PATH="/opt/swift/usr/bin:$PATH"
fi
command -v swiftc > /dev/null || { echo "No Swift toolchain on PATH (swiftc)." >&2; exit 2; }
command -v xtool > /dev/null || { echo "xtool is not installed: run scripts/install-xtool.sh." >&2; exit 2; }

if ! xtool sdk status < /dev/null 2> /dev/null | grep -q "is installed"; then
  echo "No iOS SDK in this container; installing it."
  if ! bash scripts/install-darwin-sdk.sh; then
    echo >&2
    echo "Cannot build the app: there is no iOS SDK and no Xcode archive to make one from." >&2
    echo "The owner keeps Xcode_*.xip in ../home/xcode (shared by all their sessions)." >&2
    echo "\`swift build\` and \`swift test\` do not need it." >&2
    exit 2
  fi
fi

exec xtool dev build "$@" < /dev/null
