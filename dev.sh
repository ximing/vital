#!/usr/bin/env bash
# Start local dev: migrate + API :3010 + web :5180
# Usage:
#   ./dev.sh          start (already running → print addresses)
#   ./dev.sh stop     stop processes this script started
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PID_FILE="${TMPDIR:-/tmp}/vital-dev.pids"
LOG_DIR="${TMPDIR:-/tmp}/vital-dev-logs"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  fi
}

healthy() {
  curl --noproxy '*' -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null
}

stop_dev() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "已停止 API / Web"
}

if [[ "${1:-}" == "stop" ]]; then
  stop_dev
  exit 0
fi

need pnpm
need curl

if [[ ! -f apps/server/.env ]]; then
  echo "没有 apps/server/.env。请复制 apps/server/.env.example 并填入真实值。" >&2
  exit 1
fi

echo "构建 dto + api-client + tokens…"
pnpm --filter @vital/dto build
pnpm --filter @vital/api-client build
pnpm --filter @vital/tokens build

echo "数据库迁移…"
pnpm --filter @vital/server migrate

mkdir -p "$LOG_DIR"

start_one() {
  local name="$1"
  shift
  echo "starting ${name}"
  "$@" >"${LOG_DIR}/${name}.log" 2>&1 &
  echo $! >>"$PID_FILE"
}

if healthy http://localhost:3010/api/health; then
  echo "API 已在 :3010"
else
  if port_in_use 3010; then
    echo "端口 3010 已被占用且 /api/health 不通" >&2
    exit 1
  fi
  : >"$PID_FILE"
  start_one server pnpm --filter @vital/server dev
fi

if grep -q '"dev"' apps/web/package.json 2>/dev/null; then
  if port_in_use 5180 && healthy http://localhost:5180/; then
    echo "Web 已在 :5180"
  elif port_in_use 5180; then
    echo "端口 5180 已被占用。请先停掉占用进程。" >&2
    exit 1
  else
    [[ -f "$PID_FILE" ]] || : >"$PID_FILE"
    start_one web pnpm --filter @vital/web dev
  fi
fi

api_ok=0
web_ok=0
for _ in $(seq 1 60); do
  if healthy http://localhost:3010/api/health; then
    api_ok=1
  fi
  if grep -q '"dev"' apps/web/package.json 2>/dev/null; then
    if healthy http://localhost:5180/; then
      web_ok=1
    fi
  else
    web_ok=1
  fi
  if [[ "$api_ok" == 1 && "$web_ok" == 1 ]]; then
    break
  fi
  sleep 1
done

if [[ "$api_ok" != 1 ]]; then
  echo "API 未就绪。日志：$LOG_DIR/server.log" >&2
  tail -n 40 "$LOG_DIR/server.log" 2>/dev/null || true
  exit 1
fi
if [[ "$web_ok" != 1 ]]; then
  echo "Web 未就绪。日志：$LOG_DIR/web.log" >&2
  tail -n 40 "$LOG_DIR/web.log" 2>/dev/null || true
  exit 1
fi

cat <<EOF

开发环境已就绪
  Web   http://localhost:5180
  API   http://localhost:3010/api/health
  日志  $LOG_DIR
  停止  $ROOT/dev.sh stop

EOF
