"""The decision log (app/decisions.py; docs/gate-rulebook.md sections 9-14): what is logged
from the studio, the quote guard, coalescing, and that every record fits the published schema."""

import json
from pathlib import Path

import jsonschema
import pytest

from app import decisions, palette, projects
from tests.conftest import done, say

SCHEMA = json.loads((Path(__file__).parent.parent / "docs" / "decision-log.schema.json").read_text())
CONTEXT = {"kind": "design", "design_system": None, "palette": None, "version": None, "rulebook": None}
TWEAK_PAGE = ('<!doctype html><meta name="palette" content="wada:006"><script type="application/json" id="tweaks">'
              '[{"name": "--accent", "label": "Accent", "type": "color", "value": "#c2410c"}]</script><h1>Hi</h1>')


def logged(slug: str) -> list[dict]:
    records = decisions.read(decisions.path(projects.data_dir(slug)))
    for r in records:
        jsonschema.validate(r, SCHEMA)
    return records


def new_design(client, fake_engine, turns=1, page=TWEAK_PAGE):
    fake_engine([({"index.html": page}, [say(), done()])] + [({}, [say(), done()])] * (turns - 1))
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    client.post(f"/api/projects/{slug}/chat", json={"message": "a bakery page"})
    return slug


# ---- the module ----

def test_a_quote_is_kept_only_when_rex_wrote_it_word_for_word():
    message = "Go with B, the serif is warmer and this is a bakery."
    assert decisions.quote_or_none("the serif is warmer", message) == "the serif is warmer"
    assert decisions.quote_or_none("the serif feels warmer", message) is None  # a paraphrase
    assert decisions.quote_or_none("  ", message) is None
    assert decisions.quote_or_none(None, message) is None


def test_records_fit_the_schema_and_a_why_needs_its_source(tmp_path):
    file = tmp_path / decisions.FILE
    r = decisions.append(file, project="p", kind="pick", topic="type", subject={"page": "index.html"},
                         chose="Fraunces", over=["Inter"], why="warmer", why_source="chat", context=CONTEXT)
    jsonschema.validate(r, SCHEMA)
    assert decisions.read(file) == [r]
    with pytest.raises(ValueError):
        decisions.append(file, project="p", kind="pick", topic="type", subject={}, chose="x",
                         why="warmer", context=CONTEXT)
    with pytest.raises(ValueError):
        decisions.append(file, project="p", kind="liked", topic="type", subject={}, chose="x", context=CONTEXT)
    with pytest.raises(jsonschema.ValidationError):  # an override must say what it replaced
        jsonschema.validate({**r, "kind": "override"}, SCHEMA)


def test_edits_in_one_turn_coalesce_and_a_new_turn_starts_fresh(tmp_path):
    file = tmp_path / decisions.FILE
    args = dict(project="p", context=CONTEXT, page="index.html", selector="h1", prop="color")
    first = decisions.override(file, 0, before="rgb(0, 0, 0)", after="red", **args)
    second = decisions.override(file, 0, before="red", after="blue", **args)
    assert second["supersedes"] == first["id"] and second["from"] == "rgb(0, 0, 0)"
    assert second["topic"] == "color"
    # Back at the original value: recorded as a no-op that supersedes, so the pass drops both.
    back = decisions.override(file, 0, before="blue", after="rgb(0, 0, 0)", **args)
    assert back["chose"] == back["from"] == "rgb(0, 0, 0)"
    # A change with nothing earlier in the turn and no difference logs nothing.
    assert decisions.override(file, 3, before="red", after="red", **args) is None
    # After the turn mark, the same element starts a fresh record.
    fresh = decisions.override(file, 3, before="rgb(0, 0, 0)", after="green", **args)
    assert fresh["supersedes"] is None


