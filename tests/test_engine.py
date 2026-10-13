import asyncio
import json
from pathlib import Path

from app import engine
from tests.conftest import done, tool


def test_normalize_assistant_and_tool_events():
    cwd = Path("/work/proj")
    assistant = {"type": "assistant", "message": {"content": [
        {"type": "text", "text": "Building it."},
        {"type": "tool_use", "id": "t1", "name": "Write",
         "input": {"file_path": "/work/proj/index.html", "content": "..."}},
        {"type": "tool_use", "id": "t2", "name": "mcp__pm__verify", "input": {"path": "index.html"}},
    ]}}
    assert engine.normalize(assistant, cwd) == [
        {"type": "text", "text": "Building it."},
        {"type": "tool", "id": "t1", "name": "Write", "summary": "Write index.html"},
        {"type": "tool", "id": "t2", "name": "mcp__pm__verify", "summary": "verify index.html"},
    ]


def test_ask_questions_carries_its_questions():
    qs = [{"text": "Who is it for?", "options": ["Owners", "Accountants"]}]
    raw = {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "q1", "name": "mcp__pm__ask_questions", "input": {"questions": qs}}]}}
    assert engine.normalize(raw, Path("/w")) == [
        {"type": "tool", "id": "q1", "name": "mcp__pm__ask_questions", "summary": "ask_questions", "questions": qs}]


