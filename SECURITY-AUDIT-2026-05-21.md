# Security Audit — Public API Surface (2026-05-21)

Scope: `src/modules/applicants/routes.ts`, `src/modules/auth/`, `src/middleware/auth.ts`, `src/middleware/rbac.ts`, `src/middleware/scope.ts`, `src/modules/tenant/routes.ts`, `src/modules/messages/routes.ts`, `src/index.ts`, `src/config/database.ts`. Out of scope: `client-tenant/`, modules outside the priority list. Research only — no code changes.

---

## TL;DR

- **CRIT-1**: Staff password login (`POST /api/auth/login`) has **no rate limit**, **no zod validation**, and a **timing side-channel** that distinguishes unknown / inactive / applicant-with-NULL-password-hash / wrong-password / correct-password by latency and 500-vs-401 status. Unlimited online password guessing on a real Frank/CDPC staff endpoint days before going live.
- **HIGH-1**: Tenant portal routes `GET /dashboard`, `GET /applications/:id`, `GET /applications/:id/ledger`, `POST /applications/:id/pay`, `GET|POST /maintenance` do **NOT** require `requireEmailVerified`. Only `messages` write/read paths got the gate. Defeats half the purpose of WARN #2 — a token whose underlying account had `email_verified_at` administratively cleared still hits SSN-adjacent PII and can post fake ledger entries.
- **HIGH-2**: Wide-open CORS fallback — `app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }))` in `src/index.ts:43`. `.env.example` does **not** set `CORS_ORIGIN`, so a missed Railway env var ships `*` to production. Combined with `Authorization: Bearer` and the long 8h JWT, any third-party site can drive a victim's verified browser to issue authenticated requests if a logged-in user pastes their token anywhere (and `*` blocks credentialed cookies but not bearer-auth XHRs — so once a token is in JS, *.frank-pilot.com isn't required to read it).
- **What we got right**: zod on every body-parsing route in scope; parameterized SQL throughout (no template-literal interpolation in `query(...)` other than safe constants); per-user advisory-lock around `/claim-unit`; hashed magic-link tokens with 15-min TTL and used-once flag; `authenticate` re-reads `email_verified_at` from DB on every request so a forged/stale token can never upgrade itself; INFO-1 timing-floor on `/register`; magic-link link redaction in logs.

---

## Findings

### 1. [CRIT] Staff login: no rate limit + bcrypt-timing user enumeration + 500-vs-401 oracle

`src/index.ts:77-96` + `src/middleware/auth.ts:118-148`

```ts
// src/index.ts
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json(...); return; }
    const result = await login(email, password);
    if (!result) { res.status(401).json({ error: "Invalid credentials" }); return; }
    res.json(result);
  } catch (err) {
    logger.error("Login error", ...);
    res.status(500).json({ error: "Login failed" });
  }
});

// src/middleware/auth.ts
export async function login(email, password) {
  ...
  if (result.rows.length === 0) return null;          // fast: ~5ms
  const user = result.rows[0];
  if (!user.is_active) return null;                    // fast: ~5ms
  const valid = await bcrypt.compare(password, user.password_hash);  // slow: ~80ms; THROWS if password_hash is null
  if (!valid) return null;
  ...
}
```

**Attack / consequence**: Three problems in one route:
1. **No rate limit anywhere** on `/api/auth/login`. An attacker can run unlimited password-guessing against every known CDPC staff email — and CDPC staff emails will be guessable (`firstname.lastname@cdpcnv.org` or similar).
2. **Timing side channel**: unknown/inactive users return in ~5 ms; valid+wrong-password runs bcrypt for ~80 ms. The latency delta enumerates staff accounts.
3. **500-vs-401 oracle for applicant emails**: applicant/tenant users have `password_hash = NULL`. `bcrypt.compare(pw, null)` throws → caught by `/api/auth/login` outer try → returns **500**. So:
   - email doesn't exist → 401, fast
   - email is applicant/tenant → 500
   - email is staff w/ wrong pw → 401, slow
   - email is staff w/ correct pw → 200, slow
   That's a 4-state classifier on any email an attacker probes.

