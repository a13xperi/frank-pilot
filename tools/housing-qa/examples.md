# Example Q&A — Frank-Pilot Housing Agent (grounded, with citations)

Each example shows: the **question**, the **retrieved context summary** (what the
retriever injects), and the **ideal grounded answer** the agent should produce.
Two examples are deliberate **"I don't have that" refusals**. All values are real,
pulled from the live data via `retriever.build_context()`.

---

## 1. Named property — available-now (data lookup)

**Q:** "Tell me about Owens Senior Housing."

**Retrieved context:** `routing=named_property`, `propertyMode=full`. One property:
Owens Senior — North Las Vegas — type Senior — `availability.status=available_now`
(asOf 2026-05-22) — phone `(702) 642-0896` — waitlistUrl present — unitTypes
`["1BR","2BR","Studio"]` — amiTiers `["50%","40%"]` — accessibility "ADA
accommodations available; Elevator access; Equal Housing Opportunity" — `rent.disclosed=false`.

**Ideal answer:**
> Owens Senior is a senior community in North Las Vegas (Owens Senior — type) and
> it's in our available-now set as of the latest data (Owens Senior — availability).
> It offers Studio, 1BR, and 2BR units (Owens Senior — unitTypes), with restricted
> units at the 40% and 50% AMI tiers (Owens Senior — amiTiers). It lists ADA
> accommodations and elevator access (Owens Senior — accessibility).
> I don't have a rent figure for it — rent isn't disclosed in our data; confirm in
> the application (FAQ §rent-availability-caveat). You can reach them at
> (702) 642-0896 or join the waitlist via their link (Owens Senior — phone/waitlist).

---

## 2. Named property — REFUSAL (statewide-only, no contact/pet/rent)

**Q:** "What's the pet policy at Silver Pines Apts?"

**Retrieved context:** `routing=named_property`, `propertyMode=full`. Silver Pines
Apts — Las Vegas — Family — `availability.status=statewide_only` — amiTiers
`["60%","50%"]` — `petPolicy=null`, `contact.phone=null`, `rent.disclosed=false`.
Note: statewide-only → refuse missing fields.

**Ideal answer:**
> I don't have the pet policy for Silver Pines Apts — here's how to find out. It's
> in our statewide HUD-LIHTC dataset, which only includes its name, city, AMI tiers
> (60%/50%), and unit totals (Silver Pines Apts — statewide). It has no contact or
> pet-policy info in our data. To get the pet policy, reach the property directly —
> find it on the /discover map and contact the manager (FAQ §contact).

---

## 3. City filter (compact list)

**Q:** "Can I get a unit in Las Vegas?"

**Retrieved context:** `routing=city`, `propertyMode=compact`. Up to 8 compact
summaries for Las Vegas, available-now first; FAQ §finding-a-unit.

