FROM debian:bookworm-slim AS capture-builder
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
FROM debian:bookworm-slim AS coding-clis
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

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    dbus-x11 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 rakazo \
  && useradd --uid 1000 --gid rakazo --create-home --shell /bin/bash rakazo \
  && mkdir -p /etc/rakazo/fluxbox \
  && printf '%s\n' '#!/bin/sh' 'exec xsetroot -solid "#111113" "$@"' > /usr/bin/fbsetbg \
  && chmod +x /usr/bin/fbsetbg \
  && ln -sfn /bin/true /usr/bin/xmessage
ENV DISPLAY=:1
ENV HOME=/home/rakazo
WORKDIR /home/rakazo
# --chmod normalizes modes: a restrictive host umask (e.g. 077 on hardened hosts) would
# otherwise leave these files unreadable to USER 1000 at runtime.
COPY --chmod=755 start.sh /usr/local/bin/rakazo-computer
COPY --chmod=755 control.py /usr/local/bin/rakazo-computer-control
COPY --from=capture-builder /build/librakazo-xcapture.so /usr/local/lib/librakazo-xcapture.so
COPY --from=coding-clis /out/opencode/opencode /usr/local/bin/opencode
COPY --from=coding-clis /out/kilo /opt/kilo
COPY --chmod=755 rakazo-browser /usr/local/bin/rakazo-browser
COPY --chmod=755 rakazo-page-browser /usr/local/bin/rakazo-page-browser
COPY --chmod=644 rakazo-browser.desktop /usr/share/applications/rakazo-browser.desktop
COPY --chmod=644 fluxbox.init /etc/rakazo/fluxbox/init
COPY --chmod=644 fluxbox.apps /etc/rakazo/fluxbox/apps
COPY --chmod=644 fluxbox.menu /etc/rakazo/fluxbox/menu
COPY --chmod=644 embed.html /usr/share/novnc/embed.html
COPY --chmod=644 clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
COPY --chmod=644 mobile-keyboard.js /usr/share/novnc/mobile-keyboard.js
# Strip CR so shebangs work even if the build context came from a CRLF checkout.
RUN ldconfig \
  && ln -s /opt/kilo/kilo /usr/local/bin/kilo \
  && sed -i 's/\r$//' /usr/local/bin/rakazo-computer /usr/local/bin/rakazo-computer-control /usr/local/bin/rakazo-browser /usr/local/bin/rakazo-page-browser \
    /etc/rakazo/fluxbox/init /etc/rakazo/fluxbox/apps /etc/rakazo/fluxbox/menu
EXPOSE 7070 6080 6081 6082 6083 6084 6085 6086 6087 6088 6089 6090 6091 6092 6093 6094 6095
USER 1000:1000
CMD ["/usr/local/bin/rakazo-computer"]
