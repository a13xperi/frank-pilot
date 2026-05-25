#!/usr/bin/env python3
"""
retriever.py — Grounded retrieval for the frank-pilot CDPC housing Q&A agent.

Loads two datasets, builds a normalized merged index per the LOCKED grounding
contract, and assembles a compact context payload for any question string.

Datasets (relative to repo root):
  1. STATEWIDE HUD-LIHTC base : client-tenant/public/nv-housing-props.json (335 records,
     enriched amiTiers 254/335). Falls back to src/db/data/nv-housing-props.json.
  2. AVAILABLE-NOW (GPMG)     : docs/intel/gpmglv-properties-extracted.json
     (dict; property list under "properties", 17 records).

Pure stdlib only (json, re, difflib). No pip deps. No network.

Context payload assembled per question =
  (a) matched property object(s)        -> full (named) or compact (city/attribute)
  (b) keyword-matched FAQ section(s)    -> ids + titles + anchors from faq.md
  (c) always-on facts block             -> fee, 120-day rule, document checklist

Routing branches:
  - named property      -> fuzzy match name/aka/slug -> 1 FULL normalized object
  - city/area           -> filter by city            -> COMPACT summaries, cap K=8
  - attribute filter    -> filter index (BR/senior|family/AMI tier/available now)
                                                     -> COMPACT summaries, cap K=8
  - process/eligibility -> NO property objects; FAQ sections only
"""

import json
import os
import re
import difflib

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))

_STATEWIDE_PRIMARY = os.path.join(_REPO_ROOT, "client-tenant", "public", "nv-housing-props.json")
_STATEWIDE_FALLBACK = os.path.join(_REPO_ROOT, "src", "db", "data", "nv-housing-props.json")
_GPMG_PATH = os.path.join(_REPO_ROOT, "docs", "intel", "gpmglv-properties-extracted.json")
_FAQ_PATH = os.path.join(_THIS_DIR, "faq.md")

K_COMPACT = 8  # cap on compact summaries injected

# --------------------------------------------------------------------------- #
# Normalization helpers
# --------------------------------------------------------------------------- #
_STOPWORDS = {
    "apartments", "apartment", "apts", "apt", "community", "communities",
    "senior", "family", "the", "at", "of", "housing", "homes", "home",
    "village", "court", "courts", "place", "gardens", "garden",
}


def _norm_name(s):
    """Lowercase, strip punctuation, collapse whitespace. Keeps stopwords."""
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _name_tokens(s):
    """Significant tokens (stopwords removed) for overlap scoring."""
    return {t for t in _norm_name(s).split() if t and t not in _STOPWORDS}


def _slug_to_name(slug):
    return _norm_name(slug.replace("-", " ")) if slug else ""


def _haversine_km(a_lat, a_lng, b_lat, b_lng):
    import math
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlmb = math.radians(b_lng - a_lng)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
def _load_statewide():
    path = _STATEWIDE_PRIMARY if os.path.exists(_STATEWIDE_PRIMARY) else _STATEWIDE_FALLBACK
    with open(path, "r") as f:
        return json.load(f), path


def _load_gpmg():
    if not os.path.exists(_GPMG_PATH):
        return [], None
    with open(_GPMG_PATH, "r") as f:
        d = json.load(f)
    props = d.get("properties", []) if isinstance(d, dict) else d
    snapshot = d.get("source_snapshot") if isinstance(d, dict) else None
    return props, snapshot


