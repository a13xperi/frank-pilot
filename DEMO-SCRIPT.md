# CDPC Compliance Hub — Stakeholder Demo Script

**Duration:** ~15 minutes
**Presenter:** Facilitator with screen share
**URL:** http://localhost:5173

> **Before starting:** Click "Load Demo" on the login page to populate 13 sample applications across every pipeline stage. The green confirmation banner will appear. All demo accounts use password: `password123`

---

## Act 1: The Problem (1 min — talk track only)

> "Today a single tenant qualification takes 30 days of paper shuffling between leasing agents, managers, and compliance officers. HUD audits catch missing documentation months after the fact. We built the CDPC Compliance Hub to compress that to 30 minutes — with every compliance check automated, every decision auditable, and every role scoped to exactly what they're authorized to do."

---

## Act 2: Leasing Agent — Application Intake (3 min)

**Login as:** `agent@cdpc.test`

1. **Dashboard** — Point out stat cards: active applications, pending counts. Note the agent sees *fewer* nav items than managers (no Screening, Approvals, Compliance, Audit).

2. **Applications list** — Click "Applications" in sidebar.
   - Show tab filters: All / Draft / Submitted / Screening / In Approval / Approved / Denied
   - Point out each tab shows a live count badge
   - Click into **Marcus Rivera** (status: Draft) to show the detail view

3. **Create a new application** — Click "+ New Application" button.
   - Fill out the form (8 sections): property select, applicant info, address, employment, household, rental history, emergency contact, lease preferences
   - **Key talking point:** "The form collects raw data. All compliance math — AMI thresholds, asset imputation, passbook rate — happens server-side. No human judgment in the formula."
   - Submit the form → status becomes "draft"

4. **Submit for screening** — From the application detail page, click "Submit for Screening"
   - Status changes to "submitted"
   - "The agent's job is done. They can't run screening, can't approve. Separation of duties is enforced by the system."

**Log out.**

---

## Act 3: Senior Manager — Screening & Tier-1 Review (4 min)

**Login as:** `senior@cdpc.test`

1. **Dashboard** — Senior sees more stats: pending screening count, pending approval count.

2. **Screening page** — Click "Screening" in sidebar.
   - **Queue tab** shows submitted applications awaiting screening
   - Click "Screen" on **Priya Patel** (submitted)
   - System runs automated checks: background, credit, compliance (60% AMI), fraud detection
   - Results appear: green pass/red fail chips for each check
   - **Key talking point:** "Background check, credit pull, and AMI compliance are all automated. No manual lookup. The fraud engine cross-references income against employer records and flags discrepancies."
   - Switch to **Completed tab** → show Aisha Johnson has a fraud flag (income mismatch, medium severity)

