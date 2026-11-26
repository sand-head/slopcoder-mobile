#!/usr/bin/env bash
# Copy out of an Xcode.app the parts xtool makes its iOS SDK from, and nothing else.
#
#   scripts/lend-xcode.sh /Applications/Xcode_27.2.app out/     # → out/Xcode.app
#
# This is how CI gets Apple's SDK without anyone hosting it: a macOS runner
# already has Xcode installed, so a short job there runs this and puts the
# result in the repository's Actions cache; the Linux job restores it and runs
# `xtool sdk install --slim out/Xcode.app`. Apple's files never leave the
# repository's own cache.
#
# The list is xtool's own (`SDKEntry.wanted` in its SDKBuilder.swift, as of
# 1.24): the toolchain's Swift and clang resource directories, and for each of
# three platforms its Info.plist, SDKs, test frameworks and usr/lib. If a
# newer xtool wants more, `xtool sdk install` says what it could not find.
set -euo pipefail

app="${1:?usage: lend-xcode.sh <Xcode.app> <output directory>}"
out="${2:?usage: lend-xcode.sh <Xcode.app> <output directory>}"

src="$app/Contents"
[[ -f "$src/Info.plist" && -d "$src/Developer" ]] || { echo "$app is not an Xcode.app" >&2; exit 1; }

mkdir -p "$out/Xcode.app/Contents"
dst="$(cd "$out/Xcode.app/Contents" && pwd)"
cp "$src/Info.plist" "$src/version.plist" "$dst/"

parts=(Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/{swift,swift_static,clang})
for platform in iPhoneOS MacOSX iPhoneSimulator; do
  base="Developer/Platforms/$platform.platform"
  parts+=("$base/Info.plist" "$base/Developer/SDKs" "$base/Developer/Library/Frameworks" \
          "$base/Developer/Library/PrivateFrameworks" "$base/Developer/usr/lib")
done

cd "$src"
for part in "${parts[@]}"; do
  if [[ -e "$part" ]]; then
    # prebuilt-modules are caches for Apple's own compiler build; xtool skips them too.
    rsync -aR --exclude prebuilt-modules "$part" "$dst/"
  else
    echo "not in this Xcode: $part"
  fi
done

du -sh "$dst" | cut -f1
