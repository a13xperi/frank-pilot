# BP-03b Competitive Positioning — vs. GPMGLV

_Source: `gpmglv-audit.md` (evidence-based crawl, 2026-05-21, 26 pages)._

## TL;DR

GPMGLV is an affordable-housing operator (17 LIHTC communities, ~1,000 units, Las Vegas) running a **custom Next.js marketing site with no real apply flow**. Every "Apply now" button is `href="#contact"` — a dead anchor to a 5-field contact form. The wedge isn't beating AppFolio; it's replacing **contact-form-as-funnel** with a structured applicant→tenant pipeline.

## What they actually ship

- **Funnel**: marketing → `/properties` (17 cards, no rent, no availability) → property page → `Apply now` = `#contact` (lead form) OR `Join waitlist` (loose, no validation, no position display)
- **"Resident portal"**: public `/portal` with three flows — maintenance request, contact-management, reference-number lookup. **No auth. No login. No rent pay. No docs. No lease.**
- **Stack**: custom Next.js + nginx + Plesk Linux. **No AppFolio / Yardi / RentCafe / Buildium** anywhere. Forms post to their own Next.js routes.
- **LIHTC posture**: site mentions LIHTC, NSP, "income-qualified" — but discloses **zero AMI thresholds, zero income tables, zero rent figures publicly**. Applicants cannot self-qualify before contacting.

## Where they have no answer (= BP-03b wedge)

These map 1:1 to features Frank-Pilot can ship that GPMGLV literally cannot match without rebuilding their site:

1. **Real online application.** Replace "#contact" with structured intake (household composition, income, employer, references, ID + paystub upload). Their "Apply now" is the most disingenuous CTA on the site — a 30-sec demo flip showing a real apply UX next to `href="#contact"` lands.
2. **AMI / eligibility pre-qualifier.** "Household size × gross income → you qualify at 50% AMI." Increases qualified applications, deflects unqualified ones — direct operator value.
3. **Position-aware waitlist.** GPMGLV's waitlist is a black hole (submit, wait). "#142 of 287 for Meacham 1BR" + status email is concrete differentiation that ladders directly into BP-03b's **unit-claim FTU thesis** ("claimed unit = carrot").
4. **Real applicant accounts.** No auth anywhere on the tenant side today. The unit-claim slice (PR #5 shipped) is already the right anchor — first action (claim/waitlist) creates the account, pulls them through apply → screen → deposit → tenant.
5. **EN/ES from day one.** Las Vegas affordable housing without Spanish is a real demographic gap; GPMGLV ships English only with no language switcher.
6. **Honest pricing/AMI disclosure on listing pages.** Even "rents $X–$Y based on AMI tier" beats nothing and pre-filters waste.

## What BP-03b should NOT prioritize from this audit

- **Rent payment + lease access in-portal**: yes, GPMGLV lacks these, but post-move-in features aren't the wedge — they're stage-2. Lead with the apply→tenant ramp.
- **Cookie banner / GDPR compliance**: table stakes once we have auth, not a positioning lever.
- **SEO (no robots / sitemap)**: easy infrastructure win, not a product differentiator. Backlog.

## Messaging angle

**"Their apply button does nothing. Ours becomes a home."** The audit gives us the literal proof — every property page CTA is `href="#contact"`. That's the demo cold-open: paste the GPMGLV property page, click Apply, scroll-jump to a contact form. Cut to BP-03b: same start, click Apply, land in a structured eligibility check + unit-claim. One frame, the whole pitch.

## Unknowns / verify next

- **Why did GPMGLV self-build instead of using AppFolio?** Cost? LIHTC compliance complexity? SaaS aversion? Determines whether they're a buying target or a competitor we can't unseat.
- **Are their property phone numbers staffed?** Their fallback is phone calls per property; if those go to voicemail, the gap is even wider than the website suggests.
- **Demo target**: pick one LIHTC operator like GPMGLV (Las Vegas, ≤2,000 units, custom site, no SaaS PM) and run a 15-min concierge demo of the apply flip.
