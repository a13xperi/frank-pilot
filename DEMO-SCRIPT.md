# CDPC Compliance Hub — Stakeholder Demo Script (v2)

**Duration:** ~25 minutes
**Presenter:** Facilitator with screen share
**URL:** http://localhost:5173

> **Before starting:** Click "Load Demo" on the login page to populate 13 sample applications across every pipeline stage, plus recertifications, ledger entries, eviction records, a renewal offer, and a move-out. The green confirmation banner will appear. All demo accounts use password: `password123`

---

> **OPEN DECISION — FLAG FOR FRANK:**
> Our late fee engine uses **$50 + $10/day** (from the GPMGLV lease template). However, HUD standard for subsidized LIHTC housing is **$5 + $1/day, max $30**. Which applies to GPMGLV properties? This must be resolved before go-live.

---

## Act 1: The Problem (1 min — talk track only)

> "Today a single tenant qualification takes 30 days of paper shuffling between leasing agents, managers, and compliance officers. HUD audits catch missing documentation months after the fact. We built the CDPC Compliance Hub to compress that to 30 minutes — with every compliance check automated, every decision auditable, and every role scoped to exactly what they're authorized to do."
>
> "But it's not just onboarding. The system now covers the **entire tenant lifecycle**: application, screening, approval, lease generation, rent collection, recertification, lease renewal, move-out with deposit disposition, and eviction enforcement. Every step is audited, VAWA-checked, and HUD-compliant."

---

## Act 2: Leasing Agent — Application Intake (3 min)

**Login as:** `agent@cdpc.test`

1. **Dashboard** — Point out stat cards. Note the agent sees fewer nav items (no Screening, Approvals, Evictions, etc.).

2. **Properties** — Click "Properties" — show all **16 GPMGLV properties** with Type (Senior/Family/Mixed), Jurisdiction (Las Vegas/Henderson/North Las Vegas), vacancy counts.

3. **Applications list** — Click "Applications". Show tab filters with live count badges. Click into **Marcus Rivera** (Draft) to show detail view.

4. **Create a new application** → "+ New Application". 8-section form. **Key talking point:** "All compliance math happens server-side. No human judgment in the formula."

5. **Submit for Screening** from detail page. "The agent's job is done. They can't run screening, can't approve."

**Log out.**

---

## Act 3: Senior Manager — Screening & Tier-1 Review (4 min)

**Login as:** `senior@cdpc.test`

1. **Screening page** — Queue tab shows submitted applications. Click "Screen" on **Priya Patel**. Results: green/red chips for background, credit, compliance, fraud. **"Background, credit, and AMI compliance are all automated."**

2. **Fraud flags** — Switch to Completed tab. Aisha Johnson has income mismatch flag (medium severity). "Fraud flags require Regional+ to resolve."

3. **Approvals** — Tier 1 tab. Review + Approve with mandatory notes. Show denial path too — "The system auto-generates an FCRA adverse action notice on denial."

4. **Application Detail — Pipeline Completion** — Click **Elena Vasquez** (tier3_approved):
   - Income Verification card: green checkmark (pre-verified)
   - Click **Generate Lease** → shows OneSite lease ID
   - Click **Complete Onboarding** → status = onboarded, recertification auto-created

**Log out.**

---

## Act 4: Regional Manager — Compliance & Financial (4 min)

**Login as:** `regional@cdpc.test`

1. **Tenant Ledger** — Click "Ledger" in sidebar. Delinquency dashboard:
   - **Keisha Williams**: $0 balance (all paid, current)
   - **Tomasz Kowalski**: $1,950 delinquent with late fee, **eviction trigger flagged** (4+ late payments)
   - Click into Tomasz → full ledger: rent charges, payments, late fee entries
   - **Record Payment** button → enter amount → balance updates instantly

2. **Evictions** — Click "Evictions" in sidebar. Three tabs:
   - **Violations**: Tomasz has nonpayment violation (notice_served)
   - **Notices**: 7-Day Pay-or-Quit notice with full NRS 40.253 text, certificate of mailing
   - **Cases**: (empty — show that filing a case is the next step after notice expires)
   - "Every eviction action is VAWA-checked. If a tenant has a DV flag, eviction is hard-blocked."

3. **Compliance page** — Fair Housing report: approval/denial rates, FCRA notice completeness, objective criteria.

4. **Audit Log** — Every action logged. Immutable. "Even a system admin can't erase history."