**Ideal answer:**
> Yes — Las Vegas has many affordable properties in our data. A few examples
> (available-now ones first): [list 3–4 by name, city, type, AMI tier, and whether
> they're available now] (city results). The available-now ones have current
> contact info; statewide-only ones we only have basic details for, as of the
> latest data (FAQ §finding-a-unit). To see real units and claim one, head to the
> Pick step in the application or browse the /discover map.

---

## 4. Attribute filter — senior + city (compact list)

**Q:** "What senior housing is available in Henderson?"

**Retrieved context:** `routing=attribute` (type=senior, city=Henderson),
`propertyMode=compact`. Note: "19 matches in Henderson; showing first 8."
First result: Smith Williams Apts (Henderson) [available_now] Senior.

**Ideal answer:**
> In Henderson we have senior properties including Smith Williams Apts, which is in
> our available-now set (attribute results). Most Henderson senior properties are
> statewide-only, meaning we have their name, AMI tiers, and address but not live
> availability or contact (FAQ §finding-a-unit). Availability is as of the latest
> data — confirm in the application (FAQ §rent-availability-caveat). Want me to
> point you to the Pick step to see claimable units?

---

## 5. Process — documents (no property)

**Q:** "What documents do I need to apply?"

**Retrieved context:** `routing=process`, `propertyMode=none`. FAQ §documents,
§application-steps. Facts: documentsNeeded list.

**Ideal answer:**
> You'll need (document checklist): a government-issued photo ID; proof of income
> (last 2 pay stubs or an offer letter); your SSN or ITIN; two prior landlord
> references from the last 3 years; and your household composition (everyone moving
> in). At the Confirm step you upload these as 5 files, dated within the last 120
> days (FAQ §documents). Have them ready before you start.

---

## 6. Process — fees

**Q:** "How much is the application fee and is it refundable?"

**Retrieved context:** `routing=process`, `propertyMode=none`. FAQ §fees. Facts:
applicationFee = $35.95 per adult 18+, non-refundable.

**Ideal answer:**
> The application fee is $35.95 per adult 18+ (application fee). It's
> non-refundable, and paying it locks your spot on the waitlist; it covers credit
> and background checks (FAQ §fees). Each adult 18+ in the household pays their own
> fee and signs.

---

## 7. Process — eligibility (general only, no personal ruling)

**Q:** "I make $40,000 a year — do I qualify?"

**Retrieved context:** `routing=process`, `propertyMode=none`. FAQ §who-its-for.

**Ideal answer:**
> I can't tell you personally whether you qualify — the application verifies that
> (FAQ §who-its-for). Here's how it works: affordable units target income tiers
> like 30%–60% of Area Median Income. During the Intent step you can enter your
> gross annual income and the app shows which tiers you *might* qualify for — that's
> a pre-qualification estimate only, not a decision. If you're over the limits, the
> app notes that market-rate units may still fit. The property makes the official
> determination when it reviews your documents.

---

## 8. Waitlist & queue position

**Q:** "How does the waitlist work and how long does my application stay active?"

**Retrieved context:** `routing=process`, `propertyMode=none`. FAQ §waitlists.
Facts: rule120.

**Ideal answer:**
> When you pay your application fee, your spot on the waitlist is locked and you get
> a queue position (FAQ §waitlists). Your application stays active for 120 days; if
> we can't house you in that window, you'll be invited to refresh and continue
> (120-day rule). You can check your position from the Confirm step or your
> dashboard. Exact wait times aren't predictable and aren't in our data.

---

## 9. REFUSAL — unknown property (not in any dataset)

**Q:** "Tell me about Moonbeam Towers."

**Retrieved context:** `routing=process`, `propertyMode=none`. Note: "Moonbeam
Towers" is NOT in the statewide or available-now data — refuse, don't invent.

**Ideal answer:**
> I don't have a property called Moonbeam Towers in our data — here's how to find
> out. Our list covers Nevada LIHTC properties and a current available-now set, and
> nothing matches that name. Try the /discover map to search by city or type, or
> tell me a city and I'll list what we do have (FAQ §finding-a-unit). I won't guess
> at details for a property I can't find.

---

## 10. Rent — caveat / refusal

**Q:** "What's the monthly rent at Aldene Kline Senior Community?"

**Retrieved context:** `routing=named_property`, `propertyMode=full`. Aldene Kline
Senior Community — Las Vegas — senior — available_now — `rent.disclosed=false`,
`rent.text=null` — office hours "Mon–Sat 9a–6p • Sun by appt." — phone
`(702) 920-6550`.

**Ideal answer:**
> I don't have a rent figure for Aldene Kline Senior Community — rent isn't
> disclosed in our data for any property (Aldene Kline — rent / FAQ
> §rent-availability-caveat). I can tell you it's an available-now senior community
> in Las Vegas with Studio/1BR/2BR units, and you can ask them directly at
> (702) 920-6550 during their office hours, Mon–Sat 9a–6p (Aldene Kline —
> phone/officeHours). Rent and current availability are best confirmed in the
> application.