def test_normalize_results_and_done():
    cwd = Path("/work/proj")
    result = {"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "t1", "is_error": True, "content": "boom"}]}}
    assert engine.normalize(result, cwd) == [{"type": "tool_result", "id": "t1", "is_error": True}]
    done = {"type": "result", "is_error": False, "total_cost_usd": 0.5, "session_id": "s"}
    assert engine.normalize(done, cwd) == [
        {"type": "done", "is_error": False, "cost_usd": 0.5, "session_id": "s"}]
    assert engine.normalize({"type": "system", "subtype": "init"}, cwd) == []


def test_done_carries_the_turns_token_counts():
    usage = {"input_tokens": 12, "output_tokens": 340, "cache_read_input_tokens": 51000,
             "cache_creation_input_tokens": 2100, "server_tool_use": {}}
    done = {"type": "result", "is_error": False, "total_cost_usd": 0.5, "session_id": "s", "usage": usage}
    [event] = engine.normalize(done, Path("/work"))
    assert event["tokens"] == {"input": 12, "output": 340, "cache_read": 51000, "cache_write": 2100}


def test_needs_verification():
    write, verify, read = tool("Write"), tool(engine.VERIFY_TOOL), tool("Read")
    assert not engine.needs_verification([])
    assert not engine.needs_verification([read])
    assert engine.needs_verification([write])
    assert not engine.needs_verification([write, verify])
    assert engine.needs_verification([write, verify, tool("Edit")])


def test_command_isolates_user_setup_and_allows_preview_tools(tmp_path):
    cmd = engine.ClaudeCodeEngine(model="m", effort="low").command(tmp_path, "sid", resume=True)
    assert cmd[cmd.index("--setting-sources") + 1] == ""
    assert "--strict-mcp-config" in cmd
    assert cmd[cmd.index("--allowedTools") + 1] == "mcp__pm"
    assert cmd[cmd.index("--resume") + 1] == "sid"
    config = json.loads(cmd[cmd.index("--mcp-config") + 1])["mcpServers"]["pm"]
    assert config["args"] == ["-m", "app.preview_mcp"]
    assert config["env"]["PM_PROJECT_DIR"] == str(tmp_path)


def test_command_passes_extra_mcp_env(tmp_path):
    cmd = engine.ClaudeCodeEngine(model="m", effort="low").command(
        tmp_path, "sid", resume=False,
        options=engine.TurnOptions(mcp_env={"PM_COMMENTS_FILE": "/x/comments.json"}))
    env = json.loads(cmd[cmd.index("--mcp-config") + 1])["mcpServers"]["pm"]["env"]
    assert env["PM_COMMENTS_FILE"] == "/x/comments.json"
    assert env["PM_PROJECT_DIR"] == str(tmp_path)


def test_connectors_join_the_mcp_config_and_allowed_tools(tmp_path):
    linear = {"type": "http", "url": "https://mcp.linear.app/mcp"}
    options = engine.TurnOptions(connectors={"linear": linear, "notes": {"command": "notes-mcp"}})
    cmd = engine.ClaudeCodeEngine(model="m").command(tmp_path, "sid", False, options)
    servers = json.loads(cmd[cmd.index("--mcp-config") + 1])["mcpServers"]
    assert servers["linear"] == linear and servers["notes"] == {"command": "notes-mcp"}
    assert servers["pm"]["args"] == ["-m", "app.preview_mcp"]
    assert cmd[cmd.index("--allowedTools") + 1] == "mcp__pm,mcp__linear,mcp__notes"


def test_stop_reports_stopped(tmp_path, monkeypatch):
    fake_cli = ["python3", "-c",
                "import json,time; print(json.dumps({'type':'assistant','message':{'content':"
                "[{'type':'text','text':'working'}]}}), flush=True); time.sleep(30)"]
    eng = engine.ClaudeCodeEngine(model="m", effort="low")
    monkeypatch.setattr(eng, "command", lambda cwd, session_id, resume, options=None: fake_cli)

    async def scenario():
        events = []
        async for event in eng.run("k", tmp_path, "hi", "s", False):
            events.append(event)
            if event["type"] == "text":
                assert eng.stop("k")
        return events

    events = asyncio.run(scenario())
    assert events[-1] == {"type": "error", "message": "Stopped."}
    assert not eng.is_running("k")


def test_cli_failure_surfaces_stderr(tmp_path, monkeypatch):
    fake_cli = ["python3", "-c", "import sys; sys.stderr.write('not logged in'); sys.exit(1)"]
    eng = engine.ClaudeCodeEngine(model="m", effort="low")
    monkeypatch.setattr(eng, "command", lambda cwd, session_id, resume, options=None: fake_cli)

    async def scenario():
        return [e async for e in eng.run("k", tmp_path, "hi", "s", False)]

    assert asyncio.run(scenario()) == [{"type": "error", "message": "not logged in"}]


def test_default_command_has_no_extra_dirs_and_uses_design_prompt(tmp_path):
    cmd = engine.ClaudeCodeEngine(model="m", effort="low").command(tmp_path, "sid", resume=False)
    assert "--add-dir" not in cmd and "--settings" not in cmd
    prompt = cmd[cmd.index("--system-prompt") + 1]
    assert prompt == engine.design_prompt() and "{library}" not in prompt
    # The prompt names real files in the library, so a move that breaks them fails here.
    shelf = f"{engine.LIBRARY_DIR}/skill/references/recipe-library-web.md"
    assert shelf in prompt and Path(shelf).is_file()
    assert (engine.LIBRARY_DIR / "recipes/web/manifest.json").is_file()


def test_read_only_dirs_are_added_with_write_denied(tmp_path):
    src = tmp_path / "src"
    options = engine.TurnOptions(system_prompt="EXTRACT", read_only_dirs=[src])
    cmd = engine.ClaudeCodeEngine(model="m", effort="low").command(tmp_path, "sid", False, options)
    assert cmd[cmd.index("--system-prompt") + 1] == "EXTRACT"
    assert cmd[cmd.index("--add-dir") + 1] == str(src)
    deny = json.loads(cmd[cmd.index("--settings") + 1])["permissions"]["deny"]
    # "//" prefix = absolute path in Claude Code permission rules (verified live 2026-09-18).
    assert deny == [f"Edit(/{src}/**)", f"Write(/{src}/**)"]


def test_summary_prefers_pattern_for_search_tools():
    cwd = Path("/work/proj")
    assert engine.summarize_tool("Glob", {"pattern": "**/*.css", "path": "/src"}, cwd) == "Glob **/*.css"
    assert engine.summarize_tool("Grep", {"pattern": "--color", "path": "/src"}, cwd) == "Grep --color"
    assert engine.summarize_tool("Read", {"file_path": "/src/a.css"}, cwd) == "Read /src/a.css"
    assert engine.summarize_tool("mcp__pm__verify", {}, cwd) == "verify"


def test_markdown_writes_do_not_need_verification():
    handoff = {"type": "tool", "id": "t1", "name": "Write", "summary": "Write HANDOFF.md"}
    assert not engine.needs_verification([handoff])
    assert engine.needs_verification([handoff, tool("Edit", "t2", "styles.css")])


def test_is_empty_turn():
    text = {"type": "text", "text": "hi"}
    assert engine.is_empty_turn([done()])
    assert engine.is_empty_turn([{"type": "tool_result", "id": "x", "is_error": False}, done()])
    assert not engine.is_empty_turn([text, done()])
    assert not engine.is_empty_turn([tool("Read"), done()])
    assert not engine.is_empty_turn([done(is_error=True)])  # errors are reported, not retried
    assert not engine.is_empty_turn([])  # stopped or crashed: no done event



def test_propose_plan_carries_its_plan():
    raw = {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "p1", "name": "mcp__pm__propose_plan",
         "input": {"summary": "A pricing page", "steps": ["Hero", "Plans"]}}]}}
    [event] = engine.normalize(raw, Path("/w"))
    assert event["plan"] == {"summary": "A pricing page", "steps": ["Hero", "Plans"]}
