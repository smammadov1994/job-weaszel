FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    DBUS_SESSION_BUS_ADDRESS=/dev/null

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      # Display & window manager
      xvfb fluxbox x11vnc \
      # noVNC
      novnc websockify \
      # Fonts (Chrome needs these)
      fonts-liberation fonts-noto-color-emoji \
      # Utilities
      curl wget jq gettext-base supervisor \
      # Chrome dependencies
      dbus-x11 xdg-utils libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 \
      libasound2t64 libxss1 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome ────────────────────────────────────────────────────────────
RUN wget -q -O /tmp/chrome.deb \
      https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb || apt-get -f install -y \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 22 ───────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── OpenClaw ─────────────────────────────────────────────────────────────────
RUN npm install -g openclaw@latest

# ── Non-root user ────────────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash -u 1000 app \
    && mkdir -p /home/app/.openclaw/agents/main/sessions \
                /home/app/.openclaw/credentials \
                /home/app/chrome-profile \
                /home/app/screenshots \
                /home/app/openclaw-workspace/memory \
                /home/app/job-apply/data \
                /home/app/job-apply/plugin/data

# Symlink /home/ubuntu -> /home/app so skill file paths work unchanged
RUN ln -sf /home/app /home/ubuntu

# ── Copy plugin source & build ───────────────────────────────────────────────
COPY plugin/ /home/app/job-apply/plugin/
WORKDIR /home/app/job-apply/plugin
RUN npm install && npx tsc \
    && cp openclaw.plugin.json dist/ \
    # Copy dashboard UI into dist so the routes.ts path resolves correctly
    && mkdir -p dist/dashboard/ui \
    && cp src/dashboard/ui/index.html dist/dashboard/ui/

# ── Copy openclaw workspace (skills, agents, soul) ──────────────────────────
COPY openclaw/workspace/ /home/app/openclaw-workspace/

# ── Copy openclaw config template ───────────────────────────────────────────
COPY openclaw/openclaw.json /home/app/.openclaw/openclaw.json.tmpl

# ── Copy data (profile.json; resume.pdf comes via bind mount) ────────────────
COPY data/profile.json /home/app/job-apply/data/profile.json

# ── Copy supervisord config ─────────────────────────────────────────────────
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ── Copy entrypoint ─────────────────────────────────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ── Fix ownership ────────────────────────────────────────────────────────────
RUN chown -R app:app /home/app

# ── Expose ports ─────────────────────────────────────────────────────────────
# 6080  = noVNC web UI
# 18789 = OpenClaw gateway / dashboard
EXPOSE 6080 18789

ENTRYPOINT ["docker-entrypoint.sh"]
