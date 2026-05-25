# Frank-Pilot CDPC — Affordable Housing FAQ

Grounding source for the housing Q&A agent. Every fact below is drawn from the
real application copy (`client-tenant/src/i18n/en/apply.json`), the apply flow
(`client-tenant/src/pages/apply/steps/`), and the two property datasets. Section
IDs are stable anchors so the retriever can keyword-match and the agent can cite
them (e.g. "see FAQ §fees" / `faq.md#fees`).

All numbers, fees, and rules here are quoted from product copy — do not invent
values not present in this doc or the injected property data.

---

<a id="who-its-for"></a>
## 1. Who affordable housing is for / AMI tiers {#who-its-for}

Affordable (LIHTC) housing serves households whose income falls at or below a
share of the **Area Median Income (AMI)** for the area. Properties set aside
units for specific AMI tiers — commonly **30%, 40%, 45%, 50%, and 60% of AMI**.
A property's tiers tell you the income bands its restricted units target.

- Each property in our data lists its `amiTiers` (e.g. `["60%","50%"]`) when
  known. AMI tiers are populated for most statewide properties; some have no
  tier data recorded.
- During the application's **Intent** step you can optionally enter your **gross
  annual income**. The app then shows which tiers you *might* qualify for
  ("You qualify for {tier} units"). If you're over the income limits, it says
  "Over income for affordable tiers. Market-rate units may still fit."
- This is a **pre-qualification estimate only** — it is never a personal ruling.
  The official income determination happens when the property verifies your
  documents.

> Eligibility rules are general. The application verifies whether you qualify —
> the agent never tells you that you personally do or do not qualify.

---

<a id="application-steps"></a>
## 2. The application steps {#application-steps}

The apply flow runs in this order:

1. **Register** — create your account (name, email, optional phone).
2. **Verify** — confirm your email via a magic link (sent by **email or SMS**).
3. **Intent** — tell us what you're looking for: bedrooms, monthly budget,
   target move-in date, household size, and (optional) gross annual income for
   AMI pre-qualification.
4. **Pick** — choose a unit. Claiming a unit **holds it for you for 48 hours**
   while you finish.
5. **Household** — confirm how many adults (18+) will live there. Each adult
   pays the fee and signs.
6. **Payment** — pay the application fee securely (see §fees).
7. **Review** — confirm the property, unit, and your locked criteria before
   paying.
8. **Confirm** — your application is started; next steps come by email and SMS.
9. **Claim** — your claimed unit is held while you complete the application.

After confirming you'll **upload your documents (5 files, < 120 days old)** —
see §documents and §after-you-apply.

---

<a id="documents"></a>
## 3. Documents you'll need {#documents}

Have these ready before you apply (the checklist step lists them):

- **Government-issued photo ID**
- **Proof of income** — last 2 pay stubs or an offer letter
- **Social Security Number or ITIN**
- **Two prior landlord references** — covering the last 3 years
- **Household composition** — everyone moving in

At the Confirm step you'll **upload your documents (5 files, < 120 days old)**.
Documents must be recent (dated within the last 120 days).

---

<a id="fees"></a>
## 4. Fees {#fees}

