# Tenant-screening vendor RFQ — template

> **Status:** Draft v1. Single reusable template. Per-vendor cover paragraphs at the bottom (Equifax, Checkr, TransUnion SmartMove, Experian RentBureau). Send from Alex.

---

## Subject

`Tenant-screening RFQ — Frank-Pilot / ~1,600 units affordable housing, NV`

---

## Body (shared across all four vendors)

Hi [vendor sales contact],

I'm Alex Peri, co-founder of Frank-Pilot — a tenant-onboarding and compliance platform serving LIHTC (Section 42) affordable housing operators. We're activating an integration partner for tenant screening across an initial ~1,600 units in the Nevada metro and want to scope your product against ours.

### Our use case

- **Volume:** ~1,600 units, ~[X] expected applications per month (turnover rate TBC).
- **Application fee charged to applicant:** $35.95/adult, which must cover screening cost + margin.
- **Screening flavor:** tenant screening for affordable-housing leases (HUD/LIHTC-compliant).
- **Compliance regime:** FCRA, HUD Fair Housing Act (Castro memo, 4/4/2016), 24 CFR Part 5 mandatory denials, Nevada NRS 118A.

### What we need to know

#### 1. Product scope
- Does your tenant-screening product bundle **all** of: credit report, criminal background, employment + income verification, eviction history, sex-offender registry (NSOPW)?
- If not bundled, which lanes do you cover natively and which are subcontracted?
- Are employment verifications real-time (Work Number, Plaid Income, payroll APIs) or manual?

#### 2. API
- Is screening available via REST API (preferred) or embed-only (e.g. SmartMove iframe)?
- API documentation URL, sample request/response.
- Webhook support for status changes (`order.completed`, `order.requires_review`, etc.).
- Sandbox environment for development?

#### 3. FCRA + HUD workflow
- Adverse-action notice (FCRA §1681m) — do you generate the letter automatically, provide a template, or leave it to the operator?
- Dispute resolution workflow — what's the API for FCRA §1681i disputes? SLA?
- HUD individualized assessment support — can your decisioning be configured to flag-only (vs auto-deny) on criminal records, leaving the final call to a human reviewer? (Required by Castro memo §III.B.)

#### 4. Credentialing + onboarding
- What's the credentialing process for a new operator? (Permissible-purpose attestation, physical address inspection, etc.)
- End-to-end time from contract signing → first API call in production.
- What documentation do we need to provide (corporate docs, secure-handling attestations)?

#### 5. Pricing
- Per-check pricing, broken out by lane (credit / criminal / eviction / employment).
- Bundle pricing if applicable.
- Monthly minimum / platform fee.
- Volume discount tiers above 100, 500, 1,000 checks/month.

#### 6. Data retention + privacy
- How long are reports retained on your side after delivery?
- SOC 2 Type II / ISO 27001 certifications? Latest audit report available under NDA?
- Where are reports stored (region) and encrypted at rest?

#### 7. Termination
- Notice period for contract termination.
- Data deletion guarantee on termination.

### Our timeline

- Quotes + scope answers: by **[target date — ~10 business days from send]**
- Vendor selection: within 2 weeks
- Credentialing kick-off: same week as selection
- Production go-live: within 4–8 weeks of credentialing start

Looking forward to your reply. Happy to set up a 30-minute call if easier.

Best,
Alex Peri
[email] / [phone]
Frank-Pilot

---

## Per-vendor cover paragraphs (insert before "Our use case")

### Equifax tenant screening sales

> *Especially interested in confirming whether Equifax's tenant-screening product can consolidate credit + Work Number employment + criminal (presumably via Sterling or Appriss partnership) into a single permissible-purpose pull. If so, this is our preferred single-vendor stack.*

### Checkr

> *We know Checkr's primary market is employment screening. Confirming up front: does your TOS permit landlord/tenant screening use cases? If yes, we'd pair Checkr (criminal lane) with another bureau partner (credit + Work Number) — and would want pricing scoped accordingly.*

### TransUnion SmartMove / ResidentScreening

> *Asking specifically about the API tier (not the SmartMove consumer-facing embed). Do you offer a true REST API for LIHTC operators at scale (1,600+ units), or is the operator-facing product still iframe-based?*

### Experian RentBureau

> *Asking about RentBureau credit + rental-tradeline pricing. Do you offer a paired criminal product, or do we need to source criminal from a partner (Checkr / Sterling) and pair it with your RentBureau pull?*

---

## Recipient mapping

| Vendor | Where to send |
|---|---|
| Equifax | sales-housing@equifax.com (or via equifax.com/business/tenant-screening contact form) |
| Checkr | sales@checkr.com (or via checkr.com/contact-sales) |
| TransUnion SmartMove | smartmove-sales@transunion.com (or via smartmove.transunion.com/contact) |
| Experian RentBureau | rentbureau@experian.com (or via experian.com/business/rent-bureau) |

> Email addresses above are best-guesses — confirm on each vendor's website before sending. If a vendor has a "request a demo" / "request a quote" form, paste the body into the form.

---

## Tracker

When responses come back, log into `docs/screening/vendor-rfq-responses.md`. Per-vendor: pricing, API yes/no, credentialing weeks, FCRA letter support, gotchas.

Decision matrix (Section 2d of the activation plan) consumes that tracker.
