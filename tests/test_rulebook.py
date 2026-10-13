"""design-guide's rulebook in ultimate-design (app/rulebook.py; docs/gate-rulebook.md sections 1-8):
the in-page measures held to design-guide's own pass/fail fixtures, what blocks, dismissals,
a failed export, and the gate's findings. Needs Chromium, like test_preview.py. The CLI is
replaced by a fake script; the real one is exercised only by the manual check in docs/testing.md."""

import asyncio
import json
import os
import stat
from pathlib import Path

import pytest

from app import decisions, rulebook
from app.preview import DESKTOP, MOBILE, Previewer

FIXTURES = Path(__file__).parent / "fixtures"
MEASURES = FIXTURES / "measures"
SAMPLE = json.loads((FIXTURES / "rulebook-sample.json").read_text())


def rule(rid, measure, params, viewports, **extra):
    return {"id": rid, "statement": f"{rid} statement", "layer": "floor", "status": "confirmed",
            "severity": "fail", "maturity": "stable", "fix": None,
            "check": {"kind": "measure", "measure": measure, "params": params, "viewports": viewports}, **extra}


def check(folder, page, book, size=DESKTOP, dismissed=(), hierarchy=False):
    async def go():
        p = Previewer(folder, rules=book, dismissed=set(dismissed), hierarchy=hierarchy)
        try:
            return (await p.screenshot(page, size))[1]
        finally:
            await p.close()
    return asyncio.run(go())


CASES = [c for c in json.loads((MEASURES / "manifest.json").read_text())["cases"]]


@pytest.mark.parametrize("case", [c for c in CASES if c["measure"] in rulebook.IN_PAGE],
                         ids=lambda c: c["file"])
def test_in_page_measures_agree_with_design_guides_fixtures(case):
    """Section 4: one definition of each check. ultimate-design's evaluator must give
    design-guide's verdict on design-guide's own pages, at every viewport the rule names."""
    book = {"rules": [rule(case["rule"], case["measure"], case["params"], case["viewports"])], "withheld": []}
    sizes = [DESKTOP] if case["measure"] == "reflow" else [(w, 900) for w in case["viewports"]]
    found = [any(case["rule"] in line for line in check(MEASURES, case["file"], book, size).rules) for size in sizes]
    assert any(found) == (case["expected"] == "fail"), (case["file"], found)


# Measures whose one implementation is ultimate-design's own built-in check (design-guide's
# redesign gate, section 8): conformance.js against design-system/, and the Wada palette check.
BUILT_IN = {"design-system": "off_system", "palette": "off_palette", "hierarchy": "hierarchy"}


def test_measures_ultimate_design_does_not_implement_go_through_the_gate():
    assert {c["measure"] for c in CASES} - set(rulebook.IN_PAGE) - set(BUILT_IN) == {"token-only"}
    assert [r["id"] for r in rulebook.in_page(SAMPLE)] == [
        r["id"] for r in SAMPLE["rules"] if r["check"].get("measure") in ("contrast", "target-size", "reflow")]


def test_only_confirmed_stable_fails_block_and_dismissed_rules_are_skipped(tmp_path):
    (tmp_path / "index.html").write_text('<!doctype html><title>t</title><p style="color:#bbb">faint</p>')
    stable = rule("contrast-minimum", "contrast", {"min": 4.5, "large": 3}, [1440, 390])
    observing = rule("contrast-observed", "contrast", {"min": 4.5, "large": 3}, [1440, 390], maturity="observing")
    proposed = rule("contrast-proposed", "contrast", {"min": 7, "large": 4.5}, [1440, 390], status="proposed")
    problems = check(tmp_path, "index.html", {"rules": [stable, observing, proposed],
                                              "withheld": [{"id": "target-size-enhanced", "reason": "no personas"}]})
    assert [l.split(":")[0] for l in problems.rules] == ["contrast-minimum"]
    assert "#bbbbbb on #ffffff" in problems.rules[0]
    notes = " ".join(problems.rule_notes)
    assert "contrast-observed" in notes and "contrast-proposed" in notes
    assert "target-size-enhanced was not checked for this project: no personas" in notes
    assert not problems.low_contrast  # the rulebook's measure replaces the built-in check
    assert not problems.empty()

    clean = check(tmp_path, "index.html", {"rules": [observing], "withheld": []})
    assert clean.empty() and clean.rule_notes  # reported, not blocking

    assert check(tmp_path, "index.html", {"rules": [observing], "withheld": []},
                 dismissed={"contrast-observed"}).rule_notes == []


