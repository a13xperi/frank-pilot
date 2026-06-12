# properties

## Purpose

Property master data: managed properties, their LIHTC posture (compliance period,
LURA, mortgage — the CARES Act trigger), unit mix and rent schedules, plus the
buildings/BIN layer (§42 Form 8609) and per-unit records that drive the picker and
availability surfaces.

## Workflow encoded

Public list with availability rollup (`available_now` / `fully_leased` / `fully_held`
computed from `units`); authenticated detail with the compliance-relevant extended
fields; asset-manager CRUD with zod validation.

## Data model

`properties`: address fields, `unit_count`, `ami_area`, `property_type`,
`lihtc_type`, `ami_set_aside`, `compliance_period_start/end`, `has_lura`,
**`has_mortgage`** (CARES Act eviction trigger), `jurisdiction`, `unit_mix` JSONB,
`rent_schedule` JSONB, `waiting_list_enabled`, integration ids
(`onesite_property_id`, `loft_property_id`), `election_8b` (Form 8609 line 8b).
`buildings`: `building_code`, `bin` (globally unique when present),
`bin_confidence` (`confirmed`/`provisional`), per 2026-05-30 migration.
`units`: status (`available`/`held`/`leased`), `claim_expires_at` (lazy expiry),
`ami_designation` CHECK (30/50/60/market), `building_id`, `photo_url`
(**field exists; no upload pipeline — photos are placeholder SVGs client-side**).

## API surface

| Route | Permission |
|---|---|
| `GET /api/properties` (filters: amiTier, bedroom, availability) | public |
| `GET /api/properties/:id` | `property:view` |
| `POST` / `PUT` / `DELETE /api/properties[/:id]` | `property:manage` (asset+) |

## Compliance anchors

`has_mortgage` → CARES Act notice forcing in [eviction](eviction.md);
compliance-period dates → LIHTC good-cause blocking; BIN layer → §42 reporting.

## Flags & env

`ONESITE_API_URL/KEY`, `LOFT_API_URL/KEY` (stub adapters).

## Current state

**Live** CRUD + availability. Gaps: photo pipeline missing; properties seeded from
GPMG fixtures (no live Nevada Housing Agency refresh yet).

## Key files

`src/modules/properties/{routes,service}.ts`, schema sections for
properties/buildings/units in `src/db/schema.ts`.