**Fix**:
- Add an IP+email rate limiter (5/min, lockout to 1/min after 50 fails/hr) on `POST /api/auth/login`.
- In `login()`, if `result.rows.length === 0 || !user.is_active || user.password_hash == null`, run a dummy `bcrypt.compare(password, BCRYPT_DUMMY_HASH)` so all paths take ~80 ms, then return null.
- Wrap the `bcrypt.compare(...)` call in a try/catch returning null on throw, so the 500 oracle disappears.

---

### 2. [HIGH] `requireEmailVerified` missing on tenant portal PII routes

`src/modules/tenant/routes.ts:44-45`, `57`, `221`, `255`, `288`, `327`, `368`

```ts
router.use(authenticate, requireTenantRole, scopeToOwnApplications);
// ...
router.get("/dashboard", ...)
router.get("/applications/:applicationId", ...)
router.get("/applications/:applicationId/ledger", ...)
router.post("/applications/:applicationId/pay", ...)        // writes to ledger
router.get("/maintenance", ...)
router.post("/maintenance", ...)
router.get("/applications/:applicationId/messages", ...)
```

Only the **message write** and **mark-read** routes (lines 426 and 465) carry `requireEmailVerified`. Everything else relies solely on `authenticate` + `requireTenantRole` + the user_applications ownership join.

**Attack / consequence**: The intended invariant from WARN #2 is "no tenant-side action without proof of email control." The DB column `users.email_verified_at` is the live source of truth (re-read on every request by `authenticate`), so an admin clearing it — or a future flow that issues a JWT pre-verification — opens these routes back up to a non-verified principal. They expose PII (SSN-adjacent application detail, ledger), accept money mutations (`/pay`), and let a non-verified principal create work orders with attacker-controlled content. There's no defense-in-depth between the JWT and the data.

**Fix**:
- Move `requireEmailVerified` up to the router-level chain on `src/modules/tenant/routes.ts:45`: `router.use(authenticate, requireTenantRole, requireEmailVerified, scopeToOwnApplications);`. Anything that should remain reachable pre-verification (none of these should) becomes an explicit opt-out.

---

### 3. [HIGH] CORS fallback to `*` when `CORS_ORIGIN` unset

`src/index.ts:43`, `.env.example`

```ts
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
```

`.env.example` does not declare `CORS_ORIGIN`. Railway is one missed env var away from a wildcard-CORS production deploy.

**Attack / consequence**: With `*` and bearer auth (no cookies), browsers will execute cross-origin XHRs from any site and read responses. If a tenant ever pastes their JWT into a third-party page (e.g. a "decode my token" debugger) or if any other XSS sink leaks the token, every other origin on the internet can drive that token at the API. Even absent token theft, the wildcard reveals that you don't care about origin policy — bad signal for a HUD/PII surface.

**Fix**:
- Change line 43 to fail-closed: `const origin = process.env.CORS_ORIGIN; if (!origin) throw new Error("CORS_ORIGIN required"); app.use(cors({ origin: origin.split(",") }));`
- Add `CORS_ORIGIN=https://tenant.cdpcnv.org,https://staff.cdpcnv.org` (or the actual prod hosts) to `.env.example` and Railway.

---

### 4. [HIGH] `jwt.verify` not pinned to an algorithm; staff-issued tokens trust JWT_EXPIRY env

`src/middleware/auth.ts:73`

```ts
jwt.verify(token, JWT_SECRET);
```

**Attack / consequence**: `jsonwebtoken@9.x` defaults block `alg: none` and require the alg to match the key type for asymmetric keys — so this is not a classic alg-confusion bypass today. But: HMAC verification with a string secret accepts any HS* alg (HS256, HS384, HS512). If a future change introduces an RSA public key for any reason, the code path becomes susceptible to RS↔HS confusion. Pin algorithms now while the surface is small.

