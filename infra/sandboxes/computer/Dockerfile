FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS capture-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libx11-dev \
    libxdamage-dev \
    libxext-dev \
    libxfixes-dev \
    libxtst-dev \
    libpng-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY xcapture.c .
RUN cc -O3 -fPIC -shared -Wall -Wextra -Werror -o librakazo-xcapture.so xcapture.c \
    -lX11 -lXext -lXdamage -lXfixes -lXtst -lpng

# Coding CLIs whose built-in free models answer without an account or API key.
# Official release tarballs, pinned and checked against their published SHA-256.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS coding-clis
ARG TARGETARCH
ARG OPENCODE_VERSION=1.18.32
ARG KILO_VERSION=7.8.1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) arch=x64; \
      opencode_sha=3046e0404fdc60fb80307e7a47824ba07477364178a4d09baa8548496dd6d43b; \
      kilo_sha=6d48503b000d3d904d15950b63e254653c450800647344ac0f3de4e8a7f98835 ;; \
    arm64) arch=arm64; \
      opencode_sha=568461b7d4d8c19865c97e9a1102e613049c6039d01fe772154de873c1865840; \
      kilo_sha=516f81a81d3605cecae61dddf4da548da403b9f8993a06bb799d12b6fc6e7ac4 ;; \
    *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/opencode.tgz "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${arch}.tar.gz"; \
  curl -fsSL -o /tmp/kilo.tgz "https://github.com/Kilo-Org/kilocode/releases/download/v${KILO_VERSION}/kilo-linux-${arch}.tar.gz"; \
  printf '%s  %s\n' "$opencode_sha" /tmp/opencode.tgz "$kilo_sha" /tmp/kilo.tgz | sha256sum -c -; \
  mkdir -p /out/opencode /out/kilo; \
  tar -xzf /tmp/opencode.tgz --no-same-owner -C /out/opencode; \
  tar -xzf /tmp/kilo.tgz --no-same-owner -C /out/kilo

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
# Dev tools let bots clone repos and fetch artifacts; containers run uid 1000
# with no privilege escalation, so nothing can be installed at runtime.
# Compilers stay in the builder stage; heavier toolchains are a separate call.
# The bot browser: chromium by default, or BROWSER=brave (installed below).
ARG BROWSER=chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    wmctrl \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    novnc \
    websockify \
    python3 \
    libnss-wrapper \
    ca-certificates \
    procps \
    bash \
    $([ "$BROWSER" = chromium ] && echo chromium) \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    locales \
    dbus-x11 \
    xdg-desktop-portal \
    xdg-desktop-portal-gtk \
    xdg-utils \
    curl \
    git \
    jq \
    openssh-client \
    unzip \
    xclip \
    xsel \
    poppler-utils \
    pandoc \
    python3-openpyxl \
  && rm -rf /var/lib/apt/lists/* \
  && pdftotext -v \
  && pdfinfo -v \
  && pandoc --version \
  && python3 -c 'import openpyxl; print(openpyxl.__version__)' \
  && groupadd --gid 1000 rakazo \
  && useradd --uid 1000 --gid rakazo --create-home --shell /bin/bash rakazo \
  && mkdir -p /etc/rakazo/fluxbox /etc/chromium/policies/managed /etc/brave/policies/managed \
  && printf '%s\n' '#!/bin/sh' 'exec xsetroot -solid "#111113" "$@"' > /usr/bin/fbsetbg \
  && chmod +x /usr/bin/fbsetbg \
  && ln -sfn /bin/true /usr/bin/xmessage
# Brave replaces Chromium only when built with BROWSER=brave. The default
# build installs Chromium above, so this step does nothing for it.
RUN set -eux; \
    case "$BROWSER" in \
      chromium) ;; \
      brave) \
        keyring=/usr/share/keyrings/brave-browser-archive-keyring.gpg; \
        curl -fsSLo "$keyring" https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg; \
        echo "deb [signed-by=$keyring arch=$(dpkg --print-architecture)] https://brave-browser-apt-release.s3.brave.com/ stable main" \
          > /etc/apt/sources.list.d/brave-browser-release.list; \
        apt-get update; \
        apt-get install -y --no-install-recommends brave-browser; \
        rm -rf /var/lib/apt/lists/*; \
        mkdir -p /etc/brave/policies/managed; \
        printf '%s\n' '{' \
          '  "BraveRewardsDisabled": true,' \
          '  "BraveWalletDisabled": true,' \
          '  "BraveAIChatEnabled": false,' \
          '  "BraveVPNDisabled": true,' \
          '  "BraveNewsDisabled": true,' \
          '  "BraveTalkDisabled": true' \
          '}' > /etc/brave/policies/managed/rakazo.json ;; \
      *) echo "unsupported BROWSER: $BROWSER (use chromium or brave)" >&2; exit 1 ;; \
    esac
RUN ln -s "$(dpkg -L libnss-wrapper | grep '/libnss_wrapper.so$')" /usr/local/lib/libnss_wrapper.so
ARG TARGETARCH
ARG UV_VERSION=0.12.19
RUN set -eux; \
  case "$TARGETARCH" in \
    amd64) uv_arch=x86_64; uv_sha256=23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8 ;; \
    arm64) uv_arch=aarch64; uv_sha256=0804e9b164c64b6914182d5920c08551958a095986f10a3731056df701126436 ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  archive="$(mktemp)"; \
  curl -fsSL "https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/uv-${uv_arch}-unknown-linux-gnu.tar.gz" -o "$archive"; \
  echo "$uv_sha256  $archive" | sha256sum -c -; \
  tar -xzf "$archive" -C /usr/local/bin --strip-components=1 "uv-${uv_arch}-unknown-linux-gnu/uv" "uv-${uv_arch}-unknown-linux-gnu/uvx"; \
  rm -f "$archive"; \
  uv --version; \
  uvx --version
# Bookworm has no gh package; pin the upstream binary and verify sha256, same as uv.
ARG GH_VERSION=2.100.0
RUN set -eux; \
  case "$TARGETARCH" in \
    amd64) gh_arch=amd64; gh_sha256=e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be ;; \
    arm64) gh_arch=arm64; gh_sha256=ea4e7a581a32ccad6cc7923cb1576ac5859ba4b9a16ab22eb8f8a96e78e2e961 ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  archive="$(mktemp)"; \
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" -o "$archive"; \
  echo "$gh_sha256  $archive" | sha256sum -c -; \
  tar -xzf "$archive" -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_${gh_arch}/bin/gh"; \
  rm -f "$archive"; \
  gh --version
# The page browser drives the visible Chromium through agent-browser, pinned and checked by sha256.
COPY --chmod=755 install-agent-browser.sh /tmp/install-agent-browser.sh
RUN /tmp/install-agent-browser.sh /usr/local/bin && rm /tmp/install-agent-browser.sh \
  && mkdir -p /usr/local/lib/rakazo
ENV DISPLAY=:1
ENV HOME=/home/rakazo
# Keep UTF-8 explicit (an empty LANG broke non-ASCII file handling in the
# file chooser for CJK-market users) and generate zh_CN.UTF-8 so deployments
# that override the computer environment can opt in to a Chinese locale.
RUN sed -i 's/^# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen && locale-gen
ENV LANG=C.UTF-8
ENV UV_TOOL_DIR=/home/rakazo/.local/share/uv/tools \
    UV_TOOL_BIN_DIR=/home/rakazo/.local/bin \
    UV_PYTHON_INSTALL_DIR=/home/rakazo/.local/share/uv/python
WORKDIR /home/rakazo
# --chmod normalizes modes: a restrictive host umask (e.g. 077 on hardened hosts) would
# otherwise leave these files unreadable to USER 1000 at runtime.
COPY --chmod=755 start.sh /usr/local/bin/rakazo-computer
COPY --chmod=644 user-env.sh /usr/local/lib/rakazo-user-env.sh
COPY --chmod=755 control.py /usr/local/bin/rakazo-computer-control
# Tells the supervisor this control service accepts scrolls aimed at a point and sideways
# scrolls; it sends those to older images through its fallback instead.
LABEL rakazo.control.aimedScroll="1"
COPY --from=capture-builder /build/librakazo-xcapture.so /usr/local/lib/librakazo-xcapture.so
COPY --from=coding-clis /out/opencode/opencode /usr/local/bin/opencode
COPY --from=coding-clis /out/kilo /opt/kilo
COPY --chmod=755 rakazo-browser /usr/local/bin/rakazo-browser
COPY --chmod=755 rakazo-focus-or-launch /usr/local/bin/rakazo-focus-or-launch
COPY --chmod=755 rakazo-page-browser /usr/local/bin/rakazo-page-browser
COPY --chmod=644 page_secrets.py /usr/local/lib/rakazo/page_secrets.py
COPY --chmod=644 rakazo-browser.desktop /usr/share/applications/rakazo-browser.desktop
# Rakazo keeps credentials itself; the browser's save prompts would cover pages.
# Pop-ups open: one a page opens after making a report would be blocked unseen.
COPY --chmod=644 browser-policy.json /etc/chromium/policies/managed/rakazo-browser.json
COPY --chmod=644 browser-policy.json /etc/brave/policies/managed/rakazo-browser.json
COPY --chmod=644 fluxbox.init /etc/rakazo/fluxbox/init
COPY --chmod=644 fluxbox.apps /etc/rakazo/fluxbox/apps
COPY --chmod=644 fluxbox.menu /etc/rakazo/fluxbox/menu
COPY --chmod=644 embed.html /usr/share/novnc/embed.html
COPY --chmod=644 clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
COPY --chmod=644 mobile-keyboard.js /usr/share/novnc/mobile-keyboard.js
# Login shells source this after Debian's /etc/profile resets PATH. The home
# volume hides /etc/skel, so ~/.local/bin has to be restored from the image.
COPY --chmod=644 rakazo-local-bin.sh /etc/profile.d/rakazo-local-bin.sh
# Strip CR so shebangs work even if the build context came from a CRLF checkout.
RUN ldconfig \
  && ln -s /opt/kilo/kilo /usr/local/bin/kilo \
  && sed -i 's/\r$//' /usr/local/bin/rakazo-computer /usr/local/lib/rakazo-user-env.sh /usr/local/bin/rakazo-computer-control /usr/local/bin/rakazo-browser /usr/local/bin/rakazo-focus-or-launch /usr/local/bin/rakazo-page-browser \
    /usr/local/lib/rakazo/page_secrets.py \
    /etc/rakazo/fluxbox/init /etc/rakazo/fluxbox/apps /etc/rakazo/fluxbox/menu \
    /etc/profile.d/rakazo-local-bin.sh
# Agent-authored scripts often use the unversioned name. Keep it on the installed Python 3.
RUN ln -s /usr/bin/python3 /usr/local/bin/python \
  && python -c 'import sys; assert sys.version_info.major == 3'
EXPOSE 7070 6080 6081 6082 6083 6084 6085 6086 6087 6088 6089 6090 6091 6092 6093 6094 6095
# Docker exec does not inherit PID 1's exports, so every process gets the same
# identity lookup. Startup creates these private files for the effective UID/GID.
ENV LD_PRELOAD=/usr/local/lib/libnss_wrapper.so \
    NSS_WRAPPER_PASSWD=/tmp/rakazo-nss/passwd \
    NSS_WRAPPER_GROUP=/tmp/rakazo-nss/group
USER 1000:1000
# Start Bash without the wrapper; user-env enables it once both files exist.
CMD ["/usr/bin/env", "-u", "LD_PRELOAD", "/usr/local/bin/rakazo-computer"]
