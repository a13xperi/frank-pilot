#!/usr/bin/env python3
"""
runner.py — Thin runner for the Frank-Pilot housing Q&A agent.

Pipeline:
  1. Take a question (CLI arg or stdin).
  2. retriever.build_context(question) -> grounded context payload.
  3. Load system_prompt.md, inject the context JSON at {{CONTEXT_JSON}}.
  4. Send (system, user=question) through the model via call_model().

Model backend is PLUGGABLE (see call_model below). Defaults to shelling out to
`claude -p` (the OpenClaw / headless Claude CLI) if it's on PATH. With
--dry-run, it makes NO network calls and just prints the fully assembled prompt.

Usage:
  python3 runner.py "What documents do I need to apply?"
  python3 runner.py --dry-run "Tell me about Owens Senior Housing"
  echo "How much is the application fee?" | python3 runner.py
  python3 runner.py --context-only "senior housing in Henderson"   # dump payload

Pure stdlib. No pip deps.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _THIS_DIR)

import retriever  # noqa: E402

_SYSTEM_PROMPT_PATH = os.path.join(_THIS_DIR, "system_prompt.md")
_CONTEXT_PLACEHOLDER = "{{CONTEXT_JSON}}"

# Which CLI to shell out to for the live backend. `claude -p <prompt>` runs
# headless. This is the OpenClaw shim integration point (see README).
_DEFAULT_CLI = os.environ.get("HOUSING_QA_CLI", "claude")


# --------------------------------------------------------------------------- #
# Prompt assembly
# --------------------------------------------------------------------------- #
def load_system_prompt():
    with open(_SYSTEM_PROMPT_PATH, "r") as f:
        return f.read()


def assemble_prompt(question):
    """Return (system_text, user_text, context_payload)."""
    ctx = retriever.build_context(question)
    ctx_json = json.dumps(ctx, indent=2, ensure_ascii=False)
    system_text = load_system_prompt().replace(_CONTEXT_PLACEHOLDER, ctx_json)
    return system_text, question, ctx


# --------------------------------------------------------------------------- #
# Model backend — PLUGGABLE INTEGRATION POINT
# --------------------------------------------------------------------------- #
def call_model(system, user):
    """
    Send the prompt to the model and return the text response.

    >>> INTEGRATION POINT <<<
    Default implementation shells out to the headless Claude CLI:
        claude -p "<combined prompt>"
    (the OpenClaw `claude_cli_proxy.py`-style shim, if configured, intercepts
    this same `claude` invocation transparently).

    To wire a different backend (Anthropic SDK, OpenClaw HTTP endpoint, a local
    model, etc.), replace the body of this function. The contract is simply:
        def call_model(system: str, user: str) -> str

    NOTE: this runner PRE-INJECTS context into the system prompt. It does not
    rely on tool-calling, because the current OpenClaw shim drops the OpenAI
    `tools` array (see README). Pre-injection is the supported path today.
    """
    cli = shutil.which(_DEFAULT_CLI)
    if not cli:
        return (
            f"[no model backend] '{_DEFAULT_CLI}' not found on PATH.\n"
            f"Re-run with --dry-run to inspect the assembled prompt, or wire a "
            f"backend in runner.call_model()."
        )

    # `claude -p` takes a single prompt string. Some shims separate system vs
    # user; here we concatenate with a clear delimiter so the system prompt is
    # honored even by a plain headless invocation.
    combined = f"{system}\n\n=== USER QUESTION ===\n{user}\n"
    try:
        proc = subprocess.run(
            [cli, "-p", combined],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except Exception as e:  # noqa: BLE001
        return f"[backend error] {type(e).__name__}: {e}"
    if proc.returncode != 0:
        return f"[backend exit {proc.returncode}] {proc.stderr.strip() or proc.stdout.strip()}"
    return proc.stdout.strip()


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _read_question(args):
    if args.question:
        return " ".join(args.question).strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ""


def main():
    ap = argparse.ArgumentParser(
        description="Frank-Pilot housing Q&A runner (grounded, pluggable backend)."
    )
    ap.add_argument("question", nargs="*", help="The question (or pipe via stdin).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the assembled prompt; make NO model/network call.")
    ap.add_argument("--context-only", action="store_true",
                    help="Print only the retrieved context payload (JSON) and exit.")
    args = ap.parse_args()

    question = _read_question(args)
    if not question:
        ap.error("No question provided (pass as arg or via stdin).")

    system_text, user_text, ctx = assemble_prompt(question)

    if args.context_only:
        print(json.dumps(ctx, indent=2, ensure_ascii=False))
        return

    if args.dry_run:
        print("=" * 78)
        print("DRY RUN — assembled prompt (no model call, no network)")
        print("=" * 78)
        print(f"ROUTING: {ctx['routing']}  |  propertyMode: {ctx['propertyMode']}  "
              f"|  properties: {len(ctx['properties'])}  "
              f"|  faq: {[s['id'] for s in ctx['faqSections']]}")
        if ctx["notes"]:
            print("RETRIEVAL NOTES:")
            for n in ctx["notes"]:
                print(f"  - {n}")
        print("\n----- SYSTEM PROMPT (with injected context) -----\n")
        print(system_text)
        print("\n----- USER -----\n")
        print(user_text)
        print("\n" + "=" * 78)
        print("End dry run.")
        return

    answer = call_model(system_text, user_text)
    print(answer)


if __name__ == "__main__":
    main()
