import json
from pathlib import Path

from app import engine, projects, server, workspace
from tests.conftest import ask, done, result, say, tool


def sse_events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def new_project(client, name="p"):
    return client.post("/api/projects", json={"name": name}).json()["slug"]


def test_project_crud(client):
    slug = new_project(client, "My Page")
    assert [p["slug"] for p in client.get("/api/projects").json()] == [slug]
    assert client.get(f"/api/projects/{slug}").json()["versions"] == []
    assert client.post(f"/api/projects/{slug}/duplicate").status_code == 200
    assert client.delete(f"/api/projects/{slug}").status_code == 200
    assert client.get(f"/api/projects/{slug}").status_code == 404


def test_project_file_serving_blocks_traversal(client):
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text("<p>hi</p>")
    res = client.get(f"/p/{slug}/index.html")
    assert res.text == "<p>hi</p>"
    assert res.headers["access-control-allow-origin"] == "*"
    assert client.get(f"/p/{slug}/..%2F..%2Fdata%2F{slug}%2Fmeta.json").status_code == 404


def test_chat_rejects_empty_message(client):
    slug = new_project(client)
    assert client.post(f"/api/projects/{slug}/chat", json={"message": "  "}).status_code == 400


def test_chat_turn_streams_logs_and_commits(client, fake_engine):
    fake_engine([({"index.html": "<h1>v1</h1>"},
                  [tool("Write"), tool(engine.VERIFY_TOOL, "t2"), {"type": "text", "text": "Built."},
                   done("sess-1")])])
    slug = new_project(client)
    events = sse_events(client.post(f"/api/projects/{slug}/chat", json={"message": "make a page"}))

    # design-guide's gate runs once on the page the turn wrote (docs/gate-rulebook.md).
    assert [e["type"] for e in events] == ["tool", "tool", "text", "done", "findings", "version"]
    project = client.get(f"/api/projects/{slug}").json()
    assert project["session_id"] == "sess-1"
    assert [e["type"] for e in project["chat"]] == ["user", "tool", "tool", "text", "done", "findings"]
    assert [v["message"] for v in project["versions"]] == ["make a page"]


def test_project_carries_running_cost_and_tokens(client, fake_engine):
    tokens = {"input": 10, "output": 200, "cache_read": 5000, "cache_write": 300}
    fake_engine([({}, [say(), {**done(), "tokens": tokens}]), ({}, [say(), {**done(), "cost_usd": 0.25}])])
    slug = new_project(client)
    assert client.get(f"/api/projects/{slug}").json()["usage"]["turns"] == 0
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    usage = client.get(f"/api/projects/{slug}").json()["usage"]
    assert usage == {"turns": 2, "cost_usd": 0.35, "input": 10, "output": 200, "cache_read": 5000,
                     "cache_write": 300}


def test_local_model_turns_stay_out_of_the_total():
    from app.server import usage_total
    chat = [{"type": "done", "cost_usd": 0.5, "local": True, "tokens": {"input": 9}},
            {"type": "done", "cost_usd": 0.2}, {"type": "text", "text": "x"}]
    assert usage_total(chat)["turns"] == 1 and usage_total(chat)["cost_usd"] == 0.2


def test_wada_palettes_route(client):
    combos = client.get("/api/palettes/wada").json()
    assert len(combos) == 348
    assert {c["hex"] for c in combos["6"]["colors"]} == {"#f48067", "#051230"}
    assert combos["6"]["harmony"] == "contrast-tone" and combos["6"]["value"] == "light-and-dark"
    assert combos["6"]["text_contrast"] == 7.2
    assert all({"harmony", "value", "strength", "text_contrast"} <= set(c) for c in combos.values())