# --------------------------------------------------------------------------- #
# Normalized index construction (LOCKED contract shape)
# --------------------------------------------------------------------------- #
def _blank_normalized(rec):
    """Build a statewide-only normalized object from a HUD-LIHTC record."""
    return {
        "id": _norm_name(rec.get("name", "")).replace(" ", "-") or "unknown",
        "name": rec.get("name") or None,
        "city": rec.get("city") or None,
        "address": rec.get("address") or None,
        "type": rec.get("type") or None,
        "totalUnits": rec.get("totalUnits"),
        "restrictedUnits": rec.get("restrictedUnits"),
        "amiTiers": rec.get("amiTiers") if rec.get("amiTiers") else None,
        "funding": rec.get("funding") or None,
        "availability": {
            "status": "statewide_only",
            "availableUnitsCount": None,
            "asOf": None,
        },
        "rent": {"disclosed": False, "text": None},
        "contact": {
            "phone": None, "email": None, "officeHours": None,
            "waitlistUrl": None, "applicationUrl": None,
        },
        "amenities": None,
        "accessibility": None,
        "petPolicy": None,
        "unitTypes": None,
        "_source": {"base": "HUD-LIHTC statewide", "availability": None},
        # internal-only (not part of emitted shape; stripped before injection)
        "_lat": rec.get("lat"),
        "_lng": rec.get("lng"),
        "_aka": rec.get("aka") or "",
    }


def _gpmg_to_normalized(g, snapshot):
    """Build a normalized object for an unmatched-but-available GPMG record."""
    addr = g.get("address") or {}
    parts = [addr.get("line1"), addr.get("city"), addr.get("state"), addr.get("zip")]
    address = ", ".join([p for p in parts if p]) or None
    accessibility = g.get("accessibility")
    if isinstance(accessibility, list):
        accessibility = "; ".join(accessibility) if accessibility else None
    return {
        "id": g.get("slug") or _norm_name(g.get("name", "")).replace(" ", "-"),
        "name": g.get("name") or None,
        "city": addr.get("city") or None,
        "address": address,
        "type": g.get("property_type") or None,
        "totalUnits": None,
        "restrictedUnits": None,
        "amiTiers": None,
        "funding": None,
        "availability": {
            "status": "available_now",
            "availableUnitsCount": g.get("available_units_count"),
            "asOf": snapshot,
        },
        "rent": {
            "disclosed": bool(g.get("rent_disclosed")),
            "text": g.get("rent_text"),
        },
        "contact": {
            "phone": g.get("phone"),
            "email": g.get("email") or g.get("manager_email"),
            "officeHours": g.get("office_hours"),
            "waitlistUrl": g.get("waitlist_url"),
            "applicationUrl": g.get("application_url"),
        },
        "amenities": g.get("amenities") or None,
        "accessibility": accessibility,
        "petPolicy": g.get("pet_policy"),
        "unitTypes": g.get("unit_types") or None,
        "_source": {"base": "HUD-LIHTC statewide", "availability": f"GPMG {snapshot}" if snapshot else "GPMG"},
        "_lat": None,
        "_lng": None,
        "_aka": "",
    }


def _enrich_with_gpmg(norm, g, snapshot):
    """Overlay GPMG fields onto a matched statewide record + flip availability."""
    addr = g.get("address") or {}
    accessibility = g.get("accessibility")
    if isinstance(accessibility, list):
        accessibility = "; ".join(accessibility) if accessibility else None

    norm["availability"] = {
        "status": "available_now",
        "availableUnitsCount": g.get("available_units_count"),
        "asOf": snapshot,
    }
    norm["rent"] = {
        "disclosed": bool(g.get("rent_disclosed")),
        "text": g.get("rent_text"),
    }
    norm["contact"] = {
        "phone": g.get("phone"),
        "email": g.get("email") or g.get("manager_email"),
        "officeHours": g.get("office_hours"),
        "waitlistUrl": g.get("waitlist_url"),
        "applicationUrl": g.get("application_url"),
    }
    norm["amenities"] = g.get("amenities") or None
    norm["accessibility"] = accessibility
    norm["petPolicy"] = g.get("pet_policy")
    norm["unitTypes"] = g.get("unit_types") or None
    # type: prefer the statewide canonical type if present, else GPMG
    if not norm.get("type"):
        norm["type"] = g.get("property_type") or None
    norm["_source"]["availability"] = f"GPMG {snapshot}" if snapshot else "GPMG"
    return norm


