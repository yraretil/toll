#!/usr/bin/env bash
# End-to-end check: start server, run agent, assert settlement + answer markers.
# Requires filled .env files (see README). Exits 0 on success, 1 on failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_LOG="$ROOT/.e2e-server.log"
AGENT_OUT="$ROOT/.e2e-agent.out"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -f "$SERVER_LOG" "$AGENT_OUT"
}
trap cleanup EXIT

cd "$ROOT/resource-server"
npx tsx src/index.ts > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 15); do
  if curl -s -m 3 http://localhost:4021/health | grep -q '"ok":true'; then break; fi
  sleep 2
done
curl -s -m 5 http://localhost:4021/health | grep -q '"ok":true' \
  || { echo "FAIL: server never became healthy"; exit 1; }
echo "server healthy"

cd "$ROOT/agent-client"
npm start > "$AGENT_OUT" 2>&1 || { echo "FAIL: agent exited non-zero"; tail -20 "$AGENT_OUT"; exit 1; }

grep -q "settled 0.0" "$AGENT_OUT" || { echo "FAIL: no settlement"; exit 1; }
grep -q "total spent:" "$AGENT_OUT" || { echo "FAIL: no total spent line"; exit 1; }
echo "agent settled + reported spend"

echo "E2E OK"
