#!/usr/bin/env bash
# demo-reset.sh — restore the demo database to pristine scripted state (~60s).
# Safe: touches ONLY the frank_pilot_demo db in the frank-pilot-demo-db container.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# DROP … WITH (FORCE) kills the API's pooled connections and crashes node —
# so stop the API first and restart it after (learned in rehearsal, Jun 10).
echo "[reset] stopping API on :3010…"
lsof -ti:3010 | xargs kill 2>/dev/null || true
sleep 1

echo "[reset] dropping + recreating frank_pilot_demo…"
docker exec frank-pilot-demo-db psql -U postgres \
  -c "DROP DATABASE IF EXISTS frank_pilot_demo WITH (FORCE);" \
  -c "CREATE DATABASE frank_pilot_demo;"

echo "[reset] migrate + seed + demo seed + ledger enrichment…"
npm run migrate
npm run seed
npm run seed:demo
npm run seed:demo:ledger

echo "[reset] restarting API…"
nohup npm run dev >/tmp/frank-demo-api.log 2>&1 &
for _ in $(seq 1 30); do
  curl -sf -m 2 http://localhost:3010/health >/dev/null 2>&1 && break
  sleep 2
done
curl -sf -m 3 http://localhost:3010/health >/dev/null || { echo "[reset] API failed to restart — see /tmp/frank-demo-api.log"; exit 1; }

echo "[reset] done — pristine demo state (13 applications, Tomasz delinquent, Elena ready-to-onboard). API healthy."
