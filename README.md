# Frank Pilot — Tenant Onboarding Module

Automated, compliant tenant onboarding pipeline for the Community Development Programs Center of Nevada.

## Overview

Replaces manual, fragmented affordable housing tenant onboarding with a structured, automated pipeline featuring compliance controls and fraud prevention.

### Key Features

- **Digital-First Application Pipeline** — Standardized qualification criteria, encrypted PII
- **Screening & Compliance Engine** — Criminal background, credit check, HUD AMI tax credit compliance
- **FCRA Adverse Action Notices** — Automatic and manual notice generation per 15 U.S.C. § 1681m
- **Fair Housing Compliance Report** — Auditable outcome statistics and objective criteria documentation
- **PCI-Compliant Payment Processing** — ACH/card via Stripe, $25/mo auto-pay incentive
- **Role-Based Access Control** — Zero-trust, separation of duties, no single-person control
- **3-Tier Approval Workflow** — Senior Manager → Regional Manager → Asset Manager
- **Decision Matrix** — Automated routing for lease modifications
- **Fraud Detection** — Duplicate SSN, address flags, income mismatches, approval speed anomalies
- **Property Management** — Asset manager–controlled property registry with OneSite/Loft IDs
- **User Management API** — System-admin CRUD for staff accounts; bcrypt-hashed passwords
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

### Lease & Onboarding
- `POST /api/lease/:applicationId/generate` — Generate lease via OneSite (Asset Manager+)
- `POST /api/lease/:applicationId/onboard` — Complete onboarding via Loft (Asset Manager+)
- `GET /api/lease/:applicationId/status` — View lease and onboarding status

### Adverse Action Notices (FCRA)
- `GET /api/applications/:applicationId/adverse-action` — Retrieve most recent notice (Senior Manager+)
- `POST /api/applications/:applicationId/adverse-action/resend` — Manually resend FCRA notice (Senior Manager+)

### Properties
- `GET /api/properties` — List all properties (all roles)
- `GET /api/properties/:propertyId` — Get property detail (all roles)
- `POST /api/properties` — Create property (Asset Manager, System Admin)
- `PATCH /api/properties/:propertyId` — Update mutable property fields (Asset Manager, System Admin)
  - Note: `addressLine1`, `city`, `state`, `zip` are immutable after creation

### Users
- `GET /api/users` — List staff users, optional `?role=X&isActive=true/false` (Senior Manager+)
- `GET /api/users/:userId` — Get user detail (Senior Manager+)
- `POST /api/users` — Create staff user (System Admin only)
- `PATCH /api/users/:userId/deactivate` — Deactivate account (System Admin only)
- `PATCH /api/users/:userId/activate` — Reactivate account (System Admin only)
- `POST /api/users/:userId/reset-password` — Admin password reset, no old password required (System Admin only)

### Compliance Reports
- `GET /api/compliance/fair-housing` — Fair Housing Act compliance report (Regional Manager+)
  - Optional `?propertyId=<uuid>` to scope to a single property
  - Returns decision outcome statistics, FCRA adverse action notice completeness,
    and the documented objective screening criteria (42 U.S.C. §§ 3601–3619)

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
npm run cli -- activate-user -i <user-id> -u <actor-id>
npm run cli -- deactivate-user -e <email> -u <actor-id>
npm run cli -- reset-password -i <user-id> -p <new-password> -u <actor-id>

# Property management
npm run cli -- list-properties
npm run cli -- view-property -i <property-id>

# Applications
npm run cli -- list-applications
npm run cli -- list-applications -s submitted
npm run cli -- view-application -i <application-id>

# Screening
npm run cli -- run-screening -i <application-id> -u <user-id>

# Approval status
npm run cli -- approval-status -i <application-id>

# Lease & onboarding
npm run cli -- generate-lease -i <application-id> -u <user-id>
npm run cli -- onboard -i <application-id> -u <user-id>
npm run cli -- lease-status -i <application-id>

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

- **HUD AMI** — Income limits enforced per property area and household size (1–8 persons)
- **LIHTC §42** — IRS Form 8609/8586; 60% AMI threshold; TIC required annually
- **FCRA §1681m** — Automatic adverse action notices on all denials; manual resend endpoint
- **Fair Housing Act §§ 3601–3619** — Objective criteria only; no protected class data collected;
  compliance audit report at `GET /api/compliance/fair-housing` (Regional Manager+)
- **PCI DSS** — Stripe tokenization; no raw card data on our servers

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
│   └── seed.ts                 # Test data seeder (idempotent)
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
│   ├── lease/                  # Lease generation & onboarding orchestration
│   ├── adverse-action/         # FCRA adverse action notices (15 U.S.C. § 1681m)
│   ├── properties/             # Property registry (asset_manager+)
│   ├── users/                  # Staff user management (system_admin only)
│   ├── compliance/             # FHA compliance report (42 U.S.C. §§ 3601–3619)
│   └── integrations/           # OneSite, Loft, Twilio stubs (do not modify)
├── utils/
│   ├── encryption.ts           # AES-256-GCM encryption
│   ├── logger.ts               # Winston logger (PII-safe)
│   └── pii-filter.ts           # PII redaction engine
└── cli/index.ts                # Admin CLI tool
```
