# Frank Pilot — Tenant Onboarding Module

Automated, compliant tenant onboarding pipeline for the Community Development Programs Center of Nevada.

## Overview

Replaces manual, fragmented affordable housing tenant onboarding with a structured, automated pipeline featuring compliance controls and fraud prevention.

### Key Features

- **Digital-First Application Pipeline** — Standardized qualification criteria, encrypted PII
- **Screening & Compliance Engine** — Criminal background, credit check, HUD AMI tax credit compliance
- **PCI-Compliant Payment Processing** — ACH/card via Stripe, $25/mo auto-pay incentive
- **Role-Based Access Control** — Zero-trust, separation of duties, no single-person control
- **3-Tier Approval Workflow** — Senior Manager → Regional Manager → Asset Manager
- **Decision Matrix** — Automated routing for lease modifications
- **Fraud Detection** — Duplicate SSN, address flags, income mismatches, approval speed anomalies
- **Immutable Audit Trail** — Every action logged, PII-filtered, non-repudiable

## Architecture

```
Application → Automated Screening → Tier 1 → Tier 2 → Tier 3 → Lease → Payment → Onboarded
                (Background)        (Senior   (Regional   (Asset
                (Credit)            Manager)   Manager)    Manager)
                (Compliance)
```

### Roles

| Role | Permissions |
|------|-------------|
| Leasing Agent | Application intake only (no approval authority) |
| Senior Manager | Tier 1 approval, screening initiation |
| Regional Manager | Tier 2 approval (>$1500/mo or exceptions), fraud resolution |
| Asset Manager | Tier 3 final sign-off (exceptions), property management |
| System Admin | Full system access, user management |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your database credentials and API keys

# Create database
createdb frank_pilot

# Run migrations
npm run migrate

# Seed test data
npm run seed

# Start server
npm run dev
```

### Test Credentials

All passwords: `password123`

| Role | Email |
|------|-------|
| Leasing Agent | agent@cdpc.test |
| Senior Manager | senior@cdpc.test |
| Regional Manager | regional@cdpc.test |
| Asset Manager | asset@cdpc.test |
| System Admin | admin@cdpc.test |

## API Endpoints

### Auth
- `POST /api/auth/login` — Login (returns JWT)

### Applications
- `POST /api/applications` — Create application (Leasing Agent+)
- `GET /api/applications` — List applications
- `GET /api/applications/:id` — Get application details
- `PATCH /api/applications/:id` — Update draft application
- `POST /api/applications/:id/submit` — Submit for screening

### Screening
- `POST /api/screening/:applicationId/screen` — Run automated screening (Senior Manager+)
- `GET /api/screening/:applicationId/results` — View screening results
- `GET /api/screening/:applicationId/fraud-flags` — View fraud flags
- `POST /api/screening/fraud-flags/:flagId/resolve` — Resolve fraud flag (Regional Manager+)

### Approvals
- `POST /api/approvals/:applicationId/tier1` — Tier 1 review (Senior Manager+)
- `POST /api/approvals/:applicationId/tier2` — Tier 2 review (Regional Manager+)
- `POST /api/approvals/:applicationId/tier3` — Tier 3 review (Asset Manager+)
- `GET /api/approvals/:applicationId/status` — View approval status

### Payments
- `POST /api/payments/:applicationId/customer` — Create Stripe customer
- `POST /api/payments/:applicationId/method` — Set up payment method
- `POST /api/payments/:applicationId/auto-pay` — Enroll in auto-pay
- `GET /api/payments/:applicationId` — View payment status

### Decision Matrix (Lease Modifications)
- `POST /api/modifications/:applicationId` — Request modification
- `POST /api/modifications/decide/:modificationId` — Approve/deny modification
- `GET /api/modifications/:applicationId` — List modifications

### Audit
- `GET /api/audit` — Query audit log (Regional Manager+)

### Health
- `GET /health` — Health check

## CLI

```bash
# Login
npm run cli -- login -e agent@cdpc.test -p password123

# User management
npm run cli -- create-user -e new@cdpc.test -p pass123 -f John -l Doe -r leasing_agent
npm run cli -- list-users

# Applications
npm run cli -- list-applications
npm run cli -- list-applications -s submitted
npm run cli -- view-application -i <application-id>

# Screening
npm run cli -- run-screening -i <application-id> -u <user-id>

# Approval status
npm run cli -- approval-status -i <application-id>

# Audit log
npm run cli -- audit
npm run cli -- audit -i <application-id>
npm run cli -- audit -a tier1_approved

# System stats
npm run cli -- stats
```

## Security

- **Encryption:** AES-256-GCM for SSN and DOB at rest
- **Hashing:** SHA-256 SSN hashes for duplicate detection (no reversible lookup)
- **PII Protection:** All logs PII-filtered, no sensitive data in output
- **PCI Compliance:** Stripe tokenization, no raw card data on our servers
- **RBAC:** Permission matrix enforcing least privilege
- **Separation of Duties:** No single user can submit AND approve
- **Audit Trail:** Immutable, append-only, timestamped with actor/role/IP

## Integrations

| System | Purpose | Status |
|--------|---------|--------|
| Stripe | Payment processing, tokenization | Stub (ready for key) |
| OneSite | Lease generation, document management | Stub |
| Loft | Rent collection, auto-pay, tenant portal | Stub |
| Twilio | SMS notifications | Stub (ready for key) |
| Third-party clearance | Background/credit checks | Stub |
| HUD | AMI/income verification | Stub |

## Compliance

- HUD Area Median Income (AMI) limits enforced
- IRS Form 8609/8586 tax credit compliance
- FCRA adverse action notice requirements
- Fair Housing Act compliance in screening criteria
- PCI DSS for payment data handling

## Deployment

```bash
# Build
npm run build

# Production start
NODE_ENV=production npm start
```

Environment variables required for production:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Strong random secret
- `ENCRYPTION_KEY` — 32-byte hex encryption key
- `STRIPE_SECRET_KEY` — Stripe API key
- Integration API keys as needed

## Project Structure

```
src/
├── index.ts                    # Express server entry point
├── config/database.ts          # PostgreSQL connection pool
├── db/
│   ├── schema.ts               # Full database schema
│   ├── migrate.ts              # Migration runner
│   └── seed.ts                 # Test data seeder
├── middleware/
│   ├── auth.ts                 # JWT authentication
│   ├── rbac.ts                 # Role-based access control
│   └── audit.ts                # Audit trail middleware
├── modules/
│   ├── application/            # Tenant application pipeline
│   ├── screening/              # Background, credit, compliance checks
│   ├── approval/               # 3-tier approval workflow
│   ├── payment/                # Stripe payment processing
│   ├── decision-matrix/        # Lease modification rules
│   └── integrations/           # OneSite, Loft, Twilio stubs
├── utils/
│   ├── encryption.ts           # AES-256-GCM encryption
│   ├── logger.ts               # Winston logger (PII-safe)
│   └── pii-filter.ts           # PII redaction engine
└── cli/index.ts                # Admin CLI tool
```
