# Twilio A2P 10DLC — brand + campaign application copy

> **Status:** Draft v1. Submit via Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC.
> **Why now:** approval clock is 2–4 weeks regardless of when other pieces land. Start as soon as Frank's entity legal name + EIN arrive.
> **Code:** PR #149 (`fb7c846`) is merged but inert. SMS magic-link goes live the moment A2P approves and `TWILIO_*` env vars flip in Railway.

---

## 1. Brand registration

| Field                          | Value                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Brand type**                 | Standard (low-volume <6k msgs/day to start; can upgrade later)                                                       |
| **Legal company name**         | _[Frank-Pilot entity legal name — confirm with Frank, likely "Frank-Pilot LLC" or similar]_                          |
| **DBA / brand name**           | Frank-Pilot                                                                                                          |
| **Entity type**                | _[LLC / Corporation — Frank confirms]_                                                                               |
| **Country of registration**    | United States                                                                                                        |
| **State of registration**      | Nevada                                                                                                               |
| **EIN**                        | _[from Frank — KYC packet]_                                                                                          |
| **DUNS** (optional)            | _[skip unless Frank already has one — not required for standard brand]_                                              |
| **Stock symbol** (optional)    | n/a (private)                                                                                                        |
| **Vertical**                   | Real estate                                                                                                          |
| **Website**                    | _[primary marketing site — likely https://frank-pilot.app or https://frank-pilot-tenant.vercel.app]_                 |
| **Company address**            | _[from Frank — KYC packet]_                                                                                          |
| **Authorized rep — name**      | _[Frank Hawkins, or designee]_                                                                                       |
| **Authorized rep — title**     | _[Owner / Managing Member / CEO]_                                                                                    |
| **Authorized rep — email**     | _[Frank's verified business email]_                                                                                  |
| **Authorized rep — phone**     | _[Frank's verified business phone]_                                                                                  |

Brand vetting: standard. Pay the one-time $4 vetting fee. Score ≥75 unlocks higher throughput tiers if needed later.

---

## 2. Campaign — "Account Notifications" (use case)

### Campaign details

| Field                          | Value                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Use case**                   | Account Notifications                                                                                                |
| **Sub-use cases**              | 2FA / OTP (magic-link delivery), Account Notifications (application status updates)                                  |
| **Description**                | (see below)                                                                                                          |
| **Message flow**               | (see below)                                                                                                          |
| **Opt-in type**                | Verbal + Web Form (tenant enters phone number on the registration screen and clicks "Send code via SMS")             |
| **Opt-in keywords**            | n/a (opt-in is action-based — tenant initiates SMS by selecting it as the channel)                                   |
| **Opt-out keywords**           | STOP, UNSUBSCRIBE, CANCEL, END, QUIT                                                                                 |
| **Help keywords**              | HELP, INFO                                                                                                           |
| **Numbers per campaign**       | 1 to start                                                                                                           |
| **Embedded links?**            | Yes — magic-link URLs (https://frank-pilot-tenant.vercel.app/apply?token=...)                                        |
| **Embedded phone numbers?**    | Yes — Frank-Pilot support number for HELP replies                                                                    |
| **Age-gated content?**         | No                                                                                                                   |
| **Direct lending?**            | No                                                                                                                   |

### Description (paste verbatim)

```
Frank-Pilot is an affordable-housing tenant-application platform serving
properties in Nevada. The platform sends SMS messages only to tenants who
have entered their phone number into our online application and explicitly
selected SMS as their preferred delivery channel.

Messages are limited to two purposes:
1. Magic-link / one-time login codes to authenticate the tenant into their
   application (sent on demand when the tenant requests a login link).
2. Application status updates (e.g., "your application was received",
   "documents needed", "lease ready to sign") — sent only at meaningful
   state transitions, never as marketing.

Tenants can reply STOP at any time to opt out, and HELP for support
instructions. No marketing, promotional, or commercial content is sent.
```

### Message flow (paste verbatim)

```
The tenant initiates contact by visiting our application website and
entering their phone number on the registration form. They then select
"Send code via SMS" as their authentication channel. This action constitutes
their explicit opt-in and is logged with timestamp + IP.

Within 30 seconds, they receive a magic-link SMS:
  "Frank-Pilot: tap to continue your application
  https://frank-pilot-tenant.vercel.app/apply?token=ABCDEF
  Reply STOP to opt out, HELP for help."

If they request another link later (e.g., session expired), they tap
"Resend SMS" on the login screen — same opt-in flow.

Application status notifications fire only on backend state transitions
(e.g., approval, denial, lease ready). Tenants who reply STOP are flagged
in our database (opt_out=true on the user record) and immediately stop
receiving all SMS.
```

### Sample messages (provide 2–5)

> Twilio requires real, exact wording. Use these — or update to match the strings in `src/modules/integrations/twilio.ts` / `client-tenant/src/...` if they've drifted.

1. **Magic-link (primary use case):**
   ```
   Frank-Pilot: tap to continue your application https://frank-pilot-tenant.vercel.app/apply?token=ABCDEF Reply STOP to opt out, HELP for help.
   ```

2. **Application received:**
   ```
   Frank-Pilot: we received your application for [unit]. We'll text you when there's news. Reply STOP to opt out, HELP for help.
   ```

3. **Documents needed:**
   ```
   Frank-Pilot: we need a document to finish your application. Tap to upload: https://frank-pilot-tenant.vercel.app/apply Reply STOP to opt out, HELP for help.
   ```

4. **Lease ready:**
   ```
   Frank-Pilot: your lease is ready to sign. Tap to review: https://frank-pilot-tenant.vercel.app/apply Reply STOP to opt out, HELP for help.
   ```

5. **HELP reply (auto-response):**
   ```
   Frank-Pilot: this number sends application updates only. For help, email support@frank-pilot.app or call [Frank-Pilot support number]. Reply STOP to opt out.
   ```

### Opt-out / HELP handling

- **STOP / UNSUBSCRIBE / CANCEL / END / QUIT** → Twilio handles natively + we set `opt_out=true` on the user record (already wired in PR #149).
- **HELP / INFO** → Twilio auto-responds with sample message #5 above.

---

## 3. After approval — what to flip

1. Confirm in Twilio Console that brand status = **Verified** and campaign status = **Approved**.
2. In Railway → `api` service env, set:
   - `TWILIO_ACCOUNT_SID` — Frank-Pilot live account SID
   - `TWILIO_AUTH_TOKEN` — live auth token
   - `TWILIO_MESSAGING_SERVICE_SID` — the messaging service tied to the approved campaign
   - `TWILIO_FROM_NUMBER` — the campaign's registered number
3. Smoke: hit `/api/auth/register` with `channel=sms` + a real personal phone, confirm magic-link arrives and `/apply?token=...` works.
4. Verify HELP/STOP keywords in production: text HELP to the Frank-Pilot number, confirm canned reply; text STOP, confirm subsequent magic-link sends are blocked at the app layer (`opt_out=true` check).
5. Drop `TWILIO_DEV_BYPASS` if set anywhere.

---

## 4. Cost notes

- Brand vetting: **$4** one-time
- Campaign registration: **$10** one-time + **$2/month** ongoing per campaign
- Per-message: **~$0.0083 outbound + carrier fee ~$0.002–0.004** (Account Notifications tier)
- Estimated monthly run-rate at Frank's volume: trivial relative to the $35.95 application fee.

---

## 5. Risks / gotchas

- **Wrong vertical category** is the single most common rejection reason. We are **Real Estate**, not Financial Services (we don't extend credit) — confirm this on the form.
- Twilio will sometimes ask for a screenshot of the opt-in screen. Have one ready: `/register` with the SMS channel selected and the phone field filled in.
- If brand vetting score comes back low (<60), upgrade to Verified Brand ($40) which usually clears it.
- Until approved, the live SMS path will return Twilio error codes like 30032 (campaign not approved) — keep `TWILIO_DEV_BYPASS` enabled in non-prod environments.

---

## 6. Owner + next action

- **Owner:** Alex submits, Frank's entity info populates the bracketed fields.
- **Next action:** once Frank delivers KYC packet (Section 1 of the onboarding plan), drop entity name + EIN + business address into Section 1 above and hit Submit.
