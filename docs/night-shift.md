# Night Shift — autonomous Claude on GitHub

Claude Code runs on this repo via **anthropics/claude-code-action@v1**, in two modes,
covering both apps in the monorepo (tenant `client-tenant/` and backend `src/` + root).

| Workflow | Mode | Trigger |
|---|---|---|
| `.github/workflows/claude.yml` | Interactive | `@claude` mention in an issue, PR comment, or PR review |
| `.github/workflows/claude-night-shift.yml` | Autonomous | cron (overnight) + manual dispatch |

## How the night shift works

Two lanes, each picks the **oldest open issue** carrying its label, implements it on a
fresh branch, runs that app's checks, and **opens a PR** for morning review.

| Lane | Label | Cron (UTC / CPH) | Scope | Checks run before PR |
|---|---|---|---|---|
| tenant | `night-shift:tenant` | `0 2 * * *` / 03:00 | `client-tenant/` | `npm ci`, `npx tsc --noEmit`, `npm test -- --run`, `node scripts/check-i18n-parity.mjs`, `npm run build` |
| backend | `night-shift:backend` | `0 3 * * *` / 04:00 | `src/` + root | `npm ci`, `npm run build`, `npm test` |

**Control surface = labels.** Tag an issue with a lane label to queue it. No labeled
issues → the run is a clean no-op. One issue per run.

If the checks don't pass, the lane does **not** open a PR — it comments on the issue
with what it tried and the exact error, then stops.

## Safety rails (baked into the prompts)

- Never pushes to `main`, never merges any PR.
- Never edits `.github/`, secrets, `.env*`, or CI config.
- Never authors or runs DB migrations. If a backend issue needs a schema change, it
  describes the migration in the PR body for a human to apply.

## Secrets

| Secret | Purpose | Required? |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Auth via the Claude **Max** subscription (no API bill). Mint with `claude setup-token` (1-year token, browser OAuth). | **Yes** — the action fails without it. |
| `NIGHT_SHIFT_PAT` | Fine-grained PAT (contents + PR write) used for branch push / PR creation, so opened PRs **trigger the required CI checks**. Falls back to `GITHUB_TOKEN` if absent. | Recommended. |

> Why the PAT: GitHub suppresses workflow runs on PRs opened with the default
> `GITHUB_TOKEN` (loop guard). Under `main`'s branch protection (6 required checks) such a
> PR sits uncheckable. A PAT-opened PR fires the checks normally.

### Setup

```bash
# 1. Mint the Max token (interactive browser OAuth)
claude setup-token

# 2. Store it (paste at the prompt — gh reads stdin, never echoes to logs)
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo a13xperi/frank-pilot

# 3. (recommended) PAT so night-shift PRs trigger CI
gh secret set NIGHT_SHIFT_PAT --repo a13xperi/frank-pilot
```

## Usage

**Queue overnight work** — open an issue and label it:

```bash
gh issue create --label "night-shift:tenant"  --title "..." --body "..."
gh issue create --label "night-shift:backend" --title "..." --body "..."
```

**Test-fire manually** — Actions → "Claude Night Shift" → Run workflow, or:

```bash
gh workflow run "Claude Night Shift" -f lane=both     # or lane=tenant / lane=backend
```

> `workflow_dispatch` only becomes available once the workflow is on the **default
> branch** (GitHub limitation), so this works after the integration PR is merged to `main`.

**Interactive** — mention `@claude` anywhere in an issue or PR thread and it responds
in-thread (same auth, same repo).

## Cost

Nightly runs use Opus and draw from the Claude Max **weekly** limit — no separate API
bill. Two lanes/night is light, but heavy real issues can eat into the weekly cap.