def _match_gpmg_to_statewide(g, statewide_norms):
    """
    Match a GPMG record to a statewide normalized record.
    Strategy: token overlap on significant name tokens; tie-break by proximity
    when both have coords. Returns the best statewide norm or None.
    """
    g_name = g.get("name") or _slug_to_name(g.get("slug", ""))
    g_tokens = _name_tokens(g_name)
    g_full = _norm_name(g_name)
    addr = g.get("address") or {}
    g_city = _norm_name(addr.get("city", ""))

    best = None
    best_score = 0.0
    for s in statewide_norms:
        s_name = s.get("name") or ""
        s_tokens = _name_tokens(s_name) | _name_tokens(s.get("_aka", ""))
        if not g_tokens or not s_tokens:
            # fall back to full-string ratio
            ratio = difflib.SequenceMatcher(None, g_full, _norm_name(s_name)).ratio()
            score = ratio
        else:
            overlap = len(g_tokens & s_tokens) / len(g_tokens | s_tokens)
            ratio = difflib.SequenceMatcher(None, g_full, _norm_name(s_name)).ratio()
            score = 0.7 * overlap + 0.3 * ratio
        # require same city if both known (avoids cross-city name collisions)
        if g_city and s.get("city") and _norm_name(s["city"]) != g_city:
            score *= 0.5
        if score > best_score:
            best_score, best = score, s
    # threshold: meaningful name overlap
    if best is not None and best_score >= 0.45:
        return best
    return None


class HousingIndex:
    """Builds and holds the normalized merged index + name lookup tables."""

    def __init__(self):
        statewide_raw, self._statewide_path = _load_statewide()
        gpmg_raw, self._gpmg_snapshot = _load_gpmg()

        # 1. Build statewide normalized records
        self.records = [_blank_normalized(r) for r in statewide_raw]

        # 2. Match each GPMG record -> enrich, or include as standalone available
        matched_ids = set()
        for g in gpmg_raw:
            target = _match_gpmg_to_statewide(g, self.records)
            if target is not None and id(target) not in matched_ids:
                _enrich_with_gpmg(target, g, self._gpmg_snapshot)
                matched_ids.add(id(target))
            else:
                # unmatched-but-available -> include as its own record
                self.records.append(_gpmg_to_normalized(g, self._gpmg_snapshot))

        # 3. Lookup helpers
        self._by_norm_name = {}
        for r in self.records:
            self._by_norm_name.setdefault(_norm_name(r.get("name", "")), r)

        self.gpmg_count = len(gpmg_raw)
        self.statewide_count = len(statewide_raw)
        self.available_now_count = sum(
            1 for r in self.records if r["availability"]["status"] == "available_now"
        )

    # ----------------------------------------------------------------- #
    # Matching primitives
    # ----------------------------------------------------------------- #
    def fuzzy_property(self, query):
        """Return best single normalized record matching a property name, or None."""
        q_full = _norm_name(query)
        q_tokens = _name_tokens(query)
        best, best_score = None, 0.0
        for r in self.records:
            cand_names = [r.get("name") or "", r.get("_aka") or "", r.get("id") or ""]
            local_best = 0.0
            for cand in cand_names:
                c_full = _norm_name(cand.replace("-", " "))
                if not c_full:
                    continue
                ratio = difflib.SequenceMatcher(None, q_full, c_full).ratio()
                c_tokens = _name_tokens(cand.replace("-", " "))
                overlap = (len(q_tokens & c_tokens) / len(q_tokens | c_tokens)) if (q_tokens and c_tokens) else 0.0
                # reward substring containment of the query in the candidate
                contains = 1.0 if (q_full and q_full in c_full) else 0.0
                score = max(ratio, 0.6 * overlap + 0.4 * ratio, contains * 0.95)
                local_best = max(local_best, score)
            if local_best > best_score:
                best_score, best = local_best, r
        if best is not None and best_score >= 0.6:
            return best, best_score
        return None, best_score

    def by_city(self, city):
        c = _norm_name(city)
        return [r for r in self.records if _norm_name(r.get("city", "")) == c]

    def all_cities(self):
        return sorted({r.get("city") for r in self.records if r.get("city")})

    def filter_attributes(self, *, ptype=None, ami_tier=None, available_now=False,
                          bedrooms=None, city=None):
        out = []
        cnorm = _norm_name(city) if city else None
        for r in self.records:
            if cnorm and _norm_name(r.get("city", "")) != cnorm:
                continue
            if ptype:
                rt = _norm_name(r.get("type", ""))
                if _norm_name(ptype) not in rt:
                    continue
            if ami_tier:
                tiers = r.get("amiTiers") or []
                norm_tiers = {t.replace("%", "").strip() for t in tiers}
                if ami_tier.replace("%", "").strip() not in norm_tiers:
                    continue
            if available_now and r["availability"]["status"] != "available_now":
                continue
            if bedrooms:
                ut = r.get("unitTypes") or []
                joined = " ".join(ut).lower()
                if bedrooms.lower() not in joined:
                    continue
            out.append(r)
        return out