**Log out.**

---

## Act 5: Asset Manager — Renewals, Move-Outs & Final Sign-off (4 min)

**Login as:** `asset@cdpc.test`

1. **Lease Renewals** — Click "Renewals" in sidebar.
   - Keisha Williams has a renewal offer: $1,300 → $1,339 (3% increase)
   - Show rent comparison, response deadline
   - Click **Accept** → then **Approve & Extend Lease** → lease_end_date extends

2. **Move-Outs** — Click "Move-Outs" in sidebar.
   - Tomasz Kowalski: pre-inspection complete, deposit deadline countdown
   - Show inspection notes, forwarding address
   - Click into detail → **Deposit Calculator**: enter itemized deductions (keys: $25, cleaning: $150, carpet: $200)
   - System calculates refund: $950 deposit - $375 deductions - $1,950 unpaid rent = $0 refund
   - **21-day countdown timer** (NV law NRS 118A.242) visible

3. **Recertifications** — Click "Recertifications" in sidebar.
   - Summary cards: Pending, Overdue, Due in 30/60 days
   - Keisha: reminder_90 status (approaching anniversary)
   - Tomasz: submitted, ready for review → click → Approve with notes

4. **Approvals → Tier 3** — Final sign-off on applications.

**Log out.**

---

## Act 6: System Admin — User Management & Controls (1 min)

**Login as:** `admin@cdpc.test`

1. **Users page** — All staff accounts with role badges. Create, deactivate, reset password.
2. **Demo Controls** — "Post Rent" and "Process Late Fees" buttons on Ledger page (admin only) for manual trigger.

---

## Closing (2 min)

> "What you just saw is the **complete tenant lifecycle**:
> 1. Agent collects application data (no compliance math)
> 2. System runs automated screening (background, credit, AMI, fraud)
> 3. Three independent approval tiers with mandatory notes
> 4. Income verification → lease generation → tenant onboarding
> 5. Monthly rent posting with auto-pay discounts
> 6. Late fee engine ($50 Day 6, +$10/day) with 4-late-payment eviction trigger
> 7. Annual recertification with 120/90/60-day automated reminders
> 8. Lease renewal offers auto-generated 90 days before expiry
> 9. Move-out with 21-day deposit disposition countdown
> 10. NV eviction workflow with VAWA pre-check and CARES Act detection
> 11. FCRA adverse action notices auto-generated on every denial
> 12. Immutable audit log for HUD compliance
> 13. Real-time Fair Housing reporting
>
> **16 properties. 1,500+ units. Every role sees only what they need. Every action is logged. Every compliance check is automated. 30 days → 30 minutes.**"

---

## Demo Accounts Reference

| Email | Role | Can Do |
|-------|------|--------|
| `agent@cdpc.test` | Leasing Agent | Create/submit applications, view properties, view ledger |
| `senior@cdpc.test` | Senior Manager | Screening, Tier-1 approvals, fraud flags, ledger payments |
| `regional@cdpc.test` | Regional Manager | Tier-2, fraud resolution, evictions, compliance, audit log |
| `asset@cdpc.test` | Asset Manager | Tier-3, property management, renewals, move-outs, everything above |
| `admin@cdpc.test` | System Admin | User management, demo controls, everything above |

## Demo Data Highlights

| Applicant | Status | What to Show |
|-----------|--------|-------------|
| Marcus Rivera | Draft | Submit flow |
| Priya Patel | Submitted | Run screening |
| Aisha Johnson | Screening Passed | **Fraud flag** (income mismatch) |
| Elena Vasquez | Tier-3 Approved | **Full pipeline**: verify income → generate lease → onboard |
| Keisha Williams | Onboarded | **Current**: $0 balance, **renewal offer** ($1,300→$1,339), recertification approaching |
| Tomasz Kowalski | Onboarded | **Delinquent**: $1,950 balance, late fee, **eviction trigger**, 7-day notice, **move-out** with deposit calc |
| Rachel Kim | Tier-1 Denied | **Adverse action notice** (income over AMI) |

## Pre-Demo Checklist

- [ ] Backend running: `cd frank-pilot && npm run dev` (port 3002)
- [ ] Frontend running: `cd frank-pilot/client && npm run dev` (port 5173)
- [ ] Database seeded: `npm run seed` + click "Load Demo" on login page
- [ ] Browser at 100% zoom, incognito recommended
- [ ] Close other tabs to avoid distractions
