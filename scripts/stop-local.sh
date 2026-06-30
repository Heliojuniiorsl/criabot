#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5050}"
for arg in "$@"; do
  case "$arg" in
    --port=*) PORT="${arg#*=}" ;;
  esac
done

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '==> Parando painel local e tunel do projeto\n'
pkill -f "$WORKSPACE.*cloudflared" 2>/dev/null || true
pkill -f "$WORKSPACE.*vite" 2>/dev/null || true
pkill -f "$WORKSPACE.*production-server\\.mjs" 2>/dev/null || true

if command -v lsof >/dev/null 2>&1; then
  lsof -ti "TCP:$PORT" -sTCP:LISTEN | xargs -r kill -9
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi

printf 'Pronto.\n'