def test_technique_library_gallery_and_systems_are_served(client):
    gallery = client.get("/creative-library/")
    assert gallery.status_code == 200 and "<title>creative-library</title>" in gallery.text
    assert client.get("/creative-library/recipes/web/manifest.json").json()["components"]
    # The gallery's brand systems: the workspace's own design-systems/ (app/workspace.py).
    [mount] = [r for r in server.app.routes if getattr(r, "name", None) == "design-systems"]
    assert Path(mount.app.directory) == workspace.resolve()[0] / "design-systems"


def test_second_turn_resumes_session(client, fake_engine):
    eng = fake_engine([({}, [say(), done("sess-1")]), ({}, [say(), done("sess-1")])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    assert eng.prompts[0]["resume"] is False
    assert eng.prompts[1] == {"prompt": "two", "session_id": "sess-1", "resume": True}


def test_unverified_write_triggers_one_verify_nudge(client, fake_engine):
    eng = fake_engine([
        ({"index.html": "a"}, [tool("Write"), done()]),
        ({"index.html": "b"}, [tool("Edit"), done()]),  # still unverified: no second nudge
    ])
    slug = new_project(client)
    events = sse_events(client.post(f"/api/projects/{slug}/chat", json={"message": "go"}))

    assert [e["type"] for e in events] == ["tool", "done", "note", "tool", "done", "findings", "version"]
    assert eng.prompts[1]["prompt"] == engine.VERIFY_NUDGE
    assert eng.prompts[1]["resume"] is True
    assert len(projects.list_versions(slug)) == 1  # one version per user turn, not per run


def test_failed_turn_is_not_nudged(client, fake_engine):
    eng = fake_engine([({"index.html": "a"}, [tool("Write"), done(is_error=True)])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert len(eng.prompts) == 1


def test_versions_preview_and_restore(client, fake_engine):
    fake_engine([({"index.html": "v1"}, [say(), done()]), ({"index.html": "v2"}, [say(), done()]),
                 ({}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    first, second = client.get(f"/api/projects/{slug}/versions").json()

    res = client.get(f"/v/{slug}/{first['sha']}/index.html")
    assert res.text == "v1"
    assert res.headers["content-type"].startswith("text/html")
    assert client.get(f"/v/{slug}/{first['sha']}/nope.html").status_code == 404

    assert client.post(f"/api/projects/{slug}/restore", json={"sha": first["sha"]}).status_code == 200
    assert client.get(f"/p/{slug}/index.html").text == "v1"
    assert client.post(f"/api/projects/{slug}/restore", json={"sha": "abc123"}).status_code == 404

    # The next prompt carries a note so the agent re-reads the restored files.
    client.post(f"/api/projects/{slug}/chat", json={"message": "three"})
    import app.server as server
    assert server.engine.prompts[-1]["prompt"].startswith("(Note from the app: the user restored")
    assert server.engine.prompts[-1]["prompt"].endswith("three")
    assert projects.get(slug)["pending_note"] is None


def test_restore_blocked_while_running(client, fake_engine):
    eng = fake_engine([({"index.html": "v1"}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    sha = projects.list_versions(slug)[0]["sha"]
    eng.running.add(slug)
    assert client.post(f"/api/projects/{slug}/restore", json={"sha": sha}).status_code == 409


# ---------- Milestone 3: comments, tweaks, canvas bridge ----------

TWEAK_PAGE = ('<html><head><script type="application/json" id="tweaks">'
              '[{"name": "--accent", "type": "color", "value": "#000000"}]</script></head>'
              '<body><h1>Hi</h1></body></html>')


def add_comment(client, slug, note="Bigger", selector="h1"):
    return client.post(f"/api/projects/{slug}/comments",
                       json={"selector": selector, "tag": "h1", "element_text": "Hi", "note": note})


def test_comment_routes(client):
    slug = new_project(client)
    c = add_comment(client, slug).json()
    assert add_comment(client, slug, note="  ").status_code == 400
    assert [x["id"] for x in client.get(f"/api/projects/{slug}/comments").json()] == [c["id"]]
    assert client.get(f"/api/projects/{slug}").json()["comments"][0]["note"] == "Bigger"
    assert client.delete(f"/api/projects/{slug}/comments/{c['id']}").status_code == 200
    assert client.delete(f"/api/projects/{slug}/comments/{c['id']}").status_code == 404
    assert client.get(f"/api/projects/{slug}/comments").json() == []


def test_open_comments_are_sent_with_the_message(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    slug = new_project(client)
    c = add_comment(client, slug).json()
    client.post(f"/api/projects/{slug}/chat", json={"message": "Also make it blue"})

    prompt = eng.prompts[0]["prompt"]
    assert prompt.startswith("Also make it blue\n\nOpen comments")
    assert f"[{c['id']}] on `h1`" in prompt
    assert eng.options.mcp_env["PM_COMMENTS_FILE"] == str(projects.comments_path(slug))
    logged = projects.read_chat(slug)[0]
    assert logged["type"] == "user" and logged["comments"][0]["id"] == c["id"]


def test_comments_only_message_is_allowed(client, fake_engine):
    eng = fake_engine([({"index.html": "x"}, [say(), done()])])
    slug = new_project(client)
    add_comment(client, slug)
    assert client.post(f"/api/projects/{slug}/chat", json={"message": ""}).status_code == 200
    assert eng.prompts[0]["prompt"].startswith("Please address the open comments.")
    assert projects.list_versions(slug)[0]["message"] == "Addressed comments"


def test_unresolved_comments_stay_open_after_a_turn(client, fake_engine):
    fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    slug = new_project(client)
    c = add_comment(client, slug).json()
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert [x["id"] for x in client.get(f"/api/projects/{slug}/comments").json()] == [c["id"]]


def test_build_prompt_order():
    from app.server import build_prompt
    comment = {"id": "c1", "selector": "h1", "tag": "h1", "element_text": "", "note": "n"}
    prompt = build_prompt("msg", "(Note from the app: x)", [comment])
    assert prompt.index("(Note from the app") < prompt.index("msg") < prompt.index("[c1]")
    assert build_prompt("msg", None, []) == "msg"


def test_bridge_is_injected_only_for_the_canvas(client, fake_engine):
    fake_engine([({"index.html": "<html><body><p>x</p></body></html>", "a.css": "p{}"}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    sha = projects.list_versions(slug)[0]["sha"]
    from app.server import bridge_tag
    tag = bridge_tag()  # versioned by content, so an edited bridge reaches the canvas

    assert client.get(f"/canvas/{slug}/index.html").text == f"<html><body><p>x</p>{tag}</body></html>"
    assert tag not in client.get(f"/p/{slug}/index.html").text
    assert tag not in client.get(f"/v/{slug}/{sha}/index.html").text
    assert tag in client.get(f"/canvas-version/{slug}/{sha}/index.html").text
    assert client.get(f"/canvas/{slug}/a.css").text == "p{}"  # only HTML
    assert client.get("/static/canvas-bridge.js").status_code == 200


def test_canvas_follows_pages_and_falls_back_to_the_entry(client, fake_engine):
    # Every page under /canvas/ gets the bridge, so a link to another page keeps the
    # studio's tools working there. A missing page (deleted, or not in that version)
    # goes to the entry page instead of an error.
    fake_engine([({"index.html": "<body><a href='pricing.html'>p</a></body>",
                   "pricing.html": "<body>Pricing</body>"}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    sha = projects.list_versions(slug)[0]["sha"]
    from app.server import bridge_tag
    tag = bridge_tag()  # versioned by content, so an edited bridge reaches the canvas
    assert tag in client.get(f"/canvas/{slug}/pricing.html").text
    gone = client.get(f"/canvas/{slug}/old.html", follow_redirects=False)
    assert gone.status_code == 307 and gone.headers["location"] == f"/canvas/{slug}/index.html"
    gone = client.get(f"/canvas-version/{slug}/{sha}/new.html", follow_redirects=False)
    assert gone.headers["location"] == f"/canvas-version/{slug}/{sha}/index.html"
    assert client.get(f"/canvas/{slug}/missing.css").status_code == 404


def test_comments_and_tweaks_know_their_page(client):
    slug = new_project(client)
    (projects.design_dir(slug) / "pricing.html").write_text(
        '<script type="application/json" id="tweaks">[{"name": "--r", "type": "range", "value": 1}]</script>')
    c = client.post(f"/api/projects/{slug}/comments", json={
        "selector": "h1", "tag": "h1", "note": "Bigger", "page": "pricing.html"}).json()
    assert c["page"] == "pricing.html"
    from app.comments import prompt_block
    assert f"[{c['id']}] on `h1` in pricing.html" in prompt_block([c])
    assert client.post(f"/api/projects/{slug}/tweaks",
                       json={"values": {"--r": 5}, "page": "pricing.html"}).status_code == 200
    assert '"value": 5' in (projects.design_dir(slug) / "pricing.html").read_text()
    assert client.post(f"/api/projects/{slug}/tweaks",
                       json={"values": {"--r": 5}, "page": "../x.html"}).status_code == 400


def test_bridge_is_appended_when_there_is_no_body_tag():
    from app.server import bridge_tag, with_bridge
    assert with_bridge(b"<p>x</p>") == f"<p>x</p>{bridge_tag()}".encode()
    assert bridge_tag().startswith('<script src="/static/canvas-bridge.js?v=')


def test_keep_tweaks_rewrites_defaults_commits_and_notes(client, fake_engine):
    fake_engine([({"index.html": TWEAK_PAGE}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})

    res = client.post(f"/api/projects/{slug}/tweaks", json={"values": {"--accent": "#ff0000"}})
    assert res.status_code == 200
    assert '"value": "#ff0000"' in (projects.design_dir(slug) / "index.html").read_text()
    assert projects.list_versions(slug)[-1]["message"] == "Kept tweak values"
    assert "tweaks block" in projects.get(slug)["pending_note"]


def test_keep_tweaks_without_block_is_400(client, fake_engine):
    fake_engine([({"index.html": "<html></html>"}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert client.post(f"/api/projects/{slug}/tweaks", json={"values": {"x": 1}}).status_code == 400
    empty = new_project(client, "empty")
    assert client.post(f"/api/projects/{empty}/tweaks", json={"values": {"x": 1}}).status_code == 400


def test_notes_accumulate_until_next_message(client, fake_engine):
    eng = fake_engine([({"index.html": TWEAK_PAGE}, [say(), done()]), ({}, [say(), done()]), ({}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    first = projects.list_versions(slug)[0]["sha"]
    client.post(f"/api/projects/{slug}/tweaks", json={"values": {"--accent": "#ff0000"}})
    client.post(f"/api/projects/{slug}/restore", json={"sha": first})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    prompt = eng.prompts[-1]["prompt"]
    assert "tweaks block" in prompt and "restored the design" in prompt
    client.post(f"/api/projects/{slug}/chat", json={"message": "three"})
    assert eng.prompts[-1]["prompt"] == "three"


# ---------- Milestone 4: export ----------

def test_export_formats(client, fake_engine):
    fake_engine([({"index.html": '<html><head><link rel="stylesheet" href="s.css"></head>'
                                 '<body><h1>Hi</h1></body></html>', "s.css": "h1{color:red}"}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})

    html = client.get(f"/api/projects/{slug}/export/html")
    assert "h1{color:red}" in html.text
    assert html.headers["content-disposition"] == f'attachment; filename="{slug}.html"'
    assert client.get(f"/api/projects/{slug}/export/png").content.startswith(b"\x89PNG")
    assert client.get(f"/api/projects/{slug}/export/pdf").content.startswith(b"%PDF")
    assert client.get(f"/api/projects/{slug}/export/zip").content.startswith(b"PK")
    assert client.get(f"/api/projects/{slug}/export/exe").status_code == 404


def test_export_before_any_design_is_404_except_zip(client):
    slug = new_project(client)
    assert client.get(f"/api/projects/{slug}/export/html").status_code == 404
    assert client.get(f"/api/projects/{slug}/export/zip").status_code == 200


def test_empty_turn_gets_one_nudge_then_verify_nudge(client, fake_engine):
    eng = fake_engine([
        ({}, [done()]),                                   # empty: model produced nothing
        ({"index.html": "x"}, [tool("Write"), done()]),   # acted, but did not verify
        ({}, [tool(engine.VERIFY_TOOL, "t2"), done()]),
    ])
    slug = new_project(client)
    events = sse_events(client.post(f"/api/projects/{slug}/chat", json={"message": "go"}))
    notes = [e["text"] for e in events if e["type"] == "note"]
    assert len(notes) == 2 and "empty" in notes[0] and "check" in notes[1]
    assert [p["prompt"] for p in eng.prompts[1:]] == [engine.EMPTY_NUDGE, engine.VERIFY_NUDGE]


def test_empty_turn_is_nudged_only_once(client, fake_engine):
    eng = fake_engine([({}, [done()]), ({}, [done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert len(eng.prompts) == 2


def test_branch_route(client):
    slug = new_project(client, "Home page")
    (projects.design_dir(slug) / "index.html").write_text("v1")
    sha = projects.commit_version(slug, "one")
    res = client.post(f"/api/projects/{slug}/branch", json={"sha": sha})
    assert res.status_code == 200 and res.json()["name"] == "Home page (branch)"
    assert (projects.design_dir(res.json()["slug"]) / "index.html").read_text() == "v1"
    assert client.post(f"/api/projects/{slug}/branch", json={"sha": "abc123"}).status_code == 404


def test_connectors_are_stored_chosen_per_project_and_given_to_the_agent(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    linear = {"type": "http", "url": "https://mcp.linear.app/mcp"}
    assert client.put("/api/connectors/linear", json={"config": linear}).json() == {
        "name": "linear", "target": "https://mcp.linear.app/mcp"}
    client.put("/api/connectors/drive", json={"config": {"command": "drive-mcp", "args": ["--ro"]}})
    for name, config in (("pm", {"command": "x"}), ("bad name", {"command": "x"}), ("ok", {"nope": 1})):
        assert client.put(f"/api/connectors/{name}", json={"config": config}).status_code == 400
    assert client.get("/api/connectors").json() == [
        {"name": "linear", "target": "https://mcp.linear.app/mcp"}, {"name": "drive", "target": "drive-mcp --ro"}]

    slug = new_project(client)
    assert client.put(f"/api/projects/{slug}/connectors", json={"names": ["nope"]}).status_code == 404
    assert client.put(f"/api/projects/{slug}/connectors", json={"names": ["linear"]}).json()["connectors"] == ["linear"]
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert eng.options.connectors == {"linear": linear}

    # A removed connector drops out of every project's turns.
    assert client.delete("/api/connectors/linear").status_code == 200
    assert client.delete("/api/connectors/linear").status_code == 404
    from app.server import turn_options
    assert turn_options(projects.get(slug)).connectors == {}


QUESTIONS = [{"text": "Who is it for?", "options": ["Owners", "Accountants"]}, {"text": "What is the main action?"}]


def test_accepted_questions_become_a_questions_event(client, fake_engine):
    fake_engine([({}, [ask(QUESTIONS), result(), say("A few questions first."), done()])])
    slug = new_project(client)
    body = client.post(f"/api/projects/{slug}/chat", json={"message": "a pricing page"}).text
    streamed = [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ")]
    assert {"type": "questions", "questions": QUESTIONS} in streamed
    logged = projects.read_chat(slug)
    assert [e["type"] for e in logged] == ["user", "tool", "tool_result", "questions", "text", "done"]
    assert "questions" not in logged[1]  # kept once, in the questions event


def test_rejected_questions_are_not_shown(client, fake_engine):
    fake_engine([({}, [ask([]), result(is_error=True), say("Building."), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert "questions" not in [e["type"] for e in projects.read_chat(slug)]


def test_only_the_chosen_comments_are_sent(client, fake_engine):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    slug = new_project(client)
    a = client.post(f"/api/projects/{slug}/comments", json={"selector": "h1", "tag": "h1", "note": "Bigger"}).json()
    b = client.post(f"/api/projects/{slug}/comments", json={"selector": "p", "tag": "p", "note": "Shorter"}).json()
    client.post(f"/api/projects/{slug}/chat", json={"message": "go", "comment_ids": [b["id"]]})
    assert "Shorter" in eng.prompts[0]["prompt"] and "Bigger" not in eng.prompts[0]["prompt"]
    assert [c["id"] for c in projects.read_chat(slug)[0]["comments"]] == [b["id"]]
    assert {c["id"] for c in client.get(f"/api/projects/{slug}/comments").json()} == {a["id"], b["id"]}  # still open
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})  # no choice given: all of them
    assert "Bigger" in eng.prompts[1]["prompt"] and "Shorter" in eng.prompts[1]["prompt"]



def test_project_list_carries_what_a_home_card_shows(client):
    slug = new_project(client, "Carded")
    (projects.design_dir(slug) / "index.html").write_text('<meta name="palette" content="wada:006"><h1>Hi</h1>')
    projects.append_chat(slug, {"type": "findings", "rulebook": "v", "pages": ["index.html"], "errors": [],
                                "exceptions": [], "findings": [{"rule": "a", "blocking": True}, {"rule": "b", "blocking": False}]})
    [card] = [p for p in client.get("/api/projects").json() if p["slug"] == slug]
    assert card["palette"] == "wada:006" and card["findings"] == {"count": 2, "blocking": 1}
    assert card["approved"] is None
    other = new_project(client, "Plain")
    [plain] = [p for p in client.get("/api/projects").json() if p["slug"] == other]
    assert plain["palette"] is None and plain["findings"] is None



def test_the_page_versions_its_assets_so_a_browser_never_mixes_old_and_new(client):
    import hashlib
    from app.server import STATIC_DIR
    res = client.get("/")
    assert res.headers["cache-control"] == "no-cache"
    digest = hashlib.sha1((STATIC_DIR / "style.css").read_bytes()).hexdigest()[:10]
    assert f'href="/static/style.css?v={digest}"' in res.text
    assert '/static/app.js?v=' in res.text and '"/static/app.js"' not in res.text
    assert client.get(f"/static/style.css?v={digest}").status_code == 200



def test_plan_first_asks_for_a_plan_and_an_approved_plan_builds(client, fake_engine):
    from tests.conftest import plan
    from app.server import PLAN_NOTE
    engine = fake_engine([
        ({}, [plan("A pricing page", ["Hero", "Plans"]), result("p1"), say("Here is my plan."), done()]),
        ({"index.html": "<h1>Pricing</h1>"}, [say("Built."), done()]),
    ])
    slug = new_project(client)
    assert projects.get(slug)["plan_first"] is False
    assert client.put(f"/api/projects/{slug}/plan-first", json={"on": True}).json()["plan_first"] is True

    body = client.post(f"/api/projects/{slug}/chat", json={"message": "a pricing page"}).text
    streamed = [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ")]
    assert {"type": "plan", "summary": "A pricing page", "steps": ["Hero", "Plans"]} in streamed
    assert engine.prompts[0]["prompt"].startswith(PLAN_NOTE)
    assert "plan" not in projects.read_chat(slug)[1]  # kept once, in the plan event

    client.post(f"/api/projects/{slug}/chat",
                json={"message": "Build this plan:\n1. Hero\n2. Plans and FAQ", "plan": ["Hero", "Plans and FAQ"]})
    assert PLAN_NOTE not in engine.prompts[1]["prompt"]  # approved: build it
    assert "2. Plans and FAQ" in engine.prompts[1]["prompt"]
