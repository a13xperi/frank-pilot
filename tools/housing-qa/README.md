# Frank-Pilot Housing Q&A Agent (`tools/housing-qa/`)

A grounded, citation-first Q&A agent for the Frank-Pilot CDPC affordable-housing
platform. It answers applicant questions about properties, eligibility, fees, and
the application flow — strictly from real data and product copy, never from
general knowledge.

Self-contained, pure stdlib (`json`, `re`, `difflib`). No pip dependencies, no
network calls in dry-run.

## Files

| File | Role |
|------|------|
| `retriever.py` | Loads both datasets, builds the normalized merged index, classifies the question, and emits the grounded context payload. |
| `faq.md` | The 10-section FAQ with stable anchors (`#fees`, `#documents`, …). The retriever keyword-matches sections; the agent cites them. |
| `system_prompt.md` | System prompt: grounding + refusal + fair-housing guardrails, citation format, and a `{{CONTEXT_JSON}}` injection point. |
| `runner.py` | Thin runner: question → context → assembled prompt → model. Pluggable backend; `--dry-run` makes no calls. |
| `examples.md` | 10 worked Q&A pairs (data lookups, process, 3 refusals) with citations. |
| `README.md` | This file. |

## How it works

1. **Datasets** (read at repo-relative paths):
   - Base: `client-tenant/public/nv-housing-props.json` — 335 statewide HUD-LIHTC
     properties (this copy has enriched `amiTiers`, 254/335). Falls back to
     `src/db/data/nv-housing-props.json`.
   - Availability: `docs/intel/gpmglv-properties-extracted.json` — 17 GPMG
     "available-now" properties under the `properties` key.
2. **Merge:** each statewide record is normalized to the locked contract shape.
   Each of the 17 GPMG records is matched to a statewide record by normalized-name
   token overlap (+ proximity/city tiebreak); on match it enriches that record and
   flips `availability.status="available_now"`. Unmatched GPMG records are added
   standalone. Statewide-only records keep null contact/rent/amenities.
3. **Classify + route** (`classify`): `named_property` → 1 full object;
   `city` / `attribute` → up to K=8 compact summaries; `process` → no property
   objects, FAQ sections only.
4. **Assemble payload:** matched property object(s) + keyword-matched FAQ
   section(s) + always-on facts (fee, 120-day rule, document checklist) + retrieval
   `notes` (including refusal flags for statewide-only or unknown properties).

## Run it

```bash
# Smoke-test the retriever (5 sample questions, one per routing branch):
python3 tools/housing-qa/retriever.py

# Dry run — assemble + print the full prompt, NO model call, NO network:
python3 tools/housing-qa/runner.py --dry-run "What documents do I need to apply?"

# Inspect just the retrieved context payload:
python3 tools/housing-qa/runner.py --context-only "senior housing in Henderson"

# Live answer (requires a model backend on PATH; see below):
python3 tools/housing-qa/runner.py "Tell me about Owens Senior Housing"
echo "How much is the application fee?" | python3 tools/housing-qa/runner.py
```

## Wiring into the token engine

The model call is isolated in **`runner.call_model(system, user)`** — the single
integration point. By default it shells out to the headless Claude CLI:

```
claude -p "<system prompt with injected context>\n\n=== USER QUESTION ===\n<question>"
```

This is the OpenClaw path: a `claude_cli_proxy.py`-style shim, if installed,
transparently intercepts the same `claude` invocation. Override the binary with
`HOUSING_QA_CLI=<cmd>`. To use a different backend (Anthropic SDK, an OpenClaw
HTTP endpoint, a local model), replace the body of `call_model` — the contract is
just `call_model(system: str, user: str) -> str`.

If no backend is found, `call_model` returns a clear message and suggests
`--dry-run`. Dry-run never touches the network.

## NOTE — upgrading to live tool-calling

Today the agent uses **pre-injected context**: the runner calls the retriever
*before* the model and bakes the results into the system prompt. This is
deliberate.

A more flexible design would let the model call the retriever as a **tool**
mid-conversation (so it can ask follow-ups, e.g. "now filter those by 1BR"). That
requires the LLM call to forward an OpenAI-style `tools` array to the model.

**The current OpenClaw shim does NOT support this.** `claude_cli_proxy.py`
silently drops the `tools` array — only the inner `claude -p` runs, and any tool
definitions are discarded. So tool-calling would be a no-op until the shim is
rebuilt to forward `tools`. Until then, **pre-injected context is the only
working path**, which is exactly what this runner implements.

## Data caveats baked into the agent

These came from inspecting the real data — the FAQ and refusal examples account
for each:

- **Rent is never disclosed** (`rent.disclosed=false` for all 17 GPMG records and
  absent statewide). The agent always refuses rent and cites the caveat.
- **`available_units_count` is null for all 17** GPMG properties — "available now"
  is a status, not a count.
- **`ami_disclosed` is false for all 17 GPMG** records (no `ami_text`); AMI tiers
  come only from the statewide base (254/335 populated; the rest are null).
- **Pet policy is null for all 17.** **Email present for only 2 of 17**;
  **application_url null for all 17** (waitlist_url present for all 17).
- **Bedroom/unit-type data exists only for the 17 available-now** properties; the
  335 statewide records have no bedroom-level data.
- **Statewide-only properties have no contact, amenities, accessibility, office
  hours, or availability count** — only name, city, address, unit totals, type,
  AMI tiers, funding. The agent refuses those fields and points to /discover.
