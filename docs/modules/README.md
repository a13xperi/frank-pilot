# Module Reference

One file per module: what it does in business terms, the workflow it encodes, its data
model, API surface, compliance anchors, flags, and an **honest** current state. This is
the platform's own doctrine applied to itself — document fully, then build.

Audiences: engineers (data model / API / flags), operators (workflow / state), and the
compliance narrative (tape stamps + citations per module).

## Documentation standard

Every module doc has these sections, in order:

1. **Purpose** — the business problem, in plain language. No jargon.
2. **Workflow encoded** — the real-world process, step by step. State machines list
   every status and what triggers each transition.
3. **Data model** — tables owned, load-bearing columns and constraints.
4. **API surface** — every route with method, path, and required permission.
5. **Compliance anchors** — tape stamps emitted (kind + legal citation), consent
   gates, and anything legally load-bearing.
6. **Flags & env** — every environment variable read and what it gates.
7. **Current state** — `live` / `flag-dark` / `stub` / `gated`, plus known gaps.
   This section is full-candor: if it isn't built, it says so.
8. **Key files** — where to look.

A doc is wrong the moment the code changes without it; PRs that change a module's
routes, schema, flags, or tape stamps must touch its doc in the same diff.

## Index

### Applicant lifecycle
| Module | One-liner |
|---|---|
| [application](application.md) | The application state machine — draft to onboarded |
| [applicants](applicants.md) | Applicant self-service: register, browse, claim, wait-list |
| [screening](screening.md) | Identity, background, credit, fraud — verdicts and holds |
| [approval](approval.md) | Tiered human approval with separation of duties |
| [adverse-action](adverse-action.md) | FCRA §1681m notices, pre-adverse window |
| [lease](lease.md) | Lease generation + native e-signature (ESIGN/UETA) |
| [messages](messages.md) | Staff ↔ applicant messaging on an application |
| [saved](saved.md) | Saved-property shortlist + guest sessions |
| [tenant](tenant.md) | Tenant portal surface: ledger view, payments, maintenance |

### Money & compliance spine
| Module | One-liner |
|---|---|
| [payment](payment.md) | Stripe rent payments — intents, webhooks, idempotency |
| [ledger](ledger.md) | Per-tenant rent ledger: charges, payments, late fees |
| [tape](tape.md) | The immutable hash-chained compliance tape |
| [compliance](compliance.md) | Fair-housing reports and compliance surfaces |
| [recertification](recertification.md) | HUD annual/interim recertification cycles |
| [renewal](renewal.md) | Lease renewal workflow |
| [eviction](eviction.md) | Notice → case sequencing, HUD-compliant |
| [moveout](moveout.md) | Move-out processing |
| [maintenance](maintenance.md) | Work orders w/ photos + timestamps |
| [inspections](inspections.md) | Unit inspections |

### Voice, search & platform
| Module | One-liner |
|---|---|
| [voice-intake](voice-intake.md) | Inbound Frank: ElevenLabs intake, review, promotion |
| [outbound-validation](outbound-validation.md) | Outbound Frank: Sage-backed wait-list validation dialer |
| [housing-qa](housing-qa.md) | Public grounded housing Q&A chat |
| [qa](qa.md) | Internal QA surfaces |
| [acquisitions](acquisitions.md) | LIHTC QAP scoring — demand evidence, projects, awards |
| [decision-matrix](decision-matrix.md) | Decision tracking surface |
| [properties](properties.md) | Properties, buildings (BINs), units |
| [users](users.md) | Staff user management |
| [auth](auth.md) | Magic links, JWT, sessions |
| [integrations](integrations.md) | Vendor adapters: Twilio, OneSite, Loft — stub vs real |
| [platform](platform.md) | Cross-cutting: RBAC matrix, audit middleware, scheduler, migrate |

*Maintained from the Jun 2026 documentation pass; update with the code.*