def test_a_reason_added_later_supersedes_and_is_rexs_words(tmp_path):
    file = tmp_path / decisions.FILE
    r = decisions.append(file, project="p", kind="reject", topic="other", subject={"page": None},
                         chose="abc", over=["def"], context=CONTEXT)
    [again] = decisions.add_why(file, [r["id"], "d-nope"], "  too busy  ")
    assert again["why"] == "too busy" and again["why_source"] == "studio" and again["supersedes"] == r["id"]
    assert decisions.add_why(file, [r["id"]], "   ") == []


def test_topic_for_css_properties():
    assert decisions.topic_for("font-family") == "type"
    assert decisions.topic_for("padding-top") == "spacing"
    assert decisions.topic_for("translate") == "layout"
    assert decisions.topic_for("mask-image") == "other"


def test_palette_meta_content_reads_either_attribute_order():
    assert palette.meta_content('<meta name="palette" content="wada:006">') == "wada:006"
    assert palette.meta_content("<meta content='wada:112' name='palette'>") == "wada:112"
    assert palette.meta_content('<meta name="viewport" content="width=device-width">') is None


# ---- what the studio logs ----

def test_answers_to_questions_are_picks_and_silence_is_not(client, fake_engine):
    slug = new_design(client, fake_engine, turns=2)
    answers = [
        {"question": "Type?", "options": ["Serif", "Sans"], "chose": ["Serif"], "other": "warmer for a bakery",
         "topic": "type"},
        {"question": "Density?", "options": ["Airy", "Dense"], "chose": [], "other": "somewhere between"},
        {"question": "Audience?", "options": ["Locals", "Tourists"], "chose": [], "other": ""},
        {"question": "Main action?", "options": [], "chose": [], "other": "Order a cake"},
    ]
    client.post(f"/api/projects/{slug}/chat", json={"message": "Answers to your questions: ...",
                                                     "answers": answers})
    picks = logged(slug)
    assert [(p["subject"]["question"], p["chose"], p["over"], p["why"]) for p in picks] == [
        ("Type?", "Serif", ["Sans"], "warmer for a bakery"),
        ("Density?", "somewhere between", ["Airy", "Dense"], None),
    ]
    assert picks[0]["topic"] == "type" and picks[0]["why_source"] == "answer"
    assert picks[1]["topic"] == "other"
    assert picks[0]["context"]["palette"] == "wada:006"


def test_a_restore_is_one_reject_over_the_versions_restored_away(client, fake_engine):
    fake_engine([({"index.html": "v1"}, [say(), done()]), ({"index.html": "v2"}, [say(), done()]),
                 ({"index.html": "v3"}, [say(), done()])])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    for m in ("one", "two", "three"):
        client.post(f"/api/projects/{slug}/chat", json={"message": m})
    first, second, third = [v["sha"] for v in client.get(f"/api/projects/{slug}/versions").json()]
    res = client.post(f"/api/projects/{slug}/restore", json={"sha": first}).json()
    [reject] = logged(slug)
    assert res["decisions"] == [reject["id"]]
    assert (reject["kind"], reject["chose"], reject["over"]) == ("reject", first, [second, third])

    why = client.post(f"/api/projects/{slug}/decisions/why", json={"ids": res["decisions"], "why": "v1 was calmer"})
    assert why.json()[0]["why"] == "v1 was calmer"
    assert client.post(f"/api/projects/{slug}/decisions/why", json={"ids": [], "why": " "}).status_code == 400
    assert [r["supersedes"] for r in client.get(f"/api/projects/{slug}/decisions").json()] == [None, reject["id"]]


