"""The decision log: what the user picked, rejected and overrode while designing (docs/gate-rulebook.md,
sections 9-14, approved 2026-10-07).

One append-only file per project, data/<slug>/decisions.jsonl, one record per line, in the
shape of docs/decision-log.schema.json. design-guide reads it in a periodic pass and turns
patterns across projects into proposed rules; nothing here is a rule.

Two rules this module enforces rather than trusts:
- `why` is the user's own words, verbatim, or None. A quote offered on their behalf (by the design
  agent) is kept only if it is an exact substring of what they wrote (`quote_or_none`).
- Records are never edited. A correction, or a later value for the same edit in the same
  chat turn, is a new record naming the one it `supersedes`.
"""

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path

FILE = "decisions.jsonl"
VERSION = 1
KINDS = ("pick", "reject", "override")
TOPICS = ("color", "type", "layout", "spacing", "density", "shape", "motion", "imagery", "copy",
          "component", "hierarchy", "direction", "other")
WHY_SOURCES = ("chat", "answer", "comment", "studio")

# CSS properties to the visual dimension the pass groups undecided choices by (section 11).
_PROPERTY_TOPICS = (
    ("color", ("color", "background", "background-color", "border-color", "fill", "stroke",
               "outline-color", "accent-color")),
    ("type", ("font", "font-family", "font-size", "font-weight", "font-style", "line-height",
              "letter-spacing", "text-transform", "text-align", "text-decoration")),
    ("spacing", ("margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding",
                 "padding-top", "padding-right", "padding-bottom", "padding-left", "gap",
                 "row-gap", "column-gap")),
    ("shape", ("border-radius", "border-width", "border", "box-shadow")),
    ("layout", ("width", "height", "translate", "order", "display", "flex-direction",
                "justify-content", "align-items", "grid-template-columns")),
    ("motion", ("transition", "animation", "transition-duration", "animation-duration")),
)


def path(data_dir: Path) -> Path:
    return data_dir / FILE


def read(file: Path) -> list[dict]:
    if not file.is_file():
        return []
    return [json.loads(line) for line in file.read_text().splitlines() if line.strip()]


def topic_for(prop: str) -> str:
    for topic, props in _PROPERTY_TOPICS:
        if prop in props:
            return topic
    return "other"


def quote_or_none(quote: str | None, message: str) -> str | None:
    """`quote` if the user wrote exactly that (an exact substring of their message), else None."""
    quote = (quote or "").strip()
    return quote if quote and quote in message else None


def append(file: Path, *, project: str, kind: str, topic: str, subject: dict, chose,
           over: list | None = None, why: str | None = None, why_source: str | None = None,
           context: dict, rule: str | None = None, floor: bool = False, dismissed: bool = False,
           supersedes: str | None = None, **extra) -> dict:
    """Write one record and return it. `extra` carries kind-specific fields (`from` on an
    override)."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if topic not in TOPICS:
        raise ValueError(f"topic must be one of {TOPICS}")
    if why is not None and why_source not in WHY_SOURCES:
        raise ValueError("a why needs its source")
    now = datetime.now(timezone.utc)
    record = {
        "v": VERSION,
        "id": f"d-{now:%Y%m%d-%H%M%S}-{secrets.token_hex(2)}",
        "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "project": project, "kind": kind, "topic": topic, "subject": subject,
        "chose": chose, "over": over or [],
        "why": why, "why_source": why_source if why is not None else None,
        "rule": rule, "floor": floor, "dismissed": dismissed, "context": context, "supersedes": supersedes, **extra,
    }
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("a") as f:
        f.write(json.dumps(record) + "\n")
    return record


def override(file: Path, mark: int, *, project: str, context: dict, page: str, selector: str | None,
             prop: str, before: str | None, after: str, topic: str | None = None,
             rule: str | None = None) -> dict | None:
    """One Edit-mode or tweak change, coalesced per chat turn (section 13): a change to the same
    (page, selector, property) since the turn began (`mark`, the log's length then) supersedes
    the earlier record and keeps its `from`. Back at the original value, it is recorded as a
    no-op superseding record (chose == from), which the pass ignores; with no earlier record
    in the turn and no change, nothing is written."""
    subject = {"page": page, "property": prop} if selector is None else \
        {"page": page, "selector": selector, "property": prop}
    earlier = next((r for r in reversed(read(file)[mark:])
                    if r["kind"] == "override" and r["subject"] == subject), None)
    if earlier is not None:
        before = earlier["from"]
    elif before is not None and before == after:
        return None
    return append(file, project=project, kind="override", topic=topic or topic_for(prop),
                  subject=subject, chose=after, context=context, rule=rule,
                  supersedes=earlier["id"] if earlier else None, **{"from": before})


def add_why(file: Path, ids: list[str], why: str) -> list[dict]:
    """The user's reason for decisions just logged (the studio's "why?" field): each record is
    repeated with `why` set and `supersedes` naming it. Unknown ids are skipped."""
    why = why.strip()
    if not why:
        return []
    by_id = {r["id"]: r for r in read(file)}
    out = []
    for i in ids:
        r = by_id.get(i)
        if r is None:
            continue
        fields = {k: v for k, v in r.items() if k not in ("v", "id", "at", "why", "why_source", "supersedes")}
        out.append(append(file, **fields, why=why, why_source="studio", supersedes=r["id"]))
    return out
