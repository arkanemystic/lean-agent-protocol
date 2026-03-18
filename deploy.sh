#!/usr/bin/env bash
# deploy.sh — Push latest main to the Hetzner VPS and restart services.
#
# Usage:
#   ./deploy.sh
#
# Required environment variables (set in your shell or a local .env):
#   VPS_USER    SSH user on the VPS          (default: root)
#   VPS_HOST    VPS IP address or hostname   (required — no default)
#   DEPLOY_DIR  Repo path on the VPS         (default: /opt/lean-agent-protocol)
#
# Example:
#   VPS_HOST=1.2.3.4 ./deploy.sh

set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:?Error: VPS_HOST must be set (e.g. VPS_HOST=1.2.3.4 ./deploy.sh)}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/lean-agent-protocol}"

echo "▶ Deploying to ${VPS_USER}@${VPS_HOST}:${DEPLOY_DIR}"

ssh -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}" bash <<EOF
  set -euo pipefail
  cd "${DEPLOY_DIR}"

  echo "  → git pull origin main"
  git pull origin main

  echo "  → docker compose build"
  docker compose build --quiet

  echo "  → docker compose up -d"
  docker compose up -d

  echo "  → waiting for services to be healthy…"
  sleep 8
  docker compose ps

  echo "  → quick health check"
  curl -sf http://localhost:8000/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('  backend:', d['backend'], '| lean_worker:', d['lean_worker']['status'])"
EOF

echo "✓ Deploy complete"
