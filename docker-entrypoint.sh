#!/usr/bin/env bash
set -euo pipefail

# ── Validate required env vars ───────────────────────────────────────────────
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set. Add it to your .env file."
  exit 1
fi

# ── Create runtime directories ───────────────────────────────────────────────
mkdir -p \
  /home/app/chrome-profile \
  /home/app/.openclaw/agents/main/sessions \
  /home/app/.openclaw/credentials \
  /home/app/job-apply/plugin/data \
  /home/app/screenshots \
  /home/app/openclaw-workspace/memory

# ── Resolve env vars in openclaw.json ────────────────────────────────────────
# The template uses ${VAR} placeholders — envsubst replaces them at runtime
# so secrets never get baked into the image.
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}" \
WHATSAPP_ALLOW_FROM="${WHATSAPP_ALLOW_FROM:-}" \
envsubst '${OPENCLAW_GATEWAY_TOKEN} ${WHATSAPP_ALLOW_FROM}' \
  < /home/app/.openclaw/openclaw.json.tmpl \
  > /home/app/.openclaw/openclaw.json

chmod 600 /home/app/.openclaw/openclaw.json

# ── Fix ownership (volumes may be created as root) ───────────────────────────
chown -R app:app \
  /home/app/chrome-profile \
  /home/app/.openclaw \
  /home/app/job-apply/plugin/data \
  /home/app/screenshots \
  /home/app/openclaw-workspace/memory

# ── Launch supervisord ───────────────────────────────────────────────────────
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
