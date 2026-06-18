# Frank Pilot — Tenant App (`client-tenant`)

The tenant-facing React/Vite app: discovery, application resume, the tenant portal
(ledger view, payments, maintenance), and the public housing-Q&A surface. Backend lives
in `../src`.

```bash
npm ci
npm run dev          # vite dev server
npm test             # vitest run
npm run check:i18n   # locale-key parity check
npm run build        # sitemap + tsc -b + vite build
```

## Night Shift

Issues labeled **`night-shift:tenant`** are auto-implemented overnight by Claude Code
running on this repo. The tenant night-shift lane (`.github/workflows/claude-night-shift.yml`,
cron `0 2 * * *` UTC / 03:00 CPH) picks the **oldest open** `night-shift:tenant` issue,
implements it on a fresh branch scoped to `client-tenant/`, runs this app's checks
(`npm ci`, `npx tsc --noEmit`, `npm test -- --run`, `npm run check:i18n`, `npm run build`),
and — only if they pass — opens a PR for morning review. It never pushes to `main`, never
merges, and never touches `.github/`, secrets, or migrations.

Queue overnight tenant work:

```bash
gh issue create --label "night-shift:tenant" --title "..." --body "..."
```

Full convention: [`../docs/night-shift.md`](../docs/night-shift.md).
