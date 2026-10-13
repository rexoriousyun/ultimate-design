"""design-guide's rulebook, as ultimate-design reads it (docs/gate-rulebook.md sections 1-8,
approved 2026-10-07).

design-guide publishes one versioned JSON rulebook per project (`design-guide export rulebook
--project <dir>`); ultimate-design never reads design-guide's own files. The server exports it
into data/<slug>/rulebook.json at the start of every turn. A failed export is written there as
{"error": reason}, and `verify` then fails with "Rulebook unavailable": never a silent pass,
never a stale copy.

A workspace whose rules are `builtin` (app/workspace.py) never calls design-guide: its rule book is
app/rulebook-builtin.json, the accessibility floor `verify` measures in the page, and there is no
gate pass and no proposals.

How a rule is checked (section 3):
- `measure` checks ultimate-design implements run in the page `verify` already has open
  (IN_PAGE). A measure it does not implement runs through design-guide's gate instead, so
  there is still one implementation of each check (section 4).
- `engine` checks run through `design-guide gate <page> --project <dir> --json`, once per turn
  after the agent's last write (the server's rules pass), not on every `verify`.
- `review` checks are a checklist; they never block.
"""

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path

from app import decisions, workspace

COMMAND = os.environ.get("PM_DESIGN_GUIDE", "design-guide")
FILE = "rulebook.json"
BUILTIN = Path(__file__).resolve().parent / "rulebook-builtin.json"
IN_PAGE = ("contrast", "target-size", "reflow")
EXPORT_TIMEOUT = 60
GATE_TIMEOUT = 120


def path(data_dir: Path) -> Path:
    return data_dir / FILE


async def _run(*args: str, timeout: float) -> tuple[int, str, str]:
    # stdout goes to a file, not a pipe: node exits before a large write to a pipe is flushed,
    # and a ~100 KB rulebook arrived cut off (found in the manual check, 2026-10-07).
    with tempfile.TemporaryFile() as out:
        try:
            proc = await asyncio.create_subprocess_exec(COMMAND, *args, stdout=out,
                                                        stderr=asyncio.subprocess.PIPE)
        except FileNotFoundError:
            return 127, "", f"`{COMMAND}` is not installed or not on PATH"
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return 124, "", f"`{COMMAND}` took longer than {timeout:.0f}s"
        out.seek(0)
        return proc.returncode, out.read().decode(errors="replace"), err.decode(errors="replace")


async def export(project_dir: Path, out: Path, decisions_dir: Path | None = None) -> dict:
    """Export the project's rulebook to `out` and return it, or write and return the error.
    `decisions_dir` holds the project's decisions.jsonl: its taste-rule picks come back as
    `layer: project` rules (gate section 14; design-guide's redesign gate, section 7)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if workspace.rules() == "builtin":
        book = json.loads(BUILTIN.read_text())
        out.write_text(json.dumps(book))
        return book
    args = ["export", "rulebook", "--project", str(project_dir), "--json"]
    if decisions_dir is not None:
        args += ["--decisions", str(decisions_dir)]
    code, stdout, stderr = await _run(*args, timeout=EXPORT_TIMEOUT)
    try:
        book = json.loads(stdout) if code == 0 else None
    except json.JSONDecodeError:
        book = None
    if not isinstance(book, dict) or "rules" not in book:
        reason = (stderr.strip().splitlines() or [f"exit {code}, no rulebook on stdout"])[-1]
        book = {"error": f"design-guide export failed: {reason}"}
    out.write_text(json.dumps(book))
    return book


def load(file: Path) -> dict | None:
    """The exported rulebook; {"error": ...} when the export failed or the file is unreadable;
    None when no rulebook was configured for this check at all."""
    if not file.is_file():
        return None
    try:
        return json.loads(file.read_text())
    except (OSError, json.JSONDecodeError) as err:
        return {"error": f"the exported rulebook could not be read: {err}"}


def blocking(rule: dict) -> bool:
    """A finding of this rule keeps `verify` from being clean: confirmed, `fail`, and a detector
    that is trusted (`maturity: stable`). Proposed rules never bind; an observed fail is a flag."""
    return rule.get("status") == "confirmed" and rule.get("severity") == "fail" \
        and rule.get("maturity", "stable") == "stable"


def dismissed(decisions_file: Path | None) -> set[str]:
    """Rules the user dismissed for this project (section 12): dismissal records not superseded.
    Floor rules never count, whatever the log says."""
    if decisions_file is None:
        return set()
    records = decisions.read(decisions_file)
    superseded = {r["supersedes"] for r in records if r.get("supersedes")}
    return {r["rule"] for r in records
            if r.get("dismissed") and r.get("rule") and not r.get("floor") and r["id"] not in superseded}


def in_page(book: dict) -> list[dict]:
    """The measure rules `verify` evaluates itself."""
    return [r for r in book.get("rules", [])
            if r["check"]["kind"] == "measure" and r["check"].get("measure") in IN_PAGE]


def settled(book: dict | None) -> str:
    """The project's own settled choices (its `layer: project` rules) as a note for the design
    agent, so it doesn't reopen them (gate section 14). "" when there are none."""
    lines = []
    for r in (book or {}).get("rules", []):
        stance = r.get("stance") or {}
        if r.get("layer") != "project" or not stance.get("choice"):
            continue
        why = f' (their words: "{stance["why"]}")' if stance.get("why") else ""
        lines.append(f"- {r['statement']}: {stance['choice']}{why}")
    if not lines:
        return ""
    return ("(Note from the app: settled in this project by the user's own decisions. Follow these "
            "and don't reopen them unless the user asks:\n" + "\n".join(lines) + ")\n\n")


