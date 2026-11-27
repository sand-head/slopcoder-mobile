#!/bin/bash
# Type-check the XCUITests in App/UITests on Linux, against the installed iOS
# simulator SDK's XCTest. Nothing here can build or run them — that takes
# Xcode — but this catches a wrong API or a Swift 6 isolation error before a
# Mac runner does.
#
# The SDK's modules were built by Apple's compiler, so swiftc is pointed at the
# Swift resources that came with it (-resource-dir), as xtool's Swift SDK does.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="${SWIFT_SDK_BUNDLE:-$HOME/.swiftpm/swift-sdks/darwin.artifactbundle}/Developer"
PLATFORM="$BUNDLE/Platforms/iPhoneSimulator.platform/Developer"
SDK="$(ls -d "$PLATFORM"/SDKs/iPhoneSimulator*.*.sdk | sort | tail -1)"
swiftc -typecheck -swift-version 6 -target arm64-apple-ios17.0-simulator \
  -sdk "$SDK" \
  -resource-dir "$BUNDLE/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift" \
  -F "$PLATFORM/Library/Frameworks" -I "$PLATFORM/usr/lib" \
  "$ROOT"/App/UITests/*.swift
echo "UI tests type-check against $(basename "$SDK")"