def test_a_failed_export_fails_verify_and_no_rulebook_keeps_the_built_in_check(tmp_path):
    (tmp_path / "index.html").write_text('<!doctype html><title>t</title><p style="color:#bbb">faint</p>')
    broken = check(tmp_path, "index.html", {"error": "design-guide export failed: boom"})
    assert broken.rules == ["Rulebook unavailable: design-guide export failed: boom. The design cannot be "
                            "checked against design-guide's rules until this is fixed; tell the user."]
    assert check(tmp_path, "index.html", None).low_contrast  # previews, thumbnails: unchanged


def test_dismissed_reads_the_decision_log_and_never_the_floor(tmp_path):
    log = tmp_path / decisions.FILE
    ctx = {"kind": "design", "design_system": None, "palette": None, "version": None, "rulebook": "abc"}
    common = dict(project="p", kind="override", topic="other", subject={"page": "index.html"},
                  chose="dismissed", context=ctx, dismissed=True)
    decisions.append(log, rule="no-raw-design-values", **common, **{"from": None})
    decisions.append(log, rule="contrast-minimum", floor=True, **common, **{"from": None})
    assert rulebook.dismissed(log) == {"no-raw-design-values"}
    assert rulebook.dismissed(None) == set()


def fake_cli(tmp_path, monkeypatch, stdout="", code=0, stderr=""):
    script = tmp_path / "design-guide"
    script.write_text(f"#!/bin/sh\necho \"$@\" > {tmp_path}/args\ncat <<'JSON'\n{stdout}\nJSON\n"
                      f"echo '{stderr}' >&2\nexit {code}\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(rulebook, "COMMAND", str(script))
    return tmp_path / "args"


def test_export_writes_the_rulebook_or_the_reason_it_failed(tmp_path, monkeypatch):
    args = fake_cli(tmp_path, monkeypatch, stdout=json.dumps(SAMPLE))
    out = tmp_path / "data" / rulebook.FILE
    book = asyncio.run(rulebook.export(tmp_path / "proj", out))
    assert book["version"] == SAMPLE["version"] and rulebook.load(out) == book
    assert args.read_text().split() == ["export", "rulebook", "--project", str(tmp_path / "proj"), "--json"]
    asyncio.run(rulebook.export(tmp_path / "proj", out, tmp_path / "data"))
    assert args.read_text().split()[-2:] == ["--decisions", str(tmp_path / "data")]

    fake_cli(tmp_path, monkeypatch, code=1, stderr="no knowledge dir")
    assert asyncio.run(rulebook.export(tmp_path / "proj", out)) == {"error": "design-guide export failed: no knowledge dir"}
    assert "error" in rulebook.load(out)

    monkeypatch.setattr(rulebook, "COMMAND", str(tmp_path / "missing"))
    assert "not installed or not on PATH" in asyncio.run(rulebook.export(tmp_path / "proj", out))["error"]
    assert rulebook.load(tmp_path / "nope.json") is None


def test_gate_findings_name_rules_and_say_what_blocks_and_who_may_dismiss(tmp_path, monkeypatch):
    result = {"findings": [
        {"entryId": "control-accessible-name", "title": "Every control needs an accessible name", "verdict": "fail",
         "reason": "button has no name", "locators": ["button"]},
        {"entryId": "control-accessible-name", "title": "Every control needs an accessible name", "verdict": "fail",
         "reason": "link has no name", "locators": ["a"]},
        {"entryId": "contrast-minimum", "verdict": "fail", "reason": "in-page already", "locators": []},
        {"entryId": "no-raw-design-values", "verdict": "flag", "reason": "#eaf1ff", "locators": [".card"]},
        {"entryId": "dismissed-one", "verdict": "flag", "reason": "x", "locators": []},
    ]}
    found = rulebook.gate_findings(result, SAMPLE, "index.html", skip={"dismissed-one"})
    by = {f["rule"]: f for f in found}
    assert set(by) == {"control-accessible-name", "no-raw-design-values"}
    name = by["control-accessible-name"]
    assert name["blocking"] and not name["dismissable"] and name["where"] == ["button", "a"]
    assert name["reasons"] == ["button has no name", "link has no name"]
    tokens = by["no-raw-design-values"]
    assert not tokens["blocking"] and tokens["dismissable"] and tokens["layer"] == "art"

    fake_cli(tmp_path, monkeypatch, stdout="not json", code=2, stderr="chromium missing")
    assert asyncio.run(rulebook.gate("http://x/", tmp_path)) == {"error": "design-guide gate failed: chromium missing"}


# ---- the studio's turns ----

from app import engine, projects, server  # noqa: E402
from tests.conftest import done, say, tool  # noqa: E402

PAGE = '<!doctype html><title>t</title><h1 style="padding-top:4px">Hi</h1><button>Go</button>'
WROTE = [tool("Write"), tool(engine.VERIFY_TOOL, id_="t2"), say(), done()]


def gate_reports(tmp_path, findings):
    (tmp_path / "fake-gate.json").write_text(json.dumps({"findings": findings}))


def turn(client, slug, message="go"):
    body = client.post(f"/api/projects/{slug}/chat", json={"message": message}).text
    return [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ")]


def test_every_turn_exports_the_rulebook_and_verify_gets_it(client, fake_engine):
    fake_engine([({"index.html": PAGE}, WROTE)])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    turn(client, slug)
    assert rulebook.load(rulebook.path(projects.data_dir(slug)))["version"] == SAMPLE["version"]
    env = server.turn_options(projects.get(slug)).mcp_env
    assert env["PM_RULEBOOK_FILE"] == str(rulebook.path(projects.data_dir(slug)))
    assert json.loads(env["PM_DECISION_CONTEXT"])["rulebook"] == SAMPLE["version"]


def test_the_gate_runs_once_after_the_last_write_and_blocking_findings_nudge(client, fake_engine, tmp_path):
    eng = fake_engine([({"index.html": PAGE}, WROTE), ({}, [say("Fixed."), done()])])
    gate_reports(tmp_path, [
        {"entryId": "control-accessible-name", "title": "Every control needs an accessible name",
         "verdict": "fail", "reason": "button has no name", "locators": ["button"]},
        {"entryId": "no-raw-design-values", "title": "Use tokens", "verdict": "flag", "reason": "4px", "locators": ["h1"]}])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    streamed = turn(client, slug)
    [event] = [e for e in streamed if e["type"] == "findings"]
    assert event["rulebook"] == SAMPLE["version"] and event["pages"] == ["index.html"]
    assert {f["rule"]: (f["blocking"], f["dismissable"]) for f in event["findings"]} == {
        "control-accessible-name": (True, False), "no-raw-design-values": (False, True)}
    assert len(eng.prompts) == 2 and eng.prompts[1]["prompt"].startswith(engine.RULES_NUDGE)
    assert "index.html: control-accessible-name" in eng.prompts[1]["prompt"]
    assert "no-raw-design-values" not in eng.prompts[1]["prompt"]  # a flag is shown, not nudged
    assert [e["type"] for e in projects.read_chat(slug)].count("findings") == 1  # once per message
    assert event["exceptions"] == []


def test_a_turn_that_writes_nothing_runs_no_gate(client, fake_engine, tmp_path):
    fake_engine([({}, [say("Nothing to change."), done()])])
    gate_reports(tmp_path, [{"entryId": "control-accessible-name", "verdict": "fail", "reason": "x", "locators": []}])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    assert not [e for e in turn(client, slug) if e["type"] == "findings"]


def test_rex_dismisses_a_rule_but_never_the_floor(client, fake_engine, tmp_path):
    fake_engine([({"index.html": PAGE}, WROTE), ({}, WROTE)])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    turn(client, slug)
    url = f"/api/projects/{slug}/findings/dismiss"
    assert client.post(url, json={"rule": "contrast-minimum"}).status_code == 400
    assert client.post(url, json={"rule": "nope"}).status_code == 404
    record = client.post(url, json={"rule": "no-raw-design-values", "why": "this page is a sketch"}).json()
    assert (record["kind"], record["dismissed"], record["rule"], record["why"]) == (
        "override", True, "no-raw-design-values", "this page is a sketch")
    assert record["context"]["rulebook"] == SAMPLE["version"]
    gate_reports(tmp_path, [{"entryId": "no-raw-design-values", "verdict": "flag", "reason": "4px", "locators": []}])
    [event] = [e for e in turn(client, slug, "again") if e["type"] == "findings"]
    assert event["findings"] == []  # dismissed for this project


def test_an_edit_names_the_rule_its_property_touches_but_not_a_floor_rule(client, fake_engine):
    fake_engine([({"index.html": PAGE}, WROTE)])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    turn(client, slug)
    client.post(f"/api/projects/{slug}/edits", json={"styles": {"index.html": {"h1": {
        "padding-top": "16px", "color": "#123456"}}}})
    by = {r["subject"]["property"]: r for r in decisions.read(decisions.path(projects.data_dir(slug)))}
    assert by["padding-top"]["rule"] == "no-raw-design-values"
    assert by["color"]["rule"] == "no-raw-design-values"  # not contrast-minimum, a floor rule
    assert not by["color"]["floor"]
    # Several rules read colour (tokens, palette, hierarchy): the confirmed one wins; font-size
    # is read only by the proposed hierarchy rule.
    client.post(f"/api/projects/{slug}/edits", json={"styles": {"index.html": {"h1": {"font-size": "40px"}}}})
    assert decisions.read(decisions.path(projects.data_dir(slug)))[-1]["rule"] == "hierarchy-matches-priority"
    # On a palette page a colour edit is about the palette (palette-conformance is proposed and
    # still beats the confirmed token rule there); hierarchy never takes a colour.
    (projects.design_dir(slug) / "menu.html").write_text(
        '<!doctype html><title>m</title><meta name="palette" content="wada:006"><h2>Menu</h2>')
    client.post(f"/api/projects/{slug}/edits", json={"styles": {"menu.html": {"h2": {
        "color": "#f48067", "font-weight": "700"}}}})
    last = {r["subject"]["property"]: r["rule"] for r in decisions.read(decisions.path(projects.data_dir(slug)))[-2:]}
    assert last == {"color": "palette-conformance", "font-weight": "hierarchy-matches-priority"}


def test_written_pages():
    events = [tool("Write", path="a.html"), tool("Edit", id_="2", path="styles.css"), tool("Write", id_="3", path="a.html")]
    assert engine.written_pages(events, "index.html") == ["a.html"]
    assert engine.written_pages([tool("Edit", path="styles.css")], "index.html") == ["index.html"]
    assert engine.written_pages([tool("Write", path="README.md")], "index.html") == []


@pytest.mark.skipif(not __import__("shutil").which("node"), reason="needs node, like design-guide")
def test_a_large_export_arrives_whole_from_a_node_cli_that_exits_at_once(tmp_path, monkeypatch):
    """design-guide (node) calls process.exit right after writing ~100 KB; through a pipe the
    rulebook arrived cut off. The real export reproduces it; so does this stand-in."""
    big = {**SAMPLE, "rules": SAMPLE["rules"] * 4}
    (tmp_path / "big.json").write_text(json.dumps(big))
    script = tmp_path / "design-guide"
    script.write_text("#!/usr/bin/env node\n"
                      f"process.stdout.write(require('fs').readFileSync({json.dumps(str(tmp_path / 'big.json'))}, 'utf8'));\n"
                      "process.exit(0);\n")
    script.chmod(0o755)
    monkeypatch.setattr(rulebook, "COMMAND", str(script))
    book = asyncio.run(rulebook.export(tmp_path, tmp_path / "out.json"))
    assert len(book["rules"]) == len(big["rules"])


# ---- proposed rules (§15): the studio reads design-guide's pass and answers through its command ----

PROPOSALS = json.loads((FIXTURES / "proposals-sample.json").read_text())


def test_proposals_come_from_design_guide_with_the_rulebooks_categories(client):
    res = client.get("/api/proposals").json()
    assert [p["id"] for p in res["proposals"]] == [p["id"] for p in PROPOSALS["proposals"]]
    assert res["logs"] == PROPOSALS["logs"]
    assert "a11y" in res["categories"] and res["categories"] == sorted(set(res["categories"]))


def test_confirming_needs_rexs_words_and_goes_through_design_guide(client, tmp_path):
    pid = PROPOSALS["proposals"][0]["id"]
    assert client.post(f"/api/proposals/{pid}/confirm", json={"why": "  "}).status_code == 400
    assert not (tmp_path / "proposal-answers").exists()  # refused before design-guide is asked
    res = client.post(f"/api/proposals/{pid}/confirm", json={
        "why": "serif headings, every time", "rule_id": "serif-headings", "title": "Headings are serif",
        "category": "visual"})
    assert res.json() == {"action": "confirm", "proposal": pid}
    args = (tmp_path / "proposal-answers").read_text().splitlines()
    assert args[:4] == ["proposals", "confirm", pid, "--decisions"]
    assert args[5:] == ["--why", "serif headings, every time", "--id", "serif-headings",
                        "--title", "Headings are serif", "--category", "visual"]


def test_a_rejection_may_have_no_reason_and_a_refusal_comes_back(client, tmp_path):
    pid = PROPOSALS["proposals"][0]["id"]
    assert client.post(f"/api/proposals/{pid}/reject", json={}).status_code == 200
    assert "--why" not in (tmp_path / "proposal-answers").read_text()
    (tmp_path / "refuse.txt").write_text(f"proposal {pid} is no longer open")
    res = client.post(f"/api/proposals/{pid}/reject", json={"why": "not now"})
    assert res.status_code == 400 and res.json()["detail"] == f"proposal {pid} is no longer open"
    assert client.post(f"/api/proposals/{pid}/delete", json={}).status_code == 404


def test_a_broken_pass_is_an_error_not_an_empty_list(client, tmp_path):
    (tmp_path / "fake-proposals.json").write_text("not json")
    res = client.get("/api/proposals")
    assert res.status_code == 502 and "design-guide proposals failed" in res.json()["detail"]



def test_the_projects_settled_choices_reach_the_design_agent(client, fake_engine, tmp_path, monkeypatch):
    """Gate section 14: a project's own decisions are settled within it. design-guide returns its
    taste-rule picks as layer: project rules; the agent is told them at the start of each turn."""
    project_rule = {**next(r for r in SAMPLE["rules"] if r.get("stance")), "id": "label-placement",
                    "layer": "project", "statement": "Label placement above vs inline",
                    "stance": {"choice": "left-aligned-labels", "alternatives": ["left-aligned-labels",
                               "top-aligned-labels"], "why": "dense admin forms"}}
    args = fake_cli(tmp_path, monkeypatch, stdout=json.dumps({**SAMPLE, "rules": SAMPLE["rules"] + [project_rule]}))
    eng = fake_engine([({}, [say(), done()])])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    client.post(f"/api/projects/{slug}/chat", json={"message": "make the form"})
    prompt = eng.prompts[0]["prompt"]
    assert prompt.startswith("(Note from the app: settled in this project")
    assert '- Label placement above vs inline: left-aligned-labels (their words: "dense admin forms")' in prompt
    assert prompt.endswith("make the form")
    assert args.read_text().split()[-2:] == ["--decisions", str(projects.data_dir(slug))]


def test_no_settled_choices_no_note():
    assert rulebook.settled(SAMPLE) == "" and rulebook.settled(None) == ""



@pytest.mark.parametrize("case", [c for c in CASES if c["measure"] in BUILT_IN], ids=lambda c: c["file"])
def test_the_built_in_conformance_checks_agree_with_design_guides_fixtures(case):
    """design-guide's design-system-conformance and palette-conformance rules name ultimate-design's
    own checks as their implementation; its fixture pages (with the exceptions: studio edits,
    --ds-override-* / --palette-override-*, a real component beside a look-alike) hold them to it."""
    folder = MEASURES / case["file"].split("/")[0]
    book = {"rules": [rule(case["rule"], case["measure"], case["params"], case["viewports"], layer="art")],
            "withheld": []}
    problems = check(folder, case["file"].split("/")[1], book, hierarchy=case["measure"] == "hierarchy")
    found = getattr(problems, BUILT_IN[case["measure"]])
    assert bool(found) == (case["expected"] == "fail"), (case["file"], found)
    assert all(line.startswith(f"{case['rule']}: ") for line in found)  # named by its rule
    assert problems.unloaded_files == []  # a fail page fails only on what it demonstrates


def test_a_dismissed_conformance_rule_is_not_checked():
    folder = MEASURES / "palette-conformance"
    book = {"rules": [rule("palette-conformance", "palette", {}, [1440, 390], layer="art")], "withheld": []}
    assert check(folder, "fail.html", book).off_palette
    assert check(folder, "fail.html", book, dismissed={"palette-conformance"}).off_palette == []
    assert not check(folder, "fail.html", None).off_palette[0].startswith("palette-conformance")  # no rulebook


def test_the_agents_declared_exceptions_are_listed_for_rex(tmp_path):
    (tmp_path / "design-system").mkdir()
    (tmp_path / "design-system" / "tokens.css").write_text(":root { --ds-override-ignored: red; }")
    (tmp_path / "styles.css").write_text(":root { --ds-override-warning: #b45309; --brand: #123; }")
    (tmp_path / "index.html").write_text("<style>:root{--palette-override-surface:#fff}</style>")
    assert rulebook.declared_exceptions(tmp_path) == [
        {"name": "--palette-override-surface", "value": "#fff", "file": "index.html"},
        {"name": "--ds-override-warning", "value": "#b45309", "file": "styles.css"}]



def test_a_dismissed_hierarchy_rule_is_not_checked():
    folder = MEASURES / "hierarchy-matches-priority"
    book = {"rules": [rule("hierarchy-matches-priority", "hierarchy", {}, [1440, 390], layer="art")], "withheld": []}
    assert check(folder, "fail.html", book, hierarchy=True).hierarchy
    assert check(folder, "fail.html", book, hierarchy=True, dismissed={"hierarchy-matches-priority"}).hierarchy == []