def test_edit_mode_saves_are_overrides_with_from_coalesced_per_turn(client, fake_engine):
    slug = new_design(client, fake_engine, turns=2)
    body = {"styles": {"index.html": {"h1": {"color": "#ff0000"}}}, "before": {"index.html": {"h1": {"color": "rgb(0, 0, 0)"}}}}
    first = client.post(f"/api/projects/{slug}/edits", json=body).json()["decisions"]
    body["styles"]["index.html"]["h1"]["color"] = "#0000ff"
    second = client.post(f"/api/projects/{slug}/edits", json=body).json()["decisions"]
    a, b = logged(slug)
    assert [a["id"]] == first and [b["id"]] == second
    assert (b["from"], b["chose"], b["supersedes"]) == ("rgb(0, 0, 0)", "#0000ff", a["id"])
    assert b["subject"] == {"page": "index.html", "selector": "h1", "property": "color"}

    client.post(f"/api/projects/{slug}/chat", json={"message": "next"})  # a new turn
    body["styles"]["index.html"]["h1"]["color"] = "#00ff00"
    client.post(f"/api/projects/{slug}/edits", json=body)
    assert logged(slug)[-1]["supersedes"] is None

    text = client.post(f"/api/projects/{slug}/edits", json={
        "texts": [{"selector": "h1", "before": "Hi", "after": "Hello", "page": "index.html"}]}).json()
    last = logged(slug)[-1]
    assert text["decisions"] == [last["id"]]
    assert (last["topic"], last["from"], last["chose"], last["subject"]["property"]) == ("copy", "Hi", "Hello", "text")


def test_kept_tweaks_are_overrides_of_their_old_defaults(client, fake_engine):
    slug = new_design(client, fake_engine)
    res = client.post(f"/api/projects/{slug}/tweaks", json={"values": {"--accent": "#ff0000", "--nope": "1"}}).json()
    [r] = logged(slug)
    assert res["decisions"] == [r["id"]]
    assert (r["topic"], r["from"], r["chose"], r["subject"]) == (
        "color", "#c2410c", "#ff0000", {"page": "index.html", "property": "--accent"})


def test_choosing_a_design_system_is_a_pick_over_the_others(client, fake_engine):
    slug = new_design(client, fake_engine)
    systems = [client.post("/api/projects", json={"name": n, "kind": "design-system", "source": ""}).json()["slug"]
               for n in ("Calm", "Loud")]
    res = client.put(f"/api/projects/{slug}/design-system", json={"design_system": systems[0]}).json()
    [r] = logged(slug)
    assert res["decisions"] == [r["id"]]
    assert (r["kind"], r["chose"], r["over"]) == ("pick", systems[0], systems[1:])
    assert r["context"]["design_system"] == systems[0]


def test_the_agent_gets_what_log_decision_needs(client, fake_engine):
    slug = new_design(client, fake_engine)
    import app.server as server
    env = server.turn_options(projects.get(slug)).mcp_env
    assert env["PM_DECISIONS_FILE"] == str(decisions.path(projects.data_dir(slug)))
    assert env["PM_CHAT_FILE"].endswith("chat.jsonl") and env["PM_PROJECT_SLUG"] == slug
    assert json.loads(env["PM_DECISION_CONTEXT"])["palette"] == "wada:006"


def test_design_guides_elicitation_records_fit_the_same_schema(tmp_path):
    """design-guide writes its own A/B answers as v1 records (its redesign gate, section 5), with two
    optional fields the studio never writes: subject.scenario and via."""
    record = {"v": 1, "id": "d-20261008-010203-abcd", "at": "2026-10-08T01:02:03Z", "project": "elicitation",
              "kind": "pick", "topic": "layout", "subject": {"page": None, "scenario": "signup-form"},
              "chose": "top-aligned-labels", "over": ["left-aligned-labels"], "why": "scans faster",
              "why_source": "answer", "rule": "label-placement", "floor": False, "dismissed": False,
              "context": {"kind": "design", "design_system": None, "palette": None, "version": None, "rulebook": None},
              "supersedes": None, "via": "elicited"}
    jsonschema.validate(record, SCHEMA)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**record, "via": "guessed"}, SCHEMA)
    studio = decisions.append(tmp_path / decisions.FILE, project="p", kind="pick", topic="type", subject={"page": None},
                              chose="a", over=["b"], context=CONTEXT)
    assert "via" not in studio and "scenario" not in studio["subject"]
