#!/usr/bin/env bash
# What the dev container needs beyond its image: xtool, and the packages it and
# the scripts here lean on. Run once when the container is created.
#
# It never fails. A sandbox that will not start because a package mirror was
# slow is worse than one that starts without xtool: the core builds and its
# tests run on the image alone. Whatever could not be installed is said at the
# end, with the command to try again.
set -u

cd "$(dirname "$0")/.."

run() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

missing=()

if command -v apt-get > /dev/null; then
  run apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive run apt-get install -y -qq --no-install-recommends \
      ca-certificates curl git openssh-client zstd xz-utils zip unzip rsync python3 \
      usbmuxd libimobiledevice-utils \
    || missing+=("system packages (apt-get)")
else
  missing+=("system packages (no apt-get in this image)")
fi

if ! command -v xtool > /dev/null; then
  run bash scripts/install-xtool.sh || missing+=("xtool (scripts/install-xtool.sh)")
fi

# Apple's SDK is not in the image and cannot be: it is not ours to distribute.
# A container is thrown away and made again, though, and installing the SDK by
# hand each time is tedious. So if a copy of Xcode has been left in the
# directory that holds this repository — which outlives the container — it is
# installed from there.
if command -v xtool > /dev/null && ! xtool sdk status 2> /dev/null | grep -q "is installed"; then
  xip="$(ls ../Xcode*.xip ../xcode*/Xcode*.xip ../xcode*/*/Xcode*.xip 2> /dev/null | head -1)"
  if [ -n "$xip" ]; then
    echo "Installing the iOS SDK from $xip"
    xtool sdk install --slim "$xip" || missing+=("the iOS SDK (xtool sdk install --slim $xip)")
  else
    echo "No iOS SDK: \`swift build\` and \`swift test\` work; \`xtool dev build\` needs one."
    echo "Put Xcode_*.xip beside this repository and run: scripts/install-darwin-sdk.sh <path>"
  fi
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "Set up, except for:"
  printf '  - %s\n' "${missing[@]}"
  echo "Run \`bash .devcontainer/setup.sh\` to try again."
fi
exit 0