# --------------------------------------------------------------------------- #
# FAQ section index (parsed from faq.md anchors)
# --------------------------------------------------------------------------- #
# Stable section ids -> (title, keyword triggers). Mirrors faq.md anchors.
FAQ_SECTIONS = [
    ("who-its-for", "Who affordable housing is for / AMI tiers",
     ["who", "qualify", "eligib", "ami", "income", "area median", "tier", "low income", "afford"]),
    ("application-steps", "The application steps",
     ["step", "how do i apply", "how to apply", "process", "register", "verify",
      "magic link", "intent", "pick", "review", "confirm", "claim", "stages", "apply"]),
    ("documents", "Documents you'll need",
     ["document", "paperwork", "id", "pay stub", "paystub", "proof of income",
      "ssn", "itin", "reference", "landlord", "bring", "need to apply", "upload"]),
    ("fees", "Fees",
     ["fee", "cost", "pay", "price", "charge", "35", "$35", "refund", "non-refund", "money"]),
    ("waitlists", "Waitlists & queue position + 120-day rule",
     ["waitlist", "queue", "position", "120", "spot", "wait", "how long", "active"]),
    ("finding-a-unit", "Finding a unit (available-now vs statewide; search by BR/budget/move-in)",
     ["find", "available", "search", "unit", "bedroom", "br", "budget", "move-in",
      "move in", "vacancy", "open", "now", "list", "show me"]),
    ("after-you-apply", "After you apply (PM review, recertification, next steps)",
     ["after", "next", "review", "property manager", "pm", "recertif", "recert",
      "lease", "docusign", "sign", "approved", "decision", "140%", "what happens"]),
    ("rent-availability-caveat", "Rent & availability caveat",
     ["rent", "how much", "monthly", "price", "availability", "still available", "current"]),
    ("accessibility", "Accessibility / senior / ADA",
     ["accessib", "ada", "senior", "elder", "disab", "wheelchair", "elevator", "55", "62"]),
    ("contact", "Contacting a property / getting help",
     ["contact", "phone", "call", "email", "reach", "office hours", "help",
      "talk to", "speak", "manager", "get in touch"]),
]


def _match_faq_sections(question, cap=3):
    q = question.lower()
    scored = []
    for sid, title, kws in FAQ_SECTIONS:
        hits = sum(1 for kw in kws if kw in q)
        if hits:
            scored.append((hits, sid, title))
    scored.sort(reverse=True)
    return [{"id": s[1], "title": s[2], "anchor": f"faq.md#{s[1]}"} for s in scored[:cap]]


# --------------------------------------------------------------------------- #
# Always-on facts block (grounded in apply.json copy)
# --------------------------------------------------------------------------- #
ALWAYS_ON_FACTS = {
    "applicationFee": {
        "amount": "$35.95",
        "per": "per adult 18+",
        "refundable": False,
        "note": "Non-refundable. Locks your spot on the waitlist. Covers credit and background checks.",
        "source": "apply.json checklist.fee / household.disclaimer",
    },
    "rule120": {
        "days": 120,
        "note": "Your application stays active for 120 days. If you can't be housed in that window, you're invited to refresh and continue.",
        "source": "apply.json checklist.rule120",
    },
    "documentsNeeded": [
        "Government-issued photo ID",
        "Proof of income (last 2 pay stubs or offer letter)",
        "Social Security Number or ITIN",
        "Two prior landlord references (last 3 years)",
        "Household composition (everyone moving in)",
    ],
    "documentsNote": "Upload your documents (5 files, < 120 days old).",
    "documentsSource": "apply.json checklist.items / confirm.nextSteps",
}


