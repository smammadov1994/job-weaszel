#!/usr/bin/env bash
set -euo pipefail

# This script runs as root via EC2 user-data on first boot.
# It installs all dependencies and configures systemd services.

export DEBIAN_FRONTEND=noninteractive

LOG_FILE="/var/log/job-apply-setup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Job Apply EC2 Setup - $(date) ==="

# ── System updates ───────────────────────────────────────────────────────────
echo "[1/9] System updates..."
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  jq curl unzip wget sqlite3 git \
  xvfb x11vnc fluxbox \
  fonts-liberation fonts-noto-color-emoji \
  dbus-x11 xdg-utils \
  build-essential python3-pip

# ── Node.js 22 ───────────────────────────────────────────────────────────────
echo "[2/9] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# ── Google Chrome ────────────────────────────────────────────────────────────
echo "[3/9] Installing Google Chrome..."
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y /tmp/chrome.deb || apt-get -f install -y
rm /tmp/chrome.deb
echo "Chrome version: $(google-chrome --version)"

# ── noVNC ────────────────────────────────────────────────────────────────────
echo "[4/9] Installing noVNC..."
apt-get install -y novnc websockify
mkdir -p /opt/novnc
ln -sf /usr/share/novnc /opt/novnc/web

# ── OpenClaw ─────────────────────────────────────────────────────────────────
echo "[5/9] Installing OpenClaw..."
npm install -g openclaw@latest || {
  echo "OpenClaw install failed, continuing..."
}

# ── Create ubuntu user dirs ──────────────────────────────────────────────────
echo "[6/9] Setting up directories..."
sudo -u ubuntu mkdir -p \
  /home/ubuntu/chrome-profile \
  /home/ubuntu/openclaw-workspace/memory \
  /home/ubuntu/job-apply/plugin/data \
  /home/ubuntu/job-apply/data \
  /home/ubuntu/screenshots

# ── Systemd: Xvfb ───────────────────────────────────────────────────────────
echo "[7/9] Creating systemd services..."

cat > /etc/systemd/system/xvfb.service <<'EOF'
[Unit]
Description=Virtual Framebuffer X Server
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: Chrome ─────────────────────────────────────────────────────────
cat > /etc/systemd/system/chrome-debug.service <<'EOF'
[Unit]
Description=Google Chrome with Remote Debugging
After=xvfb.service
Requires=xvfb.service

[Service]
Type=simple
User=ubuntu
Environment=DISPLAY=:99
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/home/ubuntu/chrome-profile \
  --no-first-run \
  --disable-default-apps \
  --disable-blink-features=AutomationControlled \
  --window-size=1920,1080 \
  --start-maximized \
  --disable-gpu \
  --no-sandbox
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: x11vnc ─────────────────────────────────────────────────────────
cat > /etc/systemd/system/x11vnc.service <<'EOF'
[Unit]
Description=x11vnc VNC Server
After=xvfb.service
Requires=xvfb.service

[Service]
Type=simple
User=ubuntu
Environment=DISPLAY=:99
ExecStartPre=/bin/sleep 3
ExecStart=/usr/bin/x11vnc -display :99 -forever -nopw -listen 127.0.0.1 -rfbport 5900 -shared
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: noVNC ───────────────────────────────────────────────────────────
cat > /etc/systemd/system/novnc.service <<'EOF'
[Unit]
Description=noVNC WebSocket Proxy
After=x11vnc.service
Requires=x11vnc.service

[Service]
Type=simple
User=ubuntu
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 6080 127.0.0.1:5900
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: Fluxbox (window manager) ───────────────────────────────────────
cat > /etc/systemd/system/fluxbox.service <<'EOF'
[Unit]
Description=Fluxbox Window Manager
After=xvfb.service
Requires=xvfb.service

[Service]
Type=simple
User=ubuntu
Environment=DISPLAY=:99
ExecStartPre=/bin/sleep 1
ExecStart=/usr/bin/fluxbox
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: OpenClaw ───────────────────────────────────────────────────────
cat > /etc/systemd/system/openclaw.service <<'EOF'
[Unit]
Description=OpenClaw AI Agent Gateway
After=chrome-debug.service
Requires=chrome-debug.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/job-apply
EnvironmentFile=/home/ubuntu/job-apply/.env
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/openclaw serve --config /home/ubuntu/job-apply/openclaw/openclaw.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── Enable & start services ─────────────────────────────────────────────────
echo "[8/9] Enabling and starting services..."

# Ensure dbus session for ubuntu user
loginctl enable-linger ubuntu 2>/dev/null || true

systemctl daemon-reload
systemctl enable xvfb fluxbox chrome-debug x11vnc novnc openclaw
systemctl start xvfb
sleep 2
systemctl start fluxbox
sleep 1
systemctl start chrome-debug x11vnc
sleep 3
systemctl start novnc

# Don't start OpenClaw yet — user needs to configure it first
# systemctl start openclaw

# ── Install plugin dependencies ──────────────────────────────────────────────
echo "[9/9] Installing plugin dependencies..."
if [[ -f /home/ubuntu/job-apply/plugin/package.json ]]; then
  cd /home/ubuntu/job-apply/plugin
  sudo -u ubuntu npm install
  sudo -u ubuntu npx tsc || echo "TypeScript compilation will be done after files are uploaded"
fi

# ── Completion flag ──────────────────────────────────────────────────────────
touch /home/ubuntu/.setup-complete
chown ubuntu:ubuntu /home/ubuntu/.setup-complete

echo ""
echo "=== Setup Complete - $(date) ==="
echo "Services status:"
systemctl is-active xvfb || true
systemctl is-active fluxbox || true
systemctl is-active chrome-debug || true
systemctl is-active x11vnc || true
systemctl is-active novnc || true
echo ""
echo "noVNC available at port 6080"
echo "Chrome debugging on port 9222"
