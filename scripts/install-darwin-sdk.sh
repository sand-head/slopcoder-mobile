#!/usr/bin/env bash
# Install Apple's iOS SDK for xtool from something you are licensed to use.
#
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

source="${1:?usage: install-darwin-sdk.sh <Xcode.xip | darwin.xtoolsdk | https://…>}"

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

xtool sdk install "$source"
xtool sdk status