# --------------------------------------------------------------------------- #
# Question classification + routing
# --------------------------------------------------------------------------- #
_AMI_RE = re.compile(r"(\d{2,3})\s*%")
_BR_RE = re.compile(r"\b(studio|\d\s*br|\d\s*bed(room)?s?|\d-bed)\b", re.I)


def _detect_ami_tier(q):
    m = _AMI_RE.search(q)
    return f"{m.group(1)}%" if m else None


def _detect_bedrooms(q):
    ql = q.lower()
    if "studio" in ql:
        return "studio"
    m = re.search(r"\b(\d)\s*(?:br|bed)", ql)
    if m:
        return f"{m.group(1)}br"
    return None


def _detect_type(q):
    ql = q.lower()
    if re.search(r"\bsenior(s)?\b|\belder|\b55\+|\b62\+", ql):
        return "senior"
    if re.search(r"\bfamily\b|\bfamilies\b", ql):
        return "family"
    return None


def _wants_available_now(q):
    ql = q.lower()
    return bool(re.search(r"available\s*now|available today|right now|currently available|"
                          r"open now|move in now|vacan", ql))


def _strip_internal(rec):
    """Remove internal-only keys (_lat/_lng/_aka) from emitted objects."""
    return {k: v for k, v in rec.items() if not k.startswith("_") or k == "_source"}


def _compact(rec):
    """Compact summary shape for city/attribute results."""
    return {
        "name": rec.get("name"),
        "city": rec.get("city"),
        "availability": rec["availability"]["status"],
        "amiTiers": rec.get("amiTiers"),
        "type": rec.get("type"),
    }


_PROCESS_HINTS = (
    "document", "fee", "cost", "apply", "application", "qualify", "eligib",
    "waitlist", "queue", "income", "ami", "rent", "how", "what", "when",
    "where", "who", "need", "step", "recertif", "help", "contact", "available",
)


def _extract_property_phrase(q):
    """
    Strip leading question/preposition lead-ins ('tell me about', 'what is the
    pet policy at', 'do you have', ...) to isolate a candidate property-name
    phrase. Returns the phrase (may be the whole question if nothing stripped).
    """
    s = q.strip().rstrip("?.!")
    # progressively strip known lead-in patterns
    patterns = [
        r"^(?:can you )?tell me (?:about|more about)\s+",
        r"^(?:what(?:'s| is| are)?)\s+(?:the\s+)?(?:[\w\s/-]+?)\s+(?:at|for|of)\s+",
        r"^(?:do|does)\s+(?:you|they)\s+(?:have|offer|allow)\s+",
        r"^(?:what about|how about|info on|information (?:about|on)|details (?:about|on))\s+",
        r"^(?:is|are)\s+(?:there\s+)?",
        r"^(?:i(?:'m| am)?\s+(?:looking|interested)\s+(?:for|in)\s+)",
    ]
    for p in patterns:
        new = re.sub(p, "", s, flags=re.I)
        if new != s:
            s = new.strip()
            break
    # trailing "at/in <city>" — drop it so the name stands alone
    return s.strip()


def _looks_like_unknown_property(q, prop, score):
    """
    Heuristic: the question likely names a property we don't have if it contains
    a proper-noun-ish phrase ('about X', 'X Apartments') and no decent match.
    Returns the suspected property name or None.
    """
    if prop is not None and score >= 0.6:
        return None
    ql = q.lower()
    # explicit ask-about pattern
    m = re.search(r"\b(?:about|at|for|regarding|tell me about)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,4})", q)
    if m:
        return m.group(1).strip()
    # "<Name> Apartments/Towers/Village..." pattern
    m = re.search(r"\b([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3}\s+"
                  r"(?:Apartments?|Apts?|Towers?|Village|Court|Place|Community|Homes?))\b", q)
    if m:
        return m.group(1).strip()
    return None


