#!/usr/bin/env bash
# railway-bootstrap.sh — one-shot Railway provision for frank-pilot API.
#
# PRECONDITION: you have already run `railway login` interactively in this
# terminal. This script will NOT attempt to log you in.
#
# What it does, in order:
#   1) Verifies you're logged in (railway whoami).
#   2) Verifies .env.production.local exists.
#   3) Creates a Railway project + service, adds a Postgres plugin.
#   4) Uploads the env vars from .env.production.local.
#   5) Deploys the current branch (railway up).
#   6) Runs DB migrations and seeds (railway run npm run migrate / seed).
#   7) Prints the public URL and next steps for the vercel.json rewrite.
#
# Anything in [Y/n] prompts can be skipped with -y to run non-interactively.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.production.local"
PROJECT_NAME="frank-pilot-api"
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

confirm() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local prompt="${1:-Continue?} [Y/n] "
  read -r -p "$prompt" reply
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------------------

step "Preflight"

command -v railway >/dev/null || die "railway CLI not found (brew install railway)"

WHOAMI="$(railway whoami 2>&1 || true)"
if echo "$WHOAMI" | grep -qiE 'not logged|unauthorized|login'; then
  die "Not logged in. Run \`railway login\` in this terminal first."
fi
ok "Authenticated: $(echo "$WHOAMI" | head -1)"

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — generate it first (see deploy notes)."
ok "Env file: $ENV_FILE"

# Sanity: required keys must be present
for key in NODE_ENV JWT_SECRET ENCRYPTION_KEY CORS_ORIGIN TENANT_PORTAL_URL; do
  grep -qE "^${key}=" "$ENV_FILE" || die "Missing required key '$key' in $ENV_FILE"
done
ok "Required env vars present"

# ----------------------------------------------------------------------------
# Project + service
# ----------------------------------------------------------------------------

step "Project + service"

if [[ -f "$REPO_ROOT/.railway/config.json" ]] || [[ -f "$REPO_ROOT/.railway.json" ]]; then
  ok "Repo is already linked to a Railway project (skipping init)."
else
  confirm "Create new Railway project '$PROJECT_NAME'?" || die "Aborted by user."
  ( cd "$REPO_ROOT" && railway init --name "$PROJECT_NAME" )
  ok "Project created and linked."
fi

# Postgres plugin (idempotent — fails noisily if already added)
step "Provision Postgres"
if railway service 2>/dev/null | grep -qiE 'postgres'; then
  ok "Postgres service already present."
else
  confirm "Add managed Postgres to this project?" || die "Aborted by user."
  ( cd "$REPO_ROOT" && railway add --database postgres ) || warn "railway add returned non-zero — verify in dashboard."
fi

# ----------------------------------------------------------------------------
# Env vars
# ----------------------------------------------------------------------------

step "Upload env vars from $ENV_FILE"
confirm "Push env vars to Railway?" || die "Aborted by user."

# Build --set flags from the env file, skipping comments + blank lines.
# DATABASE_URL is excluded — Railway injects it from the Postgres plugin.
ARGS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  [[ "$key" == "DATABASE_URL" ]] && continue
  # Strip any trailing \r (Mac/Linux EOL safety)
  val="${val%$'\r'}"
  ARGS+=(--set "${key}=${val}")
done < "$ENV_FILE"

( cd "$REPO_ROOT" && railway variables "${ARGS[@]}" )
ok "Env vars pushed (${#ARGS[@]} variables)."

# ----------------------------------------------------------------------------
# Deploy
# ----------------------------------------------------------------------------

step "Deploy (railway up)"
confirm "Deploy current branch ($(git -C "$REPO_ROOT" branch --show-current))?" || die "Aborted by user."
( cd "$REPO_ROOT" && railway up --detach )
ok "Deploy triggered. Tail logs with: railway logs"

# ----------------------------------------------------------------------------
# Migrate + seed
# ----------------------------------------------------------------------------

step "Wait for service to come up, then migrate + seed"
echo "Waiting 30s for first build to settle…"
sleep 30

confirm "Run database migrations now?" || warn "Skipped migrations — run \`railway run npm run migrate\` manually."
if [[ $ASSUME_YES -eq 1 ]] || confirm "(already confirmed)"; then
  ( cd "$REPO_ROOT" && railway run npm run migrate ) || warn "Migrate failed — check logs."
  ok "Migrations applied."
fi

confirm "Seed GPMGLV properties + units?" || warn "Skipped seed — run \`railway run npm run seed\` manually."
if [[ $ASSUME_YES -eq 1 ]] || confirm "(already confirmed)"; then
  ( cd "$REPO_ROOT" && railway run npm run seed ) || warn "Seed failed — check logs."
  ok "Seed complete."
fi

# ----------------------------------------------------------------------------
# Public URL + handoff
# ----------------------------------------------------------------------------

step "Service URL"
URL="$(railway status --json 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.up\.railway\.app' | head -1 || true)"
if [[ -z "$URL" ]]; then
  warn "Could not auto-detect URL. Run \`railway domain\` or check the dashboard."
else
  ok "Public URL: $URL"
  echo
  echo "Verify with:"
  echo "  curl $URL/health"
  echo
  echo "Then wire the SPA — in client-tenant/vercel.json, add BEFORE the catch-all:"
  echo "  { \"source\": \"/api/(.*)\", \"destination\": \"$URL/api/\$1\" }"
  echo
  echo "And run the prod smoke (POST-aware) to confirm:"
  echo "  node scripts/qa-apply-handoff-prod.mjs"
fi

step "Done"
