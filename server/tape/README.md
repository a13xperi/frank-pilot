# BP-03b Compliance Tape — Stub Ledger

Placeholder NDJSON ledger for the five HUD-cited stamps wired by BP-03b.

**This is a stub.** Canonical BP-02 has not landed yet. When it does:
1. Replace `src/modules/tape/index.ts` `stampTape` with the real BP-02 helper.
2. Migrate historical entries from `bp03b.ndjson` into the canonical store.
3. Delete this directory + the gitignore entry.

## Format
One JSON object per line:
```json
{"timestamp":"2026-05-20T12:34:56.000Z","kind":"HUD_928_1_FAIR_HOUSING_POSTED","citation":"24 CFR Part 110","actor":null,"payload":{"property_slug":"donna-louise-2"},"session_id":"abc12345"}
```

## Stamps wired by BP-03b

| Stamp kind                          | Citation                   | Touchpoint                                    |
|-------------------------------------|----------------------------|-----------------------------------------------|
| WELCOME_LETTER_DELIVERED            | HUD 4350.3 Ch. 4-4         | POST /api/tape/welcome-accept (Lane B beacon) |
| HUD_928_1_FAIR_HOUSING_POSTED       | 24 CFR Part 110            | POST /api/tape/welcome-view  (Lane B beacon)  |
| WAITING_LIST_APP_CAPTURED           | HUD 4350.3 Ch. 4-6         | POST /api/applicants/intent (success)         |
| HUD_92006_SUPPLEMENT_CAPTURED       | HUD-92006                  | POST /api/applicants/apply  (success)         |
| POSITION_LETTER_SENT                | HUD 4350.3 Ch. 4-14 + 4-16 | POST /api/applicants/claim-unit/:id (success) |

Override the ledger location via `TAPE_LEDGER_PATH` env var (used in tests).
