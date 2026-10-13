"""Keeps the docs honest. Each check reads the real source of truth (routes, code, files)
and asserts the matching doc mentions it. When one fails, update the doc named in the
message; see the doc map in CLAUDE.md."""

import re
from pathlib import Path

from app import engine, server

ROOT = Path(__file__).resolve().parent.parent


def doc(name: str) -> str:
    return (ROOT / name).read_text()


def missing(items, text):
    return sorted(i for i in items if i not in text)


def test_every_route_is_in_architecture_doc():
    text = doc("docs/architecture.md")
    paths = {r.path.replace("{path:path}", "{path}") for r in server.app.routes
             if hasattr(r, "methods") and not r.path.startswith(("/docs", "/openapi", "/redoc"))}
    assert missing({f"`{p}`" for p in paths}, text) == [], "add these routes to docs/architecture.md"


def test_every_event_type_is_in_architecture_doc():
    text = doc("docs/architecture.md")
    sources = [ROOT / "app" / f for f in ("engine.py", "server.py")] + [ROOT / "static/app.js"]
    types = set()
    for path in sources:
        types |= set(re.findall(r'"type":\s*"(\w+)"', path.read_text()))
    # The studio's renderEvent switch names every event it draws. (Python `case` lines are
    # other matches, e.g. source kinds, so only the JS switch is read.)
    render = (ROOT / "static/app.js").read_text().split("function renderEvent", 1)[1].split("\n}\n", 1)[0]
    types |= set(re.findall(r'case "(\w+)":', render))
    assert types, "event type pattern no longer matches the code; fix this test"
    assert missing({f"| `{t}` |" for t in types}, text) == [], \
        "add these event types to the table in docs/architecture.md"


def test_every_module_is_in_architecture_doc():
    text = doc("docs/architecture.md")
    modules = {f"`app/{p.name}`" for p in (ROOT / "app").glob("*.py") if p.name != "__init__.py"}
    assert missing(modules, text) == [], "add these modules to docs/architecture.md"


def test_every_mcp_tool_is_in_agent_doc_and_prompt():
    tools = set(re.findall(r"@server\.tool\(\)\nasync def (\w+)",
                           (ROOT / "app/preview_mcp.py").read_text()))
    assert tools, "tool pattern no longer matches app/preview_mcp.py; fix this test"
    assert missing({f"`{t}(" for t in tools}, doc("docs/agent.md")) == []
    assert missing({f"`{t}`" for t in tools}, doc("app/prompts/system.md")) == []


def test_every_cli_flag_is_in_agent_doc():
    # read_only_dirs switches on the design-system flags, so every flag appears.
    options = engine.TurnOptions(read_only_dirs=[ROOT])
    cmd = engine.ClaudeCodeEngine(model="m", effort="low").command(ROOT, "sid", False, options)
    flags = {part for part in cmd if part.startswith("-")}
    assert missing(flags, doc("docs/agent.md")) == [], "explain these flags in docs/agent.md"


def test_every_test_file_is_in_testing_doc():
    files = {f"`tests/{p.name}`" for p in (ROOT / "tests").glob("*.py") if p.name != "__init__.py"}
    assert missing(files, doc("docs/testing.md")) == [], "describe these files in docs/testing.md"


def test_doc_map_files_exist():
    for name in re.findall(r"^\| `([^`]+\.md)` \|", doc("CLAUDE.md"), re.M):
        assert (ROOT / name).is_file(), f"CLAUDE.md doc map lists missing file {name}"
