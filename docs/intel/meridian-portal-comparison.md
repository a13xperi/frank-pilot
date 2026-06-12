# Global Meridian Portal vs. Frank-Pilot — comparison

_Snapshot: 2026-06-12. Source: authenticated screenshot of `gpmglv.com/manager/briefing` +
public Next.js bundle recon + the May 22 public-site scrape (`gpmglv-extracted-summary.md`)._

## What Meridian is (and isn't)

`gpmglv.com/manager` ("Global Meridian — Property Management Portal") is a **manager
operations-briefing overlay on top of RealPage**, not a system of record. The evidence:

- Every data card is empty with **"Meridian briefing facts are not available yet,"**
  "No property rows in today's fact packet," and **"No RealPage ingest note supplied."**
  Meridian *ingests* RealPage and re-presents it; RealPage stays the book of record.
- The core object is a **daily "briefing"** — "Continue Meridian briefing," a Briefing
  History of dated sessions logged as `SKIPPED` with response counts. It's a
  morning-standup product for managers, not an application/lease/ledger pipeline.
- Tech: Next.js/Turbopack SPA, Supabase-shaped data layer (`.from(...)` calls), one
  public route `/api/login-state`. Auth-gated; no system-of-record write surface visible.

**Strategic read:** Meridian is a concrete implementation of **DM-FRANK-023 Option A**
— operations-only, RealPage remains the financial source of truth. It is precisely the
posture the CFO is leaning toward. So this isn't just a competitor; it's a working
artifact of "the other path." Frank-Pilot is the opposite bet: a full system of record
(intake → screening → approval → lease → ledger → recert → eviction), with RealPage as
*one optional interface* rather than the spine.

## Feature comparison

| Capability | Meridian (observed) | Frank-Pilot |
|---|---|---|
| **Manager daily briefing** | ✅ Core product — sessions, skip/response logging, "agenda incomplete" | ❌ Not built (we have a stakeholder "Ledger showcase," not a manager briefing loop) |
| Operations KPIs (open work orders, overdue follow-ups, active turns, delinquent households, past-due rent) | ✅ Dashboard tiles (RealPage-sourced) | ⚠️ Underlying data exists per-module (maintenance, ledger delinquencies) but **no single ops-overview dashboard** |
| **RealPage ingest** | ✅ Designed around it (read layer) | ❌ No RealPage integration (OneSite stub only); we're the SOR instead |
| AI assistant | ✅ "Assistant" + "Ask Gemini" affordance | ✅ Housing-QA (public) + Frank voice (inbound/outbound) — but tenant-facing, not a manager copilot |
| Property snapshot / portfolio roll-up | ✅ (empty fact packet) | ⚠️ Properties module + acquisitions demand rollup; no manager portfolio view |
| Items needing manager attention (work queue) | ✅ | ⚠️ We have per-module queues (screening review, voice intake, approvals) but no unified "manager attention" inbox |
| Application intake + screening | ❌ none visible | ✅ Full FCRA/HUD pipeline |
| Tiered approval + separation of duties | ❌ | ✅ |
| Immutable compliance ledger (hash-chained) | ❌ | ✅ (tape) |
| Lease generation + e-signature | ❌ | ✅ (native ESIGN/UETA) |
| Tenant portal (pay, maintenance, ledger) | ❌ none visible | ✅ |
| Wait-list + outbound voice validation | ❌ | ✅ (DM-FRANK-029) |
| Recert / renewal / eviction / move-out lifecycle | ❌ | ✅ all live |

## Takeaways for the build

1. **Meridian validates the operations-overlay model the CFO wants — and shows its
   ceiling.** It's a briefing/reporting skin; it owns no workflow, generates no lease,
   holds no compliance record. Useful contrast for the 023 conversation: "operations-only"
   delivered as Meridian = a dashboard; delivered as Frank = the actual operating system.
2. **The one thing Meridian has that we lack: a manager daily-briefing + unified ops
   dashboard.** That's a real gap and a cheap win — we already hold the data
   (maintenance work orders, ledger delinquencies, recert/renewal deadlines, screening
   queue). A "manager briefing" view that rolls these up would directly answer the
   surface Global's managers are already being trained to expect. Candidate roadmap item.
3. **RealPage ingest is their dependency and our optional adapter.** If 023 lands on
   "interface to RealPage," we'd build the same ingest Meridian relies on — but feed it
   into a system that can also act, not just brief.

## What a deeper (authenticated) scrape would need

Headless crawl stops at the login wall. To capture Meridian's real data model + routes:
- **Session token**: export the `Authorization` bearer / Supabase session from the
  logged-in browser (DevTools → Network → any `/api` or supabase request → copy
  cookie/token) → curl the endpoints directly.
- **Or paste**: the JSON from a few key XHR responses (briefing fact packet, login-state)
  reveals the schema in one shot.
- The Supabase project URL + anon key (also in the Network tab) would expose the table
  list via the REST introspection endpoint, the same way we read our own Sage project.
