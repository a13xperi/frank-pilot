#!/bin/bash
# Daily repo→Notion sync for the private GPMG NV Parcels DB.
#
# install-cron.sh copies this file to $SYNC_HOME/run.sh (outside any worktree, so a
# `git reset --hard` during a run can never rewrite the script mid-execution) and
# launchd invokes it once a day.
#
# It syncs from COMMITTED origin/main via a dedicated detached worktree — never from
# an interactive working tree — so the unattended `--apply` can't push half-finished
# edits to the live source-of-truth DB. The NOTION_TOKEN lives in that worktree's
# gitignored docs/intel/notion-sync/.env. sync.py --apply writes only the OWNED auto
# fields, skips any `Sync source=manual` row, and is idempotent (0 writes when
# nothing changed).
set -uo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

# ROOT = the dir this script lives in ($SYNC_HOME), so it is location-independent.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="$ROOT/worktree"
LOG="$ROOT/sync.log"

ts()  { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "── run start ──"
cd "$WT" || { log "FATAL: worktree $WT missing — re-run install-cron.sh"; exit 1; }

# Refresh to committed main. Untracked .env survives `reset --hard` (only `clean` removes it).
if git fetch -q origin main 2>>"$LOG"; then
  git reset --hard -q origin/main 2>>"$LOG" || log "WARN: reset --hard failed"
  log "worktree @ origin/main $(git rev-parse --short HEAD)"
else
  log "WARN: git fetch failed — running last-known checkout $(git rev-parse --short HEAD)"
fi

cd docs/intel/notion-sync || { log "FATAL: notion-sync dir missing at $(pwd)"; exit 1; }
/usr/bin/python3 sync.py --apply >>"$LOG" 2>&1
rc=$?
log "── run end (exit $rc) ──"

# keep the log bounded
tail -n 1000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
exit $rc
