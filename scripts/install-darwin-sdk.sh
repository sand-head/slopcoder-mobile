#!/usr/bin/env bash
# Install Apple's iOS SDK for xtool from something you are licensed to use.
#
#   scripts/install-darwin-sdk.sh                      # the copy in ../home/xcode
#   scripts/install-darwin-sdk.sh /path/to/Xcode.xip
#   scripts/install-darwin-sdk.sh /path/to/darwin.xtoolsdk
#   scripts/install-darwin-sdk.sh https://files.example.com/darwin.xtoolsdk.tar.gz
#
# The SDK is Apple's and is not redistributable, so it is not in this
# repository or in the container image: you download Xcode from
# developer.apple.com with your own account and point this at it. A
# `darwin.xtoolsdk` is what `xtool sdk build Xcode.xip <dir>` produces; it is
# the unpacked SDK and larger than the .xip, so the .xip is the one to host.
#
# A URL may need a credential; DARWIN_SDK_TOKEN, if set, is sent as a bearer token.
set -euo pipefail

# With no argument it looks for a copy that is already to hand: the newest
# Xcode_*.xip in the owner's shared directory beside the repository
# (../home/xcode, which every slopcoder session of theirs mounts), or wherever
# XCODE_XIP_DIR points. That is where the archive is kept, rather than in the
# repository, so each new container can install the SDK from it by itself.
find_xip() {
  local here dir
  here="$(cd "$(dirname "$0")/.." && pwd)"
  for dir in "${XCODE_XIP_DIR:-}" "$here/../home/xcode" "$here/.." "$here/../xcode"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    ls "$dir"/Xcode*.xip 2> /dev/null | sort -V | tail -1 | grep . && return 0
  done
  return 1
}

# xtool drives the Swift toolchain, and says only "Could not find executable
# 'swiftc'" at the very end of a long install if there is none on PATH.
if ! command -v swiftc > /dev/null; then
  if [ -x /opt/swift/usr/bin/swiftc ]; then
    export PATH="/opt/swift/usr/bin:$PATH"
  else
    echo "No Swift toolchain on PATH (swiftc). Install Swift 6.4, or use the dev container, then run this again." >&2
    exit 1
  fi
fi
command -v xtool > /dev/null || { echo "xtool is not installed: run scripts/install-xtool.sh first." >&2; exit 1; }

source="${1:-}"
if [ -z "$source" ]; then
  source="$(find_xip)" || {
    echo "No Xcode_*.xip found in ../home/xcode (or \$XCODE_XIP_DIR)." >&2
    echo "usage: install-darwin-sdk.sh [Xcode.xip | darwin.xtoolsdk | https://…]" >&2
    exit 1
  }
  echo "Using $source"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [[ "$source" == https://* ]]; then
  name="${source%%\?*}"
  name="${name##*/}"
  auth=()
  if [[ -n "${DARWIN_SDK_TOKEN:-}" ]]; then auth=(-H "Authorization: Bearer ${DARWIN_SDK_TOKEN}"); fi
  echo "downloading ${name}…"
  curl -fSL --retry 3 "${auth[@]}" "$source" -o "$work/$name"
  source="$work/$name"
fi

case "$source" in
  *.tar.gz|*.tgz) tar -xzf "$source" -C "$work" ;;
  *.tar.zst) tar --zstd -xf "$source" -C "$work" ;;
  *.tar) tar -xf "$source" -C "$work" ;;
esac
if [[ "$source" == *.tar* || "$source" == *.tgz ]]; then
  source="$(find "$work" -maxdepth 2 -name 'darwin.xtoolsdk' -print -quit)"
  [[ -n "$source" ]] || { echo "that archive has no darwin.xtoolsdk in it" >&2; exit 1; }
fi

# Slim: only what this version of xtool uses, about 2 GB instead of 7.
if [[ "$source" == *.xip || "$source" == *.app ]]; then
  xtool sdk install --slim "$source" < /dev/null
else
  xtool sdk install "$source" < /dev/null
fi
xtool sdk status
