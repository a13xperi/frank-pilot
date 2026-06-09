#!/bin/bash
# Idempotent installer for the daily GPMG NV Parcels repo→Notion sync (macOS/launchd).
#
# Reproduces the full "worktree dance" so the unattended sync is safe by construction:
#   1. a dedicated DETACHED git worktree pinned to origin/main — the sync always runs
#      against COMMITTED main, never an interactive working tree, so it can't push
#      half-finished edits to the private source-of-truth DB
#   2. the NOTION_TOKEN dropped into that worktree's gitignored .env (chmod 600)
#   3. the version-controlled cron-run.sh wrapper copied to $SYNC_HOME/run.sh
#   4. a launchd LaunchAgent that fires the wrapper once a day
#
# Re-running is safe: an existing worktree / .env is left in place, the wrapper and
# plist are refreshed, and the agent is reloaded.
#
# Usage:
#   NOTION_TOKEN=ntn_… ./install-cron.sh           # install / reconcile
#   SYNC_HOUR=6 NOTION_TOKEN=… ./install-cron.sh    # custom hour (default 7, local)
#   NOTION_TOKEN=… ./install-cron.sh --run          # install, then kick one run now
#   ./install-cron.sh --uninstall                   # remove agent + worktree + $SYNC_HOME
#
# Env overrides: SYNC_HOME (~/.frank-notion-sync), SYNC_LABEL
# (com.a13x.frank-notion-sync), SYNC_HOUR (7), SYNC_MINUTE (0).
#
# The token is read from $NOTION_TOKEN and written straight to the .env — it is never
# echoed, logged, or passed on a command line.
set -euo pipefail

[ "$(uname)" = "Darwin" ] || { echo "ERROR: launchd setup is macOS-only." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

SYNC_HOME="${SYNC_HOME:-$HOME/.frank-notion-sync}"
SYNC_LABEL="${SYNC_LABEL:-com.a13x.frank-notion-sync}"
SYNC_HOUR="${SYNC_HOUR:-7}"
SYNC_MINUTE="${SYNC_MINUTE:-0}"
WT="$SYNC_HOME/worktree"
PLIST="$HOME/Library/LaunchAgents/$SYNC_LABEL.plist"
DOMAIN="gui/$(id -u)"

uninstall() {
  echo "Uninstalling $SYNC_LABEL …"
  launchctl bootout "$DOMAIN/$SYNC_LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  if git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null | grep -Fxq "worktree $WT"; then
    git -C "$REPO_ROOT" worktree remove --force "$WT" 2>/dev/null || true
  fi
  rm -rf "$SYNC_HOME"
  echo "Removed agent, worktree, and $SYNC_HOME."
}

if [ "${1:-}" = "--uninstall" ]; then uninstall; exit 0; fi

mkdir -p "$SYNC_HOME" "$(dirname "$PLIST")"

# 1. worktree pinned to origin/main (idempotent) ------------------------------
git -C "$REPO_ROOT" fetch -q origin main
if git -C "$REPO_ROOT" worktree list --porcelain | grep -Fxq "worktree $WT"; then
  echo "✓ worktree exists: $WT"
else
  git -C "$REPO_ROOT" worktree add --detach "$WT" origin/main
  echo "✓ created worktree pinned to origin/main: $WT"
fi

# 2. token → worktree's gitignored .env (never clobber an existing one) --------
ENVF="$WT/docs/intel/notion-sync/.env"
if [ -f "$ENVF" ]; then
  echo "✓ .env already present — leaving it"
elif [ -n "${NOTION_TOKEN:-}" ]; then
  printf 'NOTION_TOKEN=%s\n' "$NOTION_TOKEN" > "$ENVF"
  chmod 600 "$ENVF"
  echo "✓ wrote NOTION_TOKEN → .env (600)"
else
  echo "ERROR: $ENVF missing and \$NOTION_TOKEN not set." >&2
  echo "  Export an internal-integration token connected to the GPMG NV Parcels page, then re-run:" >&2
  echo "    NOTION_TOKEN=ntn_… $0" >&2
  exit 1
fi
# belt-and-suspenders: the .env must be gitignored so a stray `git add` can't commit it
if ! git -C "$WT" check-ignore -q docs/intel/notion-sync/.env; then
  echo "ERROR: .env is NOT gitignored — refusing to proceed (would risk committing the token)." >&2
  exit 1
fi
echo "✓ .env confirmed gitignored"

# 3. wrapper → $SYNC_HOME/run.sh (outside the worktree, never reset mid-run) ---
cp "$SCRIPT_DIR/cron-run.sh" "$SYNC_HOME/run.sh"
chmod +x "$SYNC_HOME/run.sh"
echo "✓ installed wrapper: $SYNC_HOME/run.sh"

# 4. launchd plist ------------------------------------------------------------
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SYNC_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SYNC_HOME/run.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$SYNC_HOUR</integer>
        <key>Minute</key>
        <integer>$SYNC_MINUTE</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$SYNC_HOME/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>$SYNC_HOME/launchd.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_EOF
plutil -lint "$PLIST" >/dev/null
echo "✓ wrote plist: $PLIST"

# (re)load the agent
launchctl bootout "$DOMAIN/$SYNC_LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
printf '✓ launchd agent loaded — fires daily %02d:%02d local\n' "$SYNC_HOUR" "$SYNC_MINUTE"

if [ "${1:-}" = "--run" ]; then
  launchctl kickstart -k "$DOMAIN/$SYNC_LABEL"
  echo "✓ kicked a run now — tail $SYNC_HOME/sync.log"
fi

cat <<INFO

Manage:
  run now:   launchctl kickstart -k $DOMAIN/$SYNC_LABEL
  disable:   launchctl bootout $DOMAIN/$SYNC_LABEL
  uninstall: $0 --uninstall
  logs:      $SYNC_HOME/sync.log   (launchd backstop: $SYNC_HOME/launchd.{out,err}.log)
INFO
