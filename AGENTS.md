# AGENTS.md — Frank-Pilot (Codex Context)

## Project
Frank-Pilot — Tenant onboarding module for Community Development Programs Center of Nevada. Handles applications, screening, lease generation, payments, and compliance.

## Stack
- Express 4.21, TypeScript 5.6, Node.js
- PostgreSQL via `pg` (raw SQL, no ORM)
- Jest 29 + ts-jest + Supertest
- Stripe for payments, Twilio for SMS
- PDFKit for document generation
- Zod 3.23 for validation, Winston for logging
- Commander 12 for CLI tools

## Structure
```
src/
  cli/          — CLI commands for admin operations
  config/       — App configuration
  db/           — Database connection, migrations, queries
  middleware/   — Express middleware (auth, validation, etc.)
  modules/
    adverse-action/  — FCRA adverse action notices
    application/     — Tenant application processing
    approval/        — Application approval workflow
    compliance/      — Regulatory compliance checks
    decision-matrix/ — Scoring and decision logic
    integrations/    — Third-party integrations
    lease/           — Lease document generation
    payment/         — Stripe payment processing
    properties/      — Property management
    screening/       — Background screening
    users/           — User management
  utils/        — Shared utilities
  index.ts      — Server entry point
```

## Commands
- `npx jest --passWithNoTests` — Run Jest test suite
- `npm run build` — TypeScript compile to dist/
- `npm run dev` — Development server with ts-node

## Branch Convention
- All Codex branches: `codex/{description}`
- Target branch: `main`

## PR Convention
- PR title: concise description of the change
- Target: `main`

## DO NOT MODIFY
- `src/db/` — Database schema and migrations (requires careful planning)
- `.env*` files — Environment configuration

## Coding Standards
- Strict TypeScript (strict: true)
- Module-based architecture: each domain has its own directory under `modules/`
- Raw SQL via `pg` — no ORM. Use parameterized queries to prevent injection.
- Zod schemas for request validation
- Winston logger for all logging
- FCRA compliance is critical — never remove compliance-related code or checks

## Testing Patterns
- Jest 29 with ts-jest for TypeScript
- Supertest for HTTP endpoint testing
- Mock database and external service calls
- Compliance-aware tests (FCRA notes in test descriptions)
- Tests in `src/__tests__/` directory
