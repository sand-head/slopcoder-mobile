# Everything needed to build, test and package slopcoder for iOS on Linux.
#
# What is not here is Apple's SDK: it cannot be redistributed, so it is
# installed into the container from your own copy of Xcode (see
# scripts/install-darwin-sdk.sh) and kept in a volume across rebuilds.
FROM swift:6.4.2-noble

ARG XTOOL_VERSION=1.24.0
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl git openssh-client sudo zstd xz-utils zip unzip python3 \
        # Talking to a phone over USB: `xtool dev run`, `xtool devices`.
        usbmuxd libimobiledevice-utils \
        # scripts/generate-fold-icons.py
        python3-pil \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-xtool.sh /tmp/install-xtool.sh
RUN XTOOL_VERSION=${XTOOL_VERSION} bash /tmp/install-xtool.sh && rm /tmp/install-xtool.sh

# The base image ships an `ubuntu` user at 1000; reuse the id under our name.
RUN if getent passwd ${USER_UID} >/dev/null; then userdel -r "$(getent passwd ${USER_UID} | cut -d: -f1)"; fi \
    && groupadd --force --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} --create-home --shell /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    # Created now so the volumes mounted over them belong to the user.
    && install -d -o ${USERNAME} -g ${USERNAME} /home/${USERNAME}/.swiftpm /home/${USERNAME}/.config/xtool

USER ${USERNAME}
