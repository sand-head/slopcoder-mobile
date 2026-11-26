#!/usr/bin/env bash
# Install xtool, the tool that builds this package into an iOS app on Linux.
#
# One script so the dev container and CI get the same version the same way.
# The release is an AppImage; it is unpacked here rather than run as one,
# because an AppImage mounts itself with FUSE and a container has none.
set -euo pipefail

XTOOL_VERSION="${XTOOL_VERSION:-1.24.0}"
PREFIX="${XTOOL_PREFIX:-/opt/xtool}"
ARCH="$(uname -m)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 3 \
  "https://github.com/xtool-org/xtool/releases/download/${XTOOL_VERSION}/xtool-${ARCH}.AppImage" \
  -o "$work/xtool.AppImage"
chmod +x "$work/xtool.AppImage"
(cd "$work" && ./xtool.AppImage --appimage-extract >/dev/null)

rm -rf "$PREFIX"
mkdir -p "$(dirname "$PREFIX")"
mv "$work/squashfs-root" "$PREFIX"
chmod -R a+rX "$PREFIX"
ln -sf "$PREFIX/AppRun" /usr/local/bin/xtool

echo "xtool ${XTOOL_VERSION} installed at ${PREFIX}"