3. **Approvals page** — Click "Approvals" in sidebar.
   - **Tier 1 tab** is active (Senior Manager's domain)
   - Click "Review" on a screening-passed application
   - Modal shows application summary, requires typed notes
   - Click "Approve" → application advances to next stage
   - **Denied path:** Click "Review" on another → type denial reason → "Deny"
   - "The system auto-generates an FCRA adverse action notice on denial. No one forgets to send it."

4. **Show separation of duties** — If the senior manager submitted the application, the Approve button is disabled with a tooltip explaining why.

**Log out.**

---

## Act 4: Regional Manager — Tier-2 & Compliance (3 min)

**Login as:** `regional@cdpc.test`

1. **Approvals → Tier 2 tab** — Show applications that passed Tier 1 and require regional review (rent > $1,500 or flagged).
   - Review and approve **Lydia Zhang** (rent $1,600 triggered Tier 2)
   - "Regional review is only triggered when thresholds are exceeded. Most applications skip straight from Tier 1 to Tier 3."

2. **Screening → Fraud flags** — Navigate to Screening page, find Aisha Johnson.
   - Click into results → show the income mismatch flag
   - Regional manager can resolve the flag with notes
   - "Fraud flags require Regional+ to resolve. The agent and senior manager can see them but can't dismiss them."

3. **Compliance page** — Click "Compliance" in sidebar.
   - Fair Housing report: approval/denial rates, FCRA notice completeness, objective criteria adherence
   - "This is the report HUD auditors ask for. It's generated in real-time from the decision data, not assembled manually."

4. **Audit Log** — Click "Audit Log" in sidebar.
   - Every action is logged: who did what, when, to which application
   - Filter by application ID or action type
   - "This is an immutable log. A database trigger prevents deletion or modification. Even a system admin can't erase history."

**Log out.**

---

## Act 5: Asset Manager — Final Sign-off (2 min)

**Login as:** `asset@cdpc.test`

1. **Approvals → Tier 3 tab** — Show applications awaiting final sign-off.
   - Review and approve **David Okafor**
   - "Three independent reviewers, three different roles, zero ability for any one person to push an application through alone."

2. **Properties page** — Click "Properties" in sidebar.
   - Show property list: Desert Oasis Apartments, Sunrise Gardens
   - Click "New Property" → show create form (name, address, units, AMI area)
   - Edit an existing property → note address is locked (immutable after creation)

3. **Application detail — fully approved** — Navigate to Applications, click **Elena Vasquez** (tier3_approved).
   - Show the complete approval chain: all three tiers with timestamps and reviewer names
   - "From intake to final approval, everything is traced. The lease generation step comes next."

**Log out.**

---

## Act 6: System Admin — User Management (1 min)

**Login as:** `admin@cdpc.test`

1. **Users page** — Show all staff accounts with role badges.
   - Filter by role, filter by active/inactive
   - Create a new user → select role from dropdown
   - Deactivate a user → they can no longer log in
   - Reset password
   - "Only system admins can manage user accounts. Even asset managers can't create users."

---

## Closing (1 min)

> "What you just saw is the entire tenant qualification pipeline:
> 1. Agent collects application data (no compliance math)
> 2. System runs automated screening (background, credit, AMI, fraud)
> 3. Three independent approval tiers with mandatory notes
> 4. FCRA adverse action notices generated automatically on denial
> 5. Immutable audit log for HUD compliance
> 6. Real-time Fair Housing reporting
>
> Every role sees only what they need. Every action is logged. Every compliance check is automated. 30 days → 30 minutes."

---

## Demo Accounts Reference

| Email | Role | Can Do |
|-------|------|--------|
| `agent@cdpc.test` | Leasing Agent | Create/submit applications, view properties |
| `senior@cdpc.test` | Senior Manager | Run screening, Tier-1 approvals, view fraud flags |
| `regional@cdpc.test` | Regional Manager | Tier-2 approvals, resolve fraud flags, compliance reports, audit log |
| `asset@cdpc.test` | Asset Manager | Tier-3 approvals, manage properties, all of the above |
| `admin@cdpc.test` | System Admin | Manage users, load demo data, everything above |

## Demo Data Highlights

| Applicant | Status | Why It's Interesting |
|-----------|--------|---------------------|
| Marcus Rivera | Draft | Ready to submit — show the submit flow |
| Priya Patel | Submitted | Ready to screen — show screening results |
| Aisha Johnson | Screening Passed | Has a **fraud flag** (income mismatch) |
| Lydia Zhang | Tier-1 Approved | Triggered Tier-2 review (rent $1,600 > $1,500 threshold) |
| David Okafor | Tier-2 Approved | Ready for Tier-3 final sign-off |
| Elena Vasquez | Tier-3 Approved | Fully approved — ready for lease generation |
| Omar Hassan | Lease Generated | Awaiting onboarding |
| Keisha Williams | Onboarded | Complete end-to-end example |
| Rachel Kim | Tier-1 Denied | Has **adverse action notice** (income over AMI) |
| Steven Park | Cancelled | Shows cancellation path |

## Pre-Demo Checklist

- [ ] Backend running: `cd frank-pilot && npm run dev` (port 3002)
- [ ] Frontend running: `cd frank-pilot/client && npm run dev` (port 5173)
- [ ] Database seeded: base seed (`npm run seed`) + demo seed (click "Load Demo" on login page)
- [ ] Browser zoom at 100%, incognito/private window recommended
- [ ] Close other browser tabs to avoid notification distractions
