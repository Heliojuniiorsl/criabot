#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5050}"
SKIP_WEBHOOKS="false"

for arg in "$@"; do
  case "$arg" in
    --port=*) PORT="${arg#*=}" ;;
    --skip-webhooks) SKIP_WEBHOOKS="true" ;;
  esac
done

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$WORKSPACE/.tools"
LOGS_DIR="$TOOLS_DIR/logs"
ENV_PATH="$WORKSPACE/.env"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TUNNEL_OUT="$LOGS_DIR/local-tunnel-$TIMESTAMP.out.log"
TUNNEL_ERR="$LOGS_DIR/local-tunnel-$TIMESTAMP.err.log"
DEV_OUT="$LOGS_DIR/local-panel-$TIMESTAMP.out.log"
DEV_ERR="$LOGS_DIR/local-panel-$TIMESTAMP.err.log"

step() {
  printf '==> %s\n' "$1"
}

stop_workspace_processes() {
  pkill -f "$WORKSPACE.*cloudflared" 2>/dev/null || true
  pkill -f "$WORKSPACE.*vite" 2>/dev/null || true
  pkill -f "$WORKSPACE.*production-server\\.mjs" 2>/dev/null || true
}

stop_port_listener() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "TCP:$PORT" -sTCP:LISTEN | xargs -r kill -9
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  fi
}

wait_for_url() {
  local deadline=$((SECONDS + 90))
  local pattern='https://[-a-z0-9]+\.trycloudflare\.com'
  while (( SECONDS < deadline )); do
    local match
    match="$(grep -Eoh "$pattern" "$TUNNEL_OUT" "$TUNNEL_ERR" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$match" ]]; then
      printf '%s' "$match"
      return 0
    fi
    sleep 1
  done
  return 1
}

set_env_value() {
  local key="$1"
  local value="$2"
  node - "$ENV_PATH" "$key" "$value" <<'NODE'
const fs = require("node:fs");
const [envPath, key, value] = process.argv.slice(2);
let lines = [];
if (fs.existsSync(envPath)) lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
let found = false;
lines = lines.map((line) => {
  if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
    found = true;
    return `${key}=${value}`;
  }
  return line;
});
if (!found) lines.push(`${key}=${value}`);
fs.writeFileSync(envPath, lines.filter((line, index) => line || index < lines.length - 1).join("\n") + "\n");
NODE
}

mkdir -p "$LOGS_DIR"

if [[ ! -f "$ENV_PATH" ]]; then
  echo ".env nao encontrado em $ENV_PATH" >&2
  exit 1
fi

step "Parando painel/tunel antigos"
stop_workspace_processes
stop_port_listener

CLOUDFLARED="${CLOUDFLARED:-}"
if [[ -z "$CLOUDFLARED" ]]; then
  if [[ -x "$TOOLS_DIR/cloudflared" ]]; then
    CLOUDFLARED="$TOOLS_DIR/cloudflared"
  elif command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED="$(command -v cloudflared)"
  fi
fi

PUBLIC_URL=""
if [[ -n "$CLOUDFLARED" ]]; then
  step "Subindo Cloudflare Tunnel para localhost:$PORT"
  nohup "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate \
    >"$TUNNEL_OUT" 2>"$TUNNEL_ERR" &
  PUBLIC_URL="$(wait_for_url || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    step "URL publica nova: $PUBLIC_URL"
    set_env_value "PUBLIC_BASE_URL" "$PUBLIC_URL"
  else
    echo "Nao consegui obter a URL do Cloudflare Tunnel. Veja $TUNNEL_ERR" >&2
  fi
else
  echo "cloudflared nao encontrado. Pulando tunel publico." >&2
fi

step "Subindo painel em http://localhost:$PORT"
(
  cd "$WORKSPACE"
  nohup npm run dev -- --host 0.0.0.0 --port "$PORT" >"$DEV_OUT" 2>"$DEV_ERR" &
)

if [[ "$SKIP_WEBHOOKS" != "true" && -n "$PUBLIC_URL" ]]; then
  step "Reconectando bots de vendas cadastrados"
  (
    cd "$WORKSPACE"
    node scripts/reconnect-sales-clones.mjs "$PUBLIC_URL" || true
  )
fi

printf '\nPronto.\n'
printf 'Painel: http://localhost:%s/painel/bots\n' "$PORT"
if [[ -n "$PUBLIC_URL" ]]; then
  printf 'URL publica atual: %s\n' "$PUBLIC_URL"
fi
printf 'Logs do painel: %s\n' "$DEV_OUT"
printf 'Logs do tunel:  %s\n' "$TUNNEL_ERR"
