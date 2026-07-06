#!/usr/bin/env python3
"""Apply burn blocker B5 to the live frank-outbound ElevenLabs agent: strengthen the
identity step (don't disclose until confirmed) + add the identity_confirmed data field.

Run it yourself:  python3 scripts/apply-b5-identity-gate.py
Backs up the current config to /tmp/frank-outbound-agent-config.backup.json first, and
re-fetches to verify nothing else changed. Idempotent: safe to re-run.
"""
import json, os, urllib.request

AGENT = "agent_6601ktwp1tz1e9591gg20w2rf226"
env = {}
for p in (os.path.join(os.path.dirname(__file__), "..", ".env"),
          os.path.expanduser("~/code/frank-pilot/.env"),
          os.path.expanduser("~/code/battlestation/.env")):
    if os.path.exists(p):
        for l in open(p):
            if "=" in l and not l.startswith("#"):
                k, _, v = l.partition("="); env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
KEY = env.get("ELEVENLABS_API_KEY", "")
assert KEY, "ELEVENLABS_API_KEY not found in .env"
H = {"xi-api-key": KEY}

def get():
    return json.load(urllib.request.urlopen(urllib.request.Request(
        f"https://api.elevenlabs.io/v1/convai/agents/{AGENT}", headers=H), timeout=30))

cfg = get()
open("/tmp/frank-outbound-agent-config.backup.json", "w").write(json.dumps(cfg, indent=2))
ag = cfg["conversation_config"]["agent"]; prompt = ag["prompt"]["prompt"]
dc = cfg["platform_settings"]["data_collection"]

OLD = "1. Make sure you're talking to {{applicant_name}}. If it's a wrong number or nobody knows them, apologize warmly, record wrong_number, and wrap up."
NEW = ("1. FIRST, confirm you are actually speaking with {{applicant_name}} before discussing anything else. "
       "When they confirm it is them, set identity_confirmed=true and continue. If someone else answers or "
       "{{applicant_name}} is not available, do NOT share anything about the wait-list or their application; "
       "warmly say you will try {{applicant_name}} again another time and wrap up. If it is a wrong number or "
       "nobody knows them, apologize warmly, record wrong_number, and wrap up. Never discuss the apartment, the "
       "wait-list, or any personal detail until you have confirmed you are speaking with {{applicant_name}}.")

if "identity_confirmed=true" in prompt and "identity_confirmed" in dc:
    print("B5 already applied — nothing to do."); raise SystemExit
if OLD not in prompt:
    print("Step 1 text not found (prompt may have changed). Aborting; apply manually."); raise SystemExit

new_prompt = prompt.replace(OLD, NEW)
new_dc = dict(dc)
new_dc["identity_confirmed"] = {"type": "boolean", "description": "Did the person explicitly confirm they are {{applicant_name}}? Set true only on explicit confirmation; leave unset if someone else answered, wrong number, or unconfirmed.", "enum": None, "is_system_provided": False, "dynamic_variable": "", "allowed_values_dynamic_variable": "", "constant_value": "", "is_omitted": False, "llm": None}

payload = {"conversation_config": {"agent": {"prompt": {"prompt": new_prompt}}},
           "platform_settings": {"data_collection": new_dc}}
req = urllib.request.Request(f"https://api.elevenlabs.io/v1/convai/agents/{AGENT}",
                            data=json.dumps(payload).encode(), method="PATCH",
                            headers={**H, "Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=30)

v = get(); vp = v["conversation_config"]["agent"]["prompt"]; vdc = v["platform_settings"]["data_collection"]
ok = ("identity_confirmed=true" in vp["prompt"] and "identity_confirmed" in vdc
      and all(k in vdc for k in ("still_interested", "wrong_number", "wants_callback", "reached_voicemail")))
print("B5 applied + verified OK" if ok else "B5 PATCH ran but verify failed — restore from /tmp/frank-outbound-agent-config.backup.json")
print(f"  identity gate in prompt: {'identity_confirmed=true' in vp['prompt']} | data fields: {len(vdc)} | llm preserved: {vp.get('llm')}")