Also: `JWT_EXPIRY` defaults to `8h` (line 55). Stolen tokens are valid for 8h with no revocation list — long for a PII portal.

**Fix**:
- `jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })`.
- Drop default `JWT_EXPIRY` to `2h` or `1h` for tenant role; staff can keep 8h. Track tokens server-side for revocation when the user logs out / changes role.

---

### 5. [HIGH] `/api/auth/magic-link/verify` is not rate-limited

`src/modules/auth/routes.ts:55-73`

```ts
router.post("/magic-link/verify", async (req, res) => { ... });
```

**Attack / consequence**: The token is 32 bytes base64url → brute force is not feasible. However an unlimited verify endpoint enables (a) targeted DoS by burning DB connections on the SELECT join, and (b) any future token-shortening regression becomes immediately exploitable. The `/magic-link/request` route has a limiter; this is the matching gap.

**Fix**: Apply an IP-keyed limiter (e.g. 20 attempts / 5 min / IP). Token shape isn't sensitive enough to need an email key.

---

### 6. [MED] `/api/auth/login` accepts unvalidated `req.body` — no zod schema

`src/index.ts:77-96`

```ts
const { email, password } = req.body;
if (!email || !password) { ... }
```

**Attack / consequence**: `email` could be an array, object, or NaN. `email` as an object reaches the SQL parameter binding `[email]` — `pg` will reject (so SQLi is not the vector), but the catch-handler returns 500, distinguishing "weird payload" from "wrong creds" (oracle pile-on top of finding #1). Zod also lowercases / trims, preventing key-collision noise in the rate limiter.

**Fix**: Add `const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });` and `safeParse` before calling `login(...)`.

---

### 7. [MED] Magic-link request rate limiter is bypassable by rotating email

`src/modules/auth/routes.ts:14-21`, `src/modules/applicants/routes.ts:23-30`

```ts
keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${(req.body?.email ?? "").toLowerCase()}`,
```

**Attack / consequence**: Key is `ip:email`, so the 5/min cap is *per email*. A single IP can mint links for 5 *new* emails per minute (300/hr/IP), creating unbounded `users` rows from `/register` and unbounded `magic_link_tokens` rows from `/magic-link/request` (which only issues if user exists, so this is mostly a `/register` DoS vector). Combined with the timing floor (250 ms), one IP burns ~12 register requests/sec of server time and grows the `users` table.

**Fix**: Add a second IP-only limiter (e.g. 30/min/IP) layered on top of the per-email one. Or compute key as `ip` alone with a higher ceiling, since email-rotating is what we actually want to throttle.

---

### 8. [MED] No `requireEmailVerified` on `GET /api/tenant/me`

`src/modules/tenant/routes.ts:50`

```ts
router.get("/me", async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});
```

**Attack / consequence**: Echoes the authenticated user object including role, propertyIds, and emailVerified. Not catastrophic, but the client uses this as a "session valid?" check — and any future addition of fields here (e.g. last_login, ssn_last_4) inherits the missing gate. Already a precedent: it sits *under* `requireTenantRole` but not `requireEmailVerified`, which is inconsistent with the messaging routes 50 lines below.

**Fix**: Same as #2 — promote `requireEmailVerified` to the `router.use(...)` chain.

---

### 9. [MED] `POST /api/applications/:id/messages` (staff) uses `application:read` permission

`src/modules/messages/routes.ts:102-132`

```ts
router.post(
  "/:id/messages",
  authenticate,
  messageWriteLimiter,
  requirePermission("application:read"),  // <-- read perm guards a write
  async (req, res) => { ... });
