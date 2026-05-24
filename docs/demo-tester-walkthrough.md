# Frank — 3-Minute Usability Walkthrough (Testers)

Thanks for helping us test the Frank applicant experience. This takes about
**3 minutes**. We're watching for **where you get confused or stuck** — not
whether you "do it right." There are no wrong moves.

## Start here

Open this link on your phone or laptop (any modern browser):

> **https://frank-pilot-tenant.vercel.app/?demo=demo_ad29980effbd76986279d8237d06842f**

That's it — no app to install, no account needed up front.

## What to do

1. **Sign up** like a real applicant: first name, last name, email.
   - Use any email — even a fake one like `you@example.com`. **You do not need
     a working inbox.**
2. After you submit, you'll see a **"Demo inbox"** card with your sign-in link.
   - In real life this lands in your email. Here, just tap **"Open the link"** —
     it does exactly what clicking the email link would.
3. Continue through the flow: tell us what you're looking for, browse, and
   **pick a unit**. Go as far as feels natural.

## If you get stuck

There's an **"I'm stuck"** button in the bottom-left corner the whole time.
The moment something is confusing, **tap it** and (optionally) type what
tripped you up, then **Send**. This drops a marker exactly where you were so we
can go straight to it. Use it as often as you like.

## A few notes

- **Talk out loud** if you can ("now I'm looking for the…", "wait, where's…") —
  if you're on a call with us, even better.
- Everything you do is recorded as a screen replay so we can review the rough
  spots. We mask what you type into form fields.
- These are throwaway test accounts — nothing you enter is real or kept.

When you reach a unit you'd apply for (or hit a wall you can't get past),
you're done. Thank you! 🙏

---

### For the operator (not for testers)

- Link carries the demo token `?demo=<DEMO_LINK_SECRET>`; only that token
  unlocks the inline sign-in link (prod inbox stays closed otherwise).
- Replays land in Supabase `frank-qa-screenshots` under `demo/{runId}/`
  (`replay-*.json`, `events.json`, `manifest.json`).
- Review them in the PM console → **QA Bundles → Demo sessions** tab.
- Demo signups are tagged `users.demo_run_id` so they stay out of signup
  metrics; `scripts/purge-demo-data.mjs` reaps them after the round.
- Teardown after the round: run the purge script, then unset
  `DEMO_LINK_SECRET` on the Railway `api` service to re-close the gate.