- The application fee is **$35.95 per adult 18+**.
- The fee is **non-refundable**.
- Paying it **locks your spot on the waitlist** ("Your spot is locked when you
  pay").
- The fee **covers credit and background checks**.
- Each adult 18+ in the household must pay their own fee and sign.

There is no other fee disclosed in the application flow. If asked about deposits,
monthly rent, or other charges, see §rent-availability-caveat — those are set by
the property and not in our data.

---

<a id="waitlists"></a>
## 5. Waitlists & queue position + 120-day rule {#waitlists}

- When you pay your fee, your **spot on the waitlist is locked** and you get a
  **queue position** (shown on the Confirm step and your dashboard; a "Check
  your position" link is provided).
- **120-day rule:** your application stays **active for 120 days**. If we can't
  house you within that window, you'll be invited to **refresh and continue**.
- If no units match your preferences right now, you can **join the waitlist
  instead** from the Pick step.

Exact wait times are not predictable and are not in our data — position depends
on the property and unit availability.

---

<a id="finding-a-unit"></a>
## 6. Finding a unit (available-now vs statewide; search by BR / budget / move-in) {#finding-a-unit}

There are two layers of property data:

- **Available now (17 properties, GPMG-managed):** these have current contact
  info, office hours, amenities, accessibility details, unit types, photos, and
  waitlist links. They are marked `availability.status = "available_now"`.
- **Statewide (335 HUD-LIHTC properties):** the full Nevada LIHTC universe.
  These are marked `availability.status = "statewide_only"` and have **no rent,
  contact, amenities, availability count, or pet policy** in our data — only
  name, city, address, unit totals, type, AMI tiers, and funding.

You can search/filter by:

- **City / area** (e.g. Las Vegas, North Las Vegas, Henderson, Reno).
- **Type** — Senior, Family, or Mixed.
- **AMI tier** — e.g. 50%, 60%.
- **Available now** — only the 17 GPMG properties.
- **Bedrooms** — bedroom/unit-type data exists **only** for the 17 available-now
  properties (via their `unitTypes`, e.g. `["1BR","2BR","Studio"]`). Statewide
  properties have no bedroom-level data.
- **Budget / monthly rent** — rent is **not disclosed** in either dataset, so we
  can't filter by price; budget is captured at Intent and used by the live unit
  picker, not by this FAQ data.

To browse units, use the **/discover** map and the apply flow's **Pick** step.

---

<a id="after-you-apply"></a>
## 7. After you apply (PM review, recertification, next steps) {#after-you-apply}

Once your application is submitted and paid:

1. **Upload your documents** (5 files, < 120 days old).
2. A **Property Manager reviews your application in 2–3 business days**.
3. You **sign your lease & addenda via DocuSign**.

**Recertification:** affordable-housing tenants are periodically re-checked
against income limits. Our platform enforces a **140% AMI ceiling** at recert —
if a household's income rises above 140% of the AMI limit for their unit, the
unit may need to convert (e.g. to market rent). This is a compliance rule for
existing tenants, not part of the initial application. The application/recert
process verifies the numbers — the agent never issues a personal ruling.

---

<a id="rent-availability-caveat"></a>
## 8. Rent & availability caveat {#rent-availability-caveat}

- **Rent is not disclosed** in our property data (`rent.disclosed = false` for
  all properties). We cannot quote a monthly rent for any property. Confirm rent
  directly with the property or in the application.
- **Availability is "as of the latest data."** The available-now set reflects a
  snapshot (see each property's `availability.asOf` date). Availability changes —
  always **confirm current availability in the application** or with the
  property.

> Standard caveat to attach to any rent/availability answer: "This is as of the
> latest data; confirm in the application."

---

<a id="accessibility"></a>
## 9. Accessibility / senior / ADA {#accessibility}

- **Senior properties** (`type = "Senior"`) are age-restricted communities. Many
  available-now senior properties note **ADA accommodations, elevator access,
  and Equal Housing Opportunity** in their accessibility details.
- Accessibility details (ADA accommodations, elevator access, etc.) are recorded
  **only for the 17 available-now properties**. Statewide-only properties have no
  accessibility field in our data — confirm with the property.
- We describe what a property offers from its own listing. We never infer or ask
  about a person's disability, age, or any other protected characteristic, and
  we never steer applicants toward or away from any property based on protected
  class. (Fair-housing neutral.)

---

<a id="contact"></a>
## 10. Contacting a property / getting help {#contact}

- **Available-now (GPMG) properties** have a **phone number, office hours, and a
  waitlist link** in our data; a couple also list an email. Use those to reach
  the property directly.
- **Statewide-only properties** have **no contact info** in our data — we have
  only their name, city, and address. To reach them, search for the property
  manager or use the **/discover** map.
- To get help with your application, continue through the apply flow or go to
  your **dashboard** ("Go to my dashboard"). Next steps are also sent by email
  and SMS after you apply.