def classify(question, index=None):
    """
    Classify a question into one of:
      'named_property' | 'city' | 'attribute' | 'process'
    Returns (branch, detail_dict).
    """
    index = index or _shared_index()
    q = question.strip()
    ql = q.lower()

    # 1. Named property? Try fuzzy match on both the raw question and a
    #    lead-in-stripped property phrase; keep the stronger match.
    prop, score = index.fuzzy_property(q)
    phrase = _extract_property_phrase(q)
    if phrase and phrase.lower() != ql:
        p2, s2 = index.fuzzy_property(phrase)
        if p2 is not None and s2 > score:
            prop, score = p2, s2
    # Avoid treating a bare city name as a property
    cities_lower = {c.lower() for c in index.all_cities()}
    looks_like_city_only = ql in cities_lower or _norm_name(phrase) in cities_lower

    # 2. City mention
    city_hit = None
    for c in index.all_cities():
        if re.search(r"\b" + re.escape(c.lower()) + r"\b", ql):
            city_hit = c
            break

    # 3. Attribute signals
    ami = _detect_ami_tier(q)
    br = _detect_bedrooms(q)
    ptype = _detect_type(q)
    avail = _wants_available_now(q)

    # Decision order: a confident specific-property name wins unless it's just a city.
    if prop is not None and score >= 0.72 and not looks_like_city_only:
        return "named_property", {"record": prop, "score": score}

    if (ami or br or ptype or avail) and not (prop is not None and score >= 0.78):
        return "attribute", {"ami": ami, "bedrooms": br, "type": ptype,
                             "available_now": avail, "city": city_hit}

    if city_hit:
        return "city", {"city": city_hit}

    # Medium-confidence property name with no other signal -> still named
    if prop is not None and score >= 0.62 and not looks_like_city_only:
        return "named_property", {"record": prop, "score": score}

    # Looks like it names a property (capitalized multi-word, not process keywords)
    # but we couldn't match it -> unknown-property refusal signal.
    unknown_prop = _looks_like_unknown_property(q, prop, score)
    return "process", {"unknownProperty": unknown_prop}


# --------------------------------------------------------------------------- #
# Main entry point
# --------------------------------------------------------------------------- #
_INDEX_SINGLETON = None


def _shared_index():
    global _INDEX_SINGLETON
    if _INDEX_SINGLETON is None:
        _INDEX_SINGLETON = HousingIndex()
    return _INDEX_SINGLETON