```

**Attack / consequence**: Per `src/middleware/rbac.ts:22-23`, `application:read` is granted to every staff role including `leasing_agent`. So leasing agents can post messages on any application they can read. That may be intentional, but the permission name is misleading and means there's no separate revocation lever for messaging vs. reading. Also `messages/:msgId/read` (line 138) takes the same read-perm — applies for the same reason.

**Fix**: Introduce `application:message` permission, grant to the same role set initially. Future restrictions are then a one-line matrix edit instead of a route change.

---

### 10. [MED] `requireEmailVerified` staff bypass is role-based, not auth-mechanism-based

`src/middleware/scope.ts:141-164`

```ts
if (!["applicant", "tenant"].includes(req.user.role)) {
  next();
  return;
}
```

**Attack / consequence**: The bypass intent is "password login is itself proof of account control." But the logic is "any non-applicant non-tenant role is exempt." If the role enum ever grows (e.g. a new `vendor` or `external_auditor` role wired through magic-link instead of password), they silently inherit the bypass.

**Fix**: Gate the bypass on the auth mechanism the JWT was minted from. Add `authMethod: "password" | "magic-link"` to the JWT payload and the DB-read user, and bypass only when `authMethod === "password"`.

---

### 11. [LOW] `logger.info("Magic link issued", { email, link: safeLink })`

`src/modules/auth/magic-link-service.ts:85`

```ts
logger.info("Magic link issued", { email, link: safeLink });
```

**Attack / consequence**: `filterPII` only runs against `info.message`, not metadata. Winston serializes the metadata object directly into the JSON log line, so `email` appears in cleartext in `logs/combined.log` and any log-shipping pipeline (Railway, Datadog). Same shape applies to `logger.info("Register attempt", { email })` in `src/modules/applicants/routes.ts:142`. CDPC's nonprofit-housing tenants are a protected class — leaking which emails registered to a HUD-compliance program is a confidentiality breach even without inner application data.

**Fix**: Hash or partial-mask the email before logging (`alex***@gmail.com`), or extend `filterPII` / a Winston format to walk the metadata object and redact `email`/`phone`/`ssn` keys. The `sanitizeObject` helper exists in `src/utils/pii-filter.ts` but isn't wired into the winston format.

---

### 12. [LOW] `/api/applicants/properties/:slug/waitlist-summary` echoes attacker input

`src/modules/applicants/routes.ts:230-249`

```ts
const slug = String(req.params.slug ?? "");
res.json({ slug, position: 12, totalQueue: 38, ... });
```

**Attack / consequence**: Slug is reflected in the response unvalidated and unbounded in length. Public + no auth + no rate limit. Currently placeholder data, but if the frontend ever renders the slug client-side without escaping, this is a vector for reflected content injection. Right now: low impact, but a free abuse surface.

**Fix**: Validate `req.params.slug` against a regex (e.g. `/^[a-z0-9-]{1,64}$/`) and 400 on mismatch. Add a light IP-keyed limiter (e.g. 60/min/IP).

---

### 13. [LOW] `POST /api/demo/seed` exists in `src/index.ts`

`src/index.ts:168-182`

```ts
app.post(
  "/api/demo/seed",
  authenticate,
  requirePermission("user:manage"),
  async (_req, res) => {
    const { seedDemoData } = await import("./db/seed-demo");
    const result = await seedDemoData();
    ...
  }
);
```

**Attack / consequence**: Gated to `system_admin`, so authz is sound. But the route exists in production and a compromised admin token (8h validity, no revocation) can repeatedly seed demo data into the live DB. Real-data and demo-data should not share a runtime.

**Fix**: Wrap the route registration in `if (process.env.ALLOW_DEMO_SEED === "true")`, default to off, and never set true on Railway prod.

---

### 14. [LOW] `register` and `intent` accept `req.user!.firstName` from the DB for application insert; no length cap re-check

`src/modules/applicants/routes.ts:383-385`, `592-594`

```ts
req.user!.firstName ?? "",
req.user!.lastName ?? "",
req.user!.email,
```

**Attack / consequence**: These come from `users` row populated by `/register`, which is zod-validated to ≤100 chars. So the values entering `applications` are pre-validated — no SQLi or oversize risk. Only worth a NIT mention: if `users.first_name` is ever populated via another path (admin import, SSO), this code trusts it.

**Fix**: NIT — apply `.slice(0, 100)` defensively or re-zod, but only if you ever onboard non-register-flow users.

---

### 15. [NIT] `magic_link_tokens.used_at` set AFTER `email_verified_at` stamp — not in a transaction

`src/modules/auth/magic-link-service.ts:55-67`

Three sequential `await query(...)` calls (mark used, update last_login, set email_verified_at) outside a transaction. If the process crashes between #1 and #3, the token is "used" but the user is not "verified." Recovery is a manual re-issue. Not security-critical; reliability.

**Fix**: Wrap the trio in `transaction(async (client) => { ... })`.

---

## What's already solid (do not regress)

- **Parameterized SQL everywhere in scope**. Every `query(...)` and `client.query(...)` uses `$N` placeholders. The only template-literal interpolations into SQL (`${senderRoleCondition}`, `${scope.sql}`) are hard-coded constants, not user input.
- **`authenticate` re-reads `email_verified_at` from DB on every request**. The JWT claim is correctly treated as advisory. This makes WARN #2 robust against forged or stale tokens.
- **Magic-link tokens are SHA-256 hashed in `magic_link_tokens.token_hash`** — a DB dump doesn't yield usable tokens. 15-min TTL, single-use via `used_at`.
- **`/register` floor-timing (`respondAtFloor`) and uniform 202 response** correctly close INFO-1 (timing) and INFO-4 (log-fingerprinting). Don't regress the floor when adding new branches.
- **Per-user advisory lock around `/claim-unit`** prevents cross-tab race that would orphan held units.
- **`assertApplicationOwnership` + `scopeToOwnApplications`** consistently used on tenant routes that take `:applicationId`. PR #34 fix (apply `applicationId` to the UPDATE in `messages/service.ts:markRead`) is intact.
- **`express.json({ limit: "1mb" })`** caps request bodies. **`helmet()`** applied with defaults.
- **PR #34 IDOR fixes hold**: `messages/service.ts:markRead` filters on both `application_id` and `id`, and pairings are enforced (`reader=staff ⟹ sender ∈ {applicant,tenant}`).
- **`jsonwebtoken@9.0.2`, `bcrypt@5.1.1`, `helmet@7.1.0`, `express@4.21.0`, `express-rate-limit@8.5.1`** — all current, no known critical CVEs as of audit date. `pg@8.13.0` clean.

---

## Recommended next steps

### Before Frank touches the URL (P0)
1. **#1** — Rate-limit `/api/auth/login`, zod-validate body, neutralize the 500-vs-401 oracle (dummy bcrypt on the early-null path, try/catch around `bcrypt.compare`).
2. **#2** — Promote `requireEmailVerified` to the `router.use(...)` chain on `src/modules/tenant/routes.ts:45`.
3. **#3** — Fail-closed CORS; set `CORS_ORIGIN` explicitly in Railway and `.env.example`.
4. **#11** — Stop logging plaintext emails (extend winston format to walk metadata via `sanitizeObject`).

### Before BP-04 ships (P1)
5. **#4** — Pin `jwt.verify` algorithms, shorten tenant JWT to 1–2h.
6. **#5** — Rate-limit `/magic-link/verify`.
7. **#6** — zod schema on `/api/auth/login`.
8. **#7** — Add IP-only limiter layer on `/register` and `/magic-link/request`.
9. **#10** — Make `requireEmailVerified` bypass auth-method-based, not role-based.
10. **#15** — Transactionalize the magic-link verify writes.

### Hygiene / BP-05+ (P2)
11. **#8** — Cosmetic: move `requireEmailVerified` onto `/me`.
12. **#9** — Introduce `application:message` permission for granularity.
13. **#12** — Validate `:slug`, add public-route limiter.
14. **#13** — Gate `/api/demo/seed` behind `ALLOW_DEMO_SEED`.
15. **#14** — Defensive `.slice(0, 100)` on user-cached display fields (only if onboarding gains a non-register path).
