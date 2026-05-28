# Frank credentials-request email — draft

> **Status:** Draft v1. Review before sending. Update bracketed fields. Send from Alex.

---

**To:** Frank Hawkins
**Cc:** Amy [@gpm], Crystal [@gpm]
**Subject:** Frank-Pilot — credentials + info we need from your side to flip the platform live

---

Frank — short, action-oriented note. Everything below is what we need from your side to flip Frank-Pilot from sandbox to live operations across the ~1,600 units. CC'ing Amy and Crystal so they can start on their pieces in parallel.

## 1. Stripe — merchant onboarding (KYC packet)

We're holding ~$1,950 in test-mode receipts. To switch to real money we need to submit a Stripe KYC packet under your merchant entity:

- Legal entity name (GPM / GLB / EBM — confirm which one)
- EIN
- Business address
- Bank routing + account number (for ACH payout)
- Beneficial owner(s) — name, DOB, last 4 SSN, address
- Confirmation of merchant-account holder

Once we have this, we submit it to Stripe directly. Underwriting is 1–3 business days.

## 2. Property-management super-user logins

Three systems we need to integrate against. Super-user (admin) level — read access at minimum, write access ideal:

- **Loft** — login URL + admin credentials
- **OneSite** (RealPage portal) — login URL + admin credentials
- **Yardi** — login URL + admin credentials

Per the MOU draft, these only need to be live during the 60-day parallel-run window. We will not write to your incumbent systems without your written sign-off on every endpoint.

## 3. DocuSign

You approved DocuSign for lease + TOS e-signature. We need either:

- DocuSign admin account access (preferred), or
- A sandbox auth token + production credentials for the eventual cutover.

## 4. June (legal)

For the adverse-action letter template (FCRA §1681m — required when we deny an applicant based on a background or credit report), we need June's intake email so we can request an attorney-reviewed template.

- June's email + best phone

## 5. BIN schedule

Exhibit A of the MOU draft. Crystal — this is your piece. For each of the ~18 properties:

- Property name + address
- Unit count
- BIN (LIHTC Building Identification Number)
- LIHTC set-aside (e.g. 60% AMI / 50% AMI / mixed)
- Compliance period end date

Target: complete spreadsheet within 5 business days per MOU §3.3.

## 6. PM direct-contact authorization

Confirm in writing (this email reply is fine) that we are authorized to contact your property managers directly for applicant routing and lease coordination. No more channeling through your phone.

## 7. Liaisons

Confirm:

- **Amy** — primary liaison for day-to-day operations
- **Crystal** — data lead for BINs, rent rolls, tenant files

Anything we should re-route?

## 8. Sending domain for outbound email

We're sending tenant-onboarding email from `[noreply@???]`. Need you to pick:

- `noreply@gpmlv.com` — uses your existing domain (faster, requires you to add 3 DNS records)
- `noreply@frank-pilot.app` — uses our domain (slower if you want it branded under GPM)

DNS records take ~24 hours to propagate; we'll send you the records to add once you pick.

---

## What this unlocks

| Your delivery | What goes live |
|---|---|
| Stripe KYC | Real $35.95/applicant payments + refunds |
| Yardi/RealPage/Loft logins | Lease creation + rent-state visibility |
| DocuSign creds | Lease + TOS auto-send to applicants |
| June's contact | FCRA-compliant adverse-action letters |
| BIN schedule | Compliance ledger goes live across portfolio |
| PM authorization | Direct applicant routing (we stop bottlenecking on you) |
| Sending domain | Real applicant emails out of test mode |

---

## Turnaround target

5 business days for items 1, 5, 6, 7, 8.
Items 2, 3, 4 can roll in as you get them — but each one is gating real product capability.

Reply-all is fine. If easier, I can grab 15 minutes with Amy + Crystal directly and walk them through pieces 2 + 5.

— Alex
