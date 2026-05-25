You're doing mobile UI QA + bug fixes on frank-pilot (apply funnel + /discover + property
detail). This machine runs MANY parallel Claude Code sessions with an automated coordination
layer — follow the coordination steps exactly so you don't clobber another session's work.

═══ COORDINATION SETUP (do this first, in order) ═══
1. Set a NAMED directive as your VERY FIRST action — before any other tool call.
   Auto-register fires on the first tool call and then throttles for 60s, so if your
   first action is anything else you'll register as "unnamed" and stay that way:
     echo "Mobile UI QA: apply funnel + discover @375px" > /tmp/claude-directive-$PPID

2. Create your own worktree off main (NOT the dirty local checkout):
     git worktree add /tmp/wt-mobile-qa -b feat/mobile-qa-funnel main
     cd /tmp/wt-mobile-qa
   (Use `git -C /tmp/wt-mobile-qa ...` for git ops — background/agent cwd can reset.)
   client-tenant needs node_modules; symlink from the primary checkout to avoid a reinstall:
     ln -s /Users/a13xperi/projects/frank-pilot/client-tenant/node_modules \
           /tmp/wt-mobile-qa/client-tenant/node_modules

3. READ /tmp/claude-session-briefing.md and /tmp/claude-peers.json BEFORE editing anything.
   Build an avoid-list: any file owned by a peer with a fresh heartbeat (<5 min) is OFF-LIMITS
   — the pre-edit hook will BLOCK your edit. Check the briefing for CURRENT owners; don't
   assume. Historically contested (verify live before touching):
     - client-tenant/src/pages/discover/PropertyList.tsx   (filter rail + cards + card mini-maps)
     - client-tenant/public/nv-housing-map.html, public/property-minimap.html  (Leaflet iframes)
     - src/modules/qa/routes.ts  (backend — never touch)

═══ CURRENT UI STATE (so you test the right thing, not a stale build) ═══
The discover/detail surfaces were heavily reworked. As of now, live on
frank-pilot-tenant.vercel.app:
  - Property photos are NEUTRAL BRAND-GENERATED placeholders (deterministic SVG gradients
    + building glyph + name word) — NOT real stock photos. This is a deliberate FAIR-HOUSING
    decision: a real-but-not-the-actual-building photo misrepresents the unit. There is NO
    "Representative photo" label anymore — it was removed in PR #186. DO NOT re-add it, and
    DO NOT swap in stock photos. Honest-by-design placeholders stay.
  - Mini-maps render on: each discover list card, the property detail hero area, and the
    discover map marker popups (testid `minimap-<slug>`). Keep the "approximate location"
    framing on these.
  - Property detail has three rich working sections: floor plans, neighborhood / "what's
    around" scores, and amenity icon chips (deterministic per property via propertyProfile.ts).

═══ TASK ═══
4. Walk the apply funnel AND /discover + a few /property/:slug pages, at 375px AND 430px
   (and spot-check 390px). The funnel: /welcome → /apply (register) → magic-link →
   /auth/callback → authenticated dashboard/application. To get a working magic-link without
   a real email send, register against the live API with the demo gate open:
     API=https://api-production-ed89.up.railway.app
     SECRET=$(railway variables --service api --kv 2>/dev/null | grep DEMO_LINK_SECRET | cut -d= -f2)
     EMAIL="demo-walk-$(date +%s)@example.com"
     curl -s -X POST "$API/api/applicants/register" -H "Content-Type: application/json" \
       -H "x-demo-token: $SECRET" \
       -d "{\"email\":\"$EMAIL\",\"firstName\":\"Demo\",\"lastName\":\"Walker\"}"
   The response `devLink` is the magic-link (15-min TTL, single-use). NOTE: prod has
   DEMO_LINK_IN_RESPONSE=false, so the `x-demo-token` header is REQUIRED — without it the
   gate stays closed and no devLink comes back.
   Mute Playwright audio (demo narration auto-plays): override media.play() to a no-op.

5. Produce a NUMBERED bug list with screenshots — NO edits yet. Post it; Alex prioritizes.
   (Known bug #1: /discover CITY chip row overflows/clips "Henderson" at ≤430px.)

═══ FIXING — PARTITION BY OWNERSHIP ═══
6. Bucket A (edit directly): bugs in files NO active peer owns — apply-funnel screens,
   shared components, src/styles/tokens.ts, client-tenant/src/i18n/{en,es}/*.json.

7. Bucket B (DO NOT edit directly if a peer owns it): discover rail / PropertyList.tsx /
   minimap HTML. If owned, route via Wire patch-handoff:
     a. Find the owner in /tmp/claude-peers.json (fresh-heartbeat session whose
        files_touched includes the file).
     b. Diagnose precisely (read-only): e.g. the CITY chip row needs flex-wrap:wrap (or
        overflow-x:auto + -webkit-overflow-scrolling:touch) using tokens.ts spacing so
        "Henderson" stops clipping at ≤430px. Note the exact selector / JSX location.
     c. Send the patch:
        source ~/battlestation/lib/wire.sh
        wire_send "cc-OWNER" "patch" '{"file":"client-tenant/src/pages/discover/PropertyList.tsx","issue":"CITY chip row clips at <=430px","fix":"<exact CSS + selector>","from":"mobile-qa"}'
     d. The owner lands it in their PR. Track as "handed off, pending owner."
     e. ONLY if no active peer owns it (heartbeat stale >5 min / "unnamed" zombie) → fix directly.

═══ CONVENTIONS & SHIP RULES ═══
- Use HF design tokens (src/styles/tokens.ts) — no hardcoded colors/spacing.
- New copy needs BOTH EN + ES i18n keys (check-i18n CI gate fails on parity gaps).
- COMPLIANCE: keep mini-map "approximate location" framing. Do NOT add "Representative photo"
  labels or stock photos — neutral generated placeholders are intentional (PR #186).
- main is protected (6 required checks: api, check-i18n, client-tenant, pm-console-e2e,
  smoke-apply, tenant-e2e). Ship via PR only. Auto-merge is OFF — watch checks, merge manually.
- tenant-e2e locks discover map counts (352/17/4/13) + apply funnel resume — if you touch
  discover, expect to update that harness, don't just disable it.
- Vercel does NOT auto-deploy main. Ask before deploying.

START BY: directive + worktree + reading the briefing, then walk the funnel and post the
numbered bug list with screenshots BEFORE fixing.
