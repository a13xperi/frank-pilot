"""Minimal Notion REST client for the GPMG NV Parcels sync — stdlib only (urllib).

Mirrors the pattern proven in `the-stack/status/notion.py`: talks the 2025-09-03
data_source-native API (the surface the interactive MCP used to build this DB).
The auth token is read from this dir's `.env` first (loaded by sync.py), then
falls back to NOTION_TOKEN already in the shell environment — so the token never
has to be written to disk to run interactively. The token value is NEVER logged.

The integration whose token this is MUST be connected to the "GPMG NV Parcels"
page/DB in Notion, or every call 404s. See README.

Endpoints used:
  POST /v1/data_sources/{ds}/query   — page through every row (no filter)
  PATCH /v1/pages/{page_id}          — patch a row's auto properties
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

API = "https://api.notion.com/v1"
VERSION = os.environ.get("NOTION_VERSION", "2025-09-03")


class NotionError(RuntimeError):
    pass


def _token() -> str:
    tok = os.environ.get("NOTION_TOKEN", "").strip()
    if not tok:
        raise NotionError(
            "NOTION_TOKEN not set. Add it to docs/intel/notion-sync/.env or export "
            "it. The integration must also be connected to the 'GPMG NV Parcels' "
            "page in Notion — see README.")
    return tok


def _req(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {_token()}")
    req.add_header("Notion-Version", VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        # never echo the token; only the API's own error payload
        raise NotionError(f"{method} {path} -> HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise NotionError(f"{method} {path} -> network error: {e.reason}") from None


# ---- property builders (standard Notion property objects) --------------------

def rich_text(text: str) -> dict:
    return {"rich_text": [{"text": {"content": text}}]} if text else {"rich_text": []}


def select(name: str | None) -> dict:
    return {"select": {"name": name} if name else None}


def number(n) -> dict:
    return {"number": n}


def date(iso: str | None) -> dict:
    return {"date": {"start": iso} if iso else None}


# ---- read helpers (tolerant of None / empty) ---------------------------------

def _first_plain(items: list) -> str:
    for it in items or []:
        t = it.get("plain_text") or it.get("text", {}).get("content")
        if t:
            return t
    return ""


def prop_text(page: dict, name: str) -> str:
    p = page.get("properties", {}).get(name, {})
    if "rich_text" in p:
        return _first_plain(p["rich_text"])
    if "title" in p:
        return _first_plain(p["title"])
    return ""


def prop_select(page: dict, name: str) -> str | None:
    sel = page.get("properties", {}).get(name, {}).get("select")
    return sel.get("name") if sel else None


def prop_number(page: dict, name: str):
    return page.get("properties", {}).get(name, {}).get("number")


# ---- operations --------------------------------------------------------------

def query_all(ds_id: str) -> list:
    """Return every row page in the data source (pages through has_more)."""
    rows, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        res = _req("POST", f"/data_sources/{ds_id}/query", body)
        rows.extend(res.get("results", []))
        if not res.get("has_more"):
            return rows
        cursor = res.get("next_cursor")


def patch_row(page_id: str, props: dict) -> dict:
    return _req("PATCH", f"/pages/{page_id}", {"properties": props})