def build_context(question, index=None):
    """
    Take a question string, return the assembled context payload per the
    LOCKED grounding contract:
      {
        "question": ...,
        "routing": "named_property|city|attribute|process",
        "properties": [ <full normalized obj> ]            (named)
                    or [ {name,city,availability,amiTiers,type} ]  (compact)
                    or []                                   (process),
        "propertyMode": "full|compact|none",
        "faqSections": [ {id,title,anchor} ],
        "facts": <always-on facts block>,
        "notes": [ ... optional retrieval notes ... ]
      }
    """
    index = index or _shared_index()
    branch, detail = classify(question, index)
    notes = []
    properties = []
    mode = "none"

    if branch == "named_property":
        rec = detail["record"]
        properties = [_strip_internal(rec)]
        mode = "full"
        if rec["availability"]["status"] == "statewide_only":
            notes.append(
                f"'{rec.get('name')}' is in the statewide HUD-LIHTC dataset only "
                f"(no available-now feed). Rent, contact, amenities, pet policy, "
                f"office hours are NOT in the data — refuse + point to next step."
            )
    elif branch == "city":
        recs = index.by_city(detail["city"])
        # surface available-now first within the city
        recs.sort(key=lambda r: 0 if r["availability"]["status"] == "available_now" else 1)
        properties = [_compact(r) for r in recs[:K_COMPACT]]
        mode = "compact"
        if len(recs) > K_COMPACT:
            notes.append(f"{len(recs)} properties in {detail['city']}; showing first {K_COMPACT}.")
        if not recs:
            notes.append(f"No properties found for city '{detail['city']}' in the data.")
    elif branch == "attribute":
        recs = index.filter_attributes(
            ptype=detail.get("type"),
            ami_tier=detail.get("ami"),
            available_now=detail.get("available_now"),
            bedrooms=detail.get("bedrooms"),
            city=detail.get("city"),
        )
        recs.sort(key=lambda r: 0 if r["availability"]["status"] == "available_now" else 1)
        properties = [_compact(r) for r in recs[:K_COMPACT]]
        mode = "compact"
        scope = f" in {detail['city']}" if detail.get("city") else ""
        if len(recs) > K_COMPACT:
            notes.append(f"{len(recs)} matches{scope}; showing first {K_COMPACT}.")
        if not recs:
            notes.append("No properties match those attributes in the data.")
        if detail.get("bedrooms"):
            notes.append(
                "Bedroom counts are only known for the 17 available-now (GPMG) "
                "properties via unitTypes; statewide-only records have no bedroom data."
            )
    else:  # process
        properties = []
        mode = "none"
        unknown = detail.get("unknownProperty")
        if unknown:
            notes.append(
                f"The question appears to name a property ('{unknown}') that is NOT "
                f"in the statewide HUD-LIHTC or available-now data. Refuse: say you "
                f"don't have a property by that name and point to /discover or "
                f"contacting GPMG. Do NOT invent details."
            )

    faq = _match_faq_sections(question)
    if not faq:
        # Always give the agent something to ground process answers in.
        faq = [{"id": "application-steps",
                "title": "The application steps",
                "anchor": "faq.md#application-steps"}]

    return {
        "question": question,
        "routing": branch,
        "propertyMode": mode,
        "properties": properties,
        "faqSections": faq,
        "facts": ALWAYS_ON_FACTS,
        "notes": notes,
        "_meta": {
            "statewideRecords": index.statewide_count,
            "gpmgRecords": index.gpmg_count,
            "availableNowRecords": index.available_now_count,
            "totalIndexRecords": len(index.records),
            "dataAsOf": index._gpmg_snapshot,
        },
    }


# --------------------------------------------------------------------------- #
# Smoke harness
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    idx = _shared_index()
    print("=" * 72)
    print(f"INDEX BUILT: {idx.statewide_count} statewide + {idx.gpmg_count} GPMG "
          f"-> {len(idx.records)} total records "
          f"({idx.available_now_count} available_now)")
    print(f"  statewide source: {idx._statewide_path}")
    print(f"  data as of: {idx._gpmg_snapshot}")
    print("=" * 72)

    samples = [
        ("Tell me about Silver Pines Apts",          "named_property"),
        ("What senior housing is available in Henderson?", "city/attribute"),
        ("Show me available-now senior units",       "attribute"),
        ("What documents do I need to apply?",        "process"),
        ("Tell me about Moonbeam Towers",             "named_property->unknown(refusal)"),
    ]

    for q, expected in samples:
        ctx = build_context(q, idx)
        print(f"\nQ: {q}")
        print(f"  expected branch ~ {expected}")
        print(f"  ROUTED -> {ctx['routing']}  (propertyMode={ctx['propertyMode']})")
        if ctx["propertyMode"] == "full" and ctx["properties"]:
            p = ctx["properties"][0]
            print(f"    property: {p['name']} | city={p['city']} | type={p['type']} | "
                  f"amiTiers={p['amiTiers']} | avail={p['availability']['status']} | "
                  f"phone={p['contact']['phone']}")
        elif ctx["propertyMode"] == "compact":
            print(f"    {len(ctx['properties'])} compact summaries:")
            for p in ctx["properties"][:4]:
                print(f"      - {p['name']} ({p['city']}) [{p['availability']}] "
                      f"type={p['type']} ami={p['amiTiers']}")
            if not ctx["properties"]:
                print("      (none)")
        else:
            print("    (no property objects injected)")
        print(f"    FAQ sections: {[s['id'] for s in ctx['faqSections']]}")
        if ctx["notes"]:
            for n in ctx["notes"]:
                print(f"    NOTE: {n}")
    print("\n" + "=" * 72)
    print("Smoke harness complete.")
