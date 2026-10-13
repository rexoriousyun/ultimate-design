"""Starts app/preview_mcp.py exactly as Claude Code does (the engine's --mcp-config) and
calls its tools over stdio. Needs Chromium, like test_preview.py."""

import asyncio
import json

from mcp import ClientSession, StdioServerParameters, stdio_client

from app import comments, decisions, engine


def call(tmp_path, fn, extra_env=None):
    config = json.loads(engine.mcp_config(tmp_path, extra_env))["mcpServers"]["pm"]
    params = StdioServerParameters(command=config["command"], args=config["args"],
                                   env=config["env"], cwd=str(tmp_path))

    async def scenario():
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await fn(session)
    return asyncio.run(scenario())


def test_tools_are_listed(tmp_path):
    async def fn(session):
        return sorted(t.name for t in (await session.list_tools()).tools)
    # The system prompt and docs/agent.md describe exactly these tools.
    assert call(tmp_path, fn) == ["ask_questions", "eval_js", "log_decision", "propose_plan", "resolve_comment",
                                  "screenshot", "verify"]


def test_verify_returns_two_screenshots_and_reports(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title><script>boom()</script>")

    async def fn(session):
        return await session.call_tool("verify", {"path": "index.html"})
    result = call(tmp_path, fn)
    kinds = [c.type for c in result.content]
    assert kinds == ["text", "image", "text", "image"]
    assert result.content[0].text.startswith("Desktop 1440px: Uncaught exceptions:")
    assert "boom" in result.content[2].text


def test_eval_js(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>hello</title>")

    async def fn(session):
        return await session.call_tool("eval_js", {"expression": "document.title"})
    assert call(tmp_path, fn).content[0].text == '"hello"'


def test_resolve_comment_updates_the_comments_file(tmp_path):
    path = tmp_path / "data" / "comments.json"
    c = comments.add(path, "h1", "h1", "Hi", "Bigger")

    async def fn(session):
        ok = await session.call_tool("resolve_comment", {"comment_id": c["id"], "summary": "Now 48px"})
        missing = await session.call_tool("resolve_comment", {"comment_id": "zzz", "summary": "x"})
        return ok.content[0].text, missing.content[0].text
    assert call(tmp_path, fn, {"PM_COMMENTS_FILE": str(path)}) == (
        f"Resolved comment {c['id']}.", "No comment with id zzz.")
    assert comments.list_all(path)[0]["resolution"] == "Now 48px"
    assert comments.open_comments(path) == []


def test_text_only_mode_replaces_images_with_measurements(tmp_path):
    (tmp_path / "index.html").write_text(
        "<!doctype html><title>t</title><body style='margin:0'><div style='width:600px'>wide</div>")

    async def fn(session):
        return (await session.call_tool("verify", {"path": "index.html"}),
                await session.call_tool("screenshot", {"path": "index.html"}))
    verify, shot = call(tmp_path, fn, {"PM_NO_IMAGES": "1"})
    assert all(c.type == "text" for c in verify.content + shot.content)
    texts = [c.text for c in verify.content]
    assert '"horizontalOverflow": false' in texts[1]  # desktop 1440: 600px fits
    assert '"horizontalOverflow": true' in texts[3]   # mobile 390: 600px overflows
    assert texts[-1].startswith("Screenshots are off")


def test_verify_checks_hierarchy_when_the_server_asks(tmp_path):
    # The server sets PM_HIERARCHY for design projects (not for design-system specimens).
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title><h1>No marks</h1>")

    async def fn(session):
        return (await session.call_tool("verify", {"path": "index.html"})).content[0].text
    assert "data-priority" not in call(tmp_path, fn)
    assert "No data-priority marks" in call(tmp_path, fn, {"PM_HIERARCHY": "1"})


def test_ask_questions_validates_and_tells_the_agent_to_stop(tmp_path):
    async def fn(session):
        ok = await session.call_tool("ask_questions", {"questions": [
            {"text": "Who is it for?", "options": ["Owners", "Accountants"]}, {"text": "Main action?"}]})
        none = await session.call_tool("ask_questions", {"questions": []})
        many = await session.call_tool("ask_questions", {"questions": [{"text": "x", "options": list("abcdefg")}]})
        return ok, none, many
    ok, none, many = call(tmp_path, fn)
    assert not ok.is_error and "End your turn now without writing files" in ok.content[0].text
    assert none.is_error and "between 1 and 5 questions" in none.content[0].text
    assert many.is_error and "at most 6" in many.content[0].text


def test_log_decision_keeps_only_the_users_exact_words(tmp_path):
    chat = tmp_path / "chat.jsonl"
    chat.write_text(json.dumps({"type": "user", "text": "Go with B, the serif is warmer."}) + "\n"
                    + json.dumps({"type": "text", "text": "Building B."}) + "\n")
    log = tmp_path / "decisions.jsonl"
    env = {"PM_DECISIONS_FILE": str(log), "PM_CHAT_FILE": str(chat), "PM_PROJECT_SLUG": "bakery",
           "PM_DECISION_CONTEXT": json.dumps({"kind": "design", "design_system": None, "palette": "wada:006",
                                               "version": "abc", "rulebook": None})}

    async def fn(session):
        exact = await session.call_tool("log_decision", {
            "kind": "pick", "topic": "direction", "chose": "B · Warm editorial", "over": ["A · Dense"],
            "quote": "the serif is warmer", "page": "directions/b.html"})
        paraphrase = await session.call_tool("log_decision", {
            "kind": "pick", "topic": "type", "chose": "Serif", "over": ["Sans"], "quote": "serifs feel warmer"})
        bad = await session.call_tool("log_decision", {"kind": "pick", "topic": "vibes", "chose": "x"})
        reject = await session.call_tool("log_decision", {"kind": "reject", "topic": "direction"})
        return exact, paraphrase, bad, reject
    exact, paraphrase, bad, reject = call(tmp_path, fn, env)
    assert "with the user's reason" in exact.content[0].text
    assert "quote was not in their message" in paraphrase.content[0].text
    assert bad.is_error and "topic must be one of" in bad.content[0].text
    assert reject.is_error and "needs `over`" in reject.content[0].text
    first, second = decisions.read(log)
    assert (first["why"], first["why_source"], first["subject"]) == (
        "the serif is warmer", "chat", {"page": "directions/b.html"})
    assert (second["why"], second["why_source"]) == (None, None)
    assert first["project"] == "bakery" and first["context"]["palette"] == "wada:006"



def test_propose_plan_validates_and_tells_the_agent_to_stop(tmp_path):
    async def fn(session):
        ok = await session.call_tool("propose_plan", {"summary": "A pricing page", "steps": ["Hero", "Plans"]})
        empty = await session.call_tool("propose_plan", {"summary": "x", "steps": []})
        blank = await session.call_tool("propose_plan", {"summary": " ", "steps": ["a"]})
        return ok, empty, blank
    ok, empty, blank = call(tmp_path, fn)
    assert not ok.is_error and "End your turn now without writing files" in ok.content[0].text
    assert empty.is_error and "between 1 and 10" in empty.content[0].text
    assert blank.is_error and "summary" in blank.content[0].text
