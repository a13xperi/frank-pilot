#!/usr/bin/env bash
# demo-up.sh — one-command launcher for the Jun 11 demo track (isolated from dev).
# Stack: Postgres in docker (:5433, db frank_pilot_demo) + API (:3010) + staff client (:5180).
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;32m[demo]\033[0m %s\n' "$*"; }

# 1 · container runtime
if ! docker info >/dev/null 2>&1; then
  say "starting colima (docker runtime)…"
  colima start
fi

# 2 · demo database container
if [ -z "$(docker ps -q -f name=frank-pilot-demo-db)" ]; then
  if [ -n "$(docker ps -aq -f name=frank-pilot-demo-db)" ]; then
    say "starting existing demo db container…"
    docker start frank-pilot-demo-db >/dev/null
  else
    say "creating demo db container (:5433)…"
    docker run -d --name frank-pilot-demo-db -p 5433:5432 \
      -e POSTGRES_DB=frank_pilot_demo -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=demo-jun11-lv \
      -v frank_demo_data:/var/lib/postgresql/data postgres:16-alpine >/dev/null
  fi
fi
until docker exec frank-pilot-demo-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
say "db ready"

# 3 · API (:3010)
if ! curl -sf -m 2 http://localhost:3010/health >/dev/null 2>&1; then
  say "starting API on :3010…"
  nohup npm run dev >/tmp/frank-demo-api.log 2>&1 &
fi

# 4 · staff client (:5180)
if ! curl -sf -m 2 http://localhost:5180/ >/dev/null 2>&1; then
  say "starting staff client on :5180…"
  (cd client && nohup npm run dev >/tmp/frank-demo-client.log 2>&1 &)
fi

# 4b · tenant client (:5174) — Frank Q&A chat widget, proxied to the demo API.
# VITE_ENABLE_FAQ_CHAT=true: chat is back for Jun 11 — the API defaults to
# tenant scope (FAQ corpus + facts only; statewide index unreachable).
# VITE_ENABLE_VOICE_PILL stays UNSET: the ElevenLabs voice agent is not yet
# re-grounded/attested (VOICE_AGENT_TENANT_SCOPED) — do not enable it here.
if ! curl -sf -m 2 http://localhost:5174/ >/dev/null 2>&1; then
  say "starting tenant client on :5174…"
  (cd client-tenant && VITE_API_PROXY_TARGET=http://localhost:3010 \
    VITE_ENABLE_FAQ_CHAT=true \
    nohup npm run dev >/tmp/frank-demo-tenant.log 2>&1 &)
fi

# 5 · wait + verify
for _ in $(seq 1 45); do
  curl -sf -m 2 http://localhost:3010/health >/dev/null 2>&1 && API=ok || API=…
  curl -sf -m 2 http://localhost:5180/ >/dev/null 2>&1 && WEB=ok || WEB=…
  curl -sf -m 2 http://localhost:5174/ >/dev/null 2>&1 && TEN=ok || TEN=…
  [ "$API" = ok ] && [ "$WEB" = ok ] && [ "$TEN" = ok ] && break
  sleep 2
done
[ "$API" = ok ] || { echo "API failed — see /tmp/frank-demo-api.log"; exit 1; }
[ "$WEB" = ok ] || { echo "client failed — see /tmp/frank-demo-client.log"; exit 1; }
[ "$TEN" = ok ] || { echo "tenant client failed — see /tmp/frank-demo-tenant.log"; exit 1; }

say "READY — demo at  http://localhost:5180"
say "Frank Q&A (tenant chat) at  http://localhost:5174"
say "health: $(curl -s -m 3 http://localhost:3010/health)"
cat <<'TABLE'
  Logins (password: password123)
    agent@cdpc.test     Leasing Agent
    senior@cdpc.test    Senior Manager
    regional@cdpc.test  Regional Manager
    asset@cdpc.test     Asset Manager
    admin@cdpc.test     System Admin
  Reset data to pristine:  ./demo-reset.sh
TABLE
