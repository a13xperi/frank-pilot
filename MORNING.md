# MORNING — Jun 11 (open this first, then do nothing clever)

Full T-minus plan: Notion → "Jun 11 — Morning Plan (T-minus)" (linked from the Hub).
This file is the terminal-side half. Times assume a 9:00 meeting.

## T-80 · Pre-flight (~10 min)

    git status --short && git log --oneline -2
    # expected dirt: ONLY  M client/vite.config.ts
    # anything else uncommitted → git stash   (don't read it, don't debug it)

    ./demo-up.sh          # → READY ≈60s

Then in an **incognito** window: http://localhost:5180 → regional@cdpc.test / password123
(never reuse an old tab — stale sessions read fine, writes fail).

**60-second visual sweep:** The Ledger → Rent Ledger (ladder 2470→990) →
Applications → Maintenance → Audit Log = **"No entries"** ← pristine; create nothing.

Looks wrong? `git stash` → still wrong? `git revert cae2f7a` (kills theme).
**Do not debug past 8:00** — the five beats run on the rehearsed pages regardless.

Laptop: charger packed · lid-sleep OFF · Do-Not-Disturb ON · only the browser open.
Bring your own HDMI dongle (Craig-backup).

## T-5 at the venue

Audit Log still says "No entries" → touch nothing more. Benefits-only demo (final).

## In-room recovery ladder

1. Page dies      → ./demo-up.sh        (idempotent, reuses what's alive)
2. Data weird     → login page "Load Demo" (10s) → LOG OUT AND BACK IN (it rebuilds users)
3. Everything dies→ close the laptop; run the pitch off the Notion script + Adinkra recap

Never open :5174 — the tenant assistant is dark by design today (scope work).

## After (within the hour)

1. Recap email: the three asks verbatim + dates (Molly Jun 15 · Chase KYC Jun 12 · bridge Jun 17)
2. Debrief Claude (raw, 10 min) → outcomes get logged everywhere
3. ./demo-reset.sh   (stand-down)