_EXCEPTION = re.compile(r"(--(?:ds|palette)-override-[\w-]+)\s*:\s*([^;}]+)")


def declared_exceptions(folder: Path) -> list[dict]:
    """The design agent's declared exceptions to the design system or palette (`--ds-override-*`,
    `--palette-override-*` custom properties) in the design's CSS and HTML, so the user sees each one
    (gate section 12). They are the agent's mechanism, never the user's decisions."""
    found = {}
    for file in sorted(folder.rglob("*")):
        if file.suffix not in (".css", ".html") or not file.is_file() or "design-system" in file.relative_to(folder).parts:
            continue
        for name, value in _EXCEPTION.findall(file.read_text(errors="replace")):
            found.setdefault((name, value.strip()), file.relative_to(folder).as_posix())
    return [{"name": n, "value": v, "file": f} for (n, v), f in found.items()]


def finding_line(rule: dict, detail: str) -> str:
    """One finding for the agent: the rule id, what is wrong, and the fix when the rule has one."""
    fix = f" Fix: {rule['fix']}" if rule.get("fix") else ""
    return f"{rule['id']}: {rule['statement']} — {detail}.{fix}"


async def gate(url: str, project_dir: Path) -> dict:
    """design-guide's gate on one served page: its findings JSON, or {"error": reason}."""
    code, stdout, stderr = await _run("gate", url, "--project", str(project_dir), "--json",
                                      timeout=GATE_TIMEOUT)
    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        reason = (stderr.strip().splitlines() or [f"exit {code}, no JSON on stdout"])[-1]
        return {"error": f"design-guide gate failed: {reason}"}
    return result


async def proposals(decisions_root: Path) -> dict:
    """design-guide's periodic pass over every project's decision log (section 7): proposed
    rules with the decisions behind them, withheld ones, and bad log lines; plus the rulebook's
    categories, which a new rule must use. {"error": reason} when the CLI fails."""
    code, stdout, stderr = await _run("proposals", "--decisions", str(decisions_root), timeout=EXPORT_TIMEOUT)
    try:
        result = json.loads(stdout) if code == 0 else None
    except json.JSONDecodeError:
        result = None
    if not isinstance(result, dict):
        return {"error": f"design-guide proposals failed: {(stderr.strip().splitlines() or [f'exit {code}'])[-1]}"}
    code, stdout, _ = await _run("export", "rulebook", "--json", timeout=EXPORT_TIMEOUT)
    try:
        book = json.loads(stdout) if code == 0 else {}
    except json.JSONDecodeError:
        book = {}
    result["categories"] = sorted({r["category"] for r in book.get("rules", []) if r.get("category")})
    return result


async def answer(action: str, proposal: str, decisions_root: Path, why: str = "", rule_id: str = "",
                 title: str = "", category: str = "") -> tuple[bool, str]:
    """The user confirms or rejects a proposal through design-guide's command, the only writer of
    rules (section 15): (True, its ledger record as JSON) or (False, its refusal)."""
    args = ["proposals", action, proposal, "--decisions", str(decisions_root)]
    if why.strip():
        args += ["--why", why.strip()]
    for flag, value in (("--id", rule_id), ("--title", title), ("--category", category)):
        if value.strip():
            args += [flag, value.strip()]
    code, stdout, stderr = await _run(*args, timeout=EXPORT_TIMEOUT)
    if code == 0:
        return True, stdout
    return False, stderr.strip() or f"design-guide refused (exit {code})"


def gate_findings(result: dict, book: dict, page: str, skip: set[str]) -> list[dict]:
    """The gate's findings for the studio and the agent: one per rule and page, with whether it
    blocks and whether The user may dismiss it. Findings of rules in `skip` (dismissed) are left out,
    as are measure rules `verify` already evaluates in the page."""
    rules = {r["id"]: r for r in book.get("rules", [])}
    in_page_ids = {r["id"] for r in in_page(book)}
    out = {}
    for f in result.get("findings", []):
        rule = rules.get(f["entryId"])
        if f["entryId"] in skip or f["entryId"] in in_page_ids or f.get("verdict") not in ("fail", "flag"):
            continue
        key = f["entryId"]
        entry = out.setdefault(key, {
            "rule": key, "page": page, "title": f.get("title") or (rule or {}).get("statement", key),
            "layer": (rule or {}).get("layer"), "fix": (rule or {}).get("fix"),
            "blocking": bool(rule) and blocking(rule) and f["verdict"] == "fail",
            "dismissable": (rule or {}).get("layer") != "floor",
            "reasons": [], "where": []})
        entry["reasons"].append(f.get("reason") or "")
        entry["where"].extend(f.get("locators") or [])
    return list(out.values())
