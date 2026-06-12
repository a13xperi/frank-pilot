# compliance

## Purpose

Fair Housing Act compliance reporting: decision-outcome statistics, adverse-action
notice completeness, and the documentation that objective criteria were applied
uniformly — the report a regulator (or the CFO) asks for first.

## Workflow encoded

`generateReport()` aggregates applications (optionally per property): decision counts
per tier, denials vs adverse-action notices actually sent (15 U.S.C. §1681m
completeness check — every denial must have its paper trail), outlier surfacing.

## Data model

Reads `applications` (tier decisions, statuses) joined to `adverse_action_notices`.
Owns no tables.

## API surface

`GET /api/compliance/fair-housing[?propertyId=…]` — `audit:view` (regional+).

## Compliance anchors

FCRA §1681b(b)(2) (authorization records) and §1681m (notice completeness) are the
two audits this module exists to pass; pre-adverse-action stage tracking included.

## Flags & env

`FCRA_PRE_ADVERSE_ENABLED` (affects which stages appear).

## Current state

**Live.** Gaps: no demographic/disparate-impact breakdown yet (no protected-class
data is collected — a deliberate posture worth documenting in any bias-testing
conversation); VAWA tracking is the eviction module's placeholder.

## Key files

`src/modules/compliance/{routes,fair-housing}.ts`.
