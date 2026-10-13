"""The Claude Code link: app/claude_code_mcp.py started as Claude Code would start it
(stdio), talking to a real server (live_server) whose agent is FakeEngine."""

import asyncio
import sys

from mcp import ClientSession, StdioServerParameters, stdio_client

from app import engine, projects
from tests.conftest import ask, done, pause, result, say, tool


def call(base, tool_name=None, args=None, *, list_tools=False, env=None):
    # PM_AUTOSTART=0: a test never starts the real app; test_autostart uses a stand-in.
    params = StdioServerParameters(command=sys.executable, args=["-m", "app.claude_code_mcp"],
                                   env={"PM_URL": base, "PYTHONPATH": str(engine.REPO_ROOT),
                                        **(env if env is not None else {"PM_AUTOSTART": "0"})},
                                   cwd=str(engine.REPO_ROOT))

    async def scenario():
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                if list_tools:
                    return sorted(t.name for t in (await session.list_tools()).tools)
                return await session.call_tool(tool_name, args or {})
    return asyncio.run(scenario())


def text(result):
    return "\n".join(c.text for c in result.content if c.type == "text")


def test_tools(live_server):
    assert call(live_server, list_tools=True) == [
        "create_design", "get_design", "get_handoff", "list_designs", "send_message",
        "sync_design_system", "use_design_system", "wait_for_approval", "wait_for_turn"]


def test_create_with_prompt_runs_the_agent_and_links(live_server, fake_engine):
    eng = fake_engine([({"index.html": "<h1>Hi</h1>"}, [tool("Write"), tool(engine.VERIFY_TOOL, "t2"),
                                                         say("Built a hero."), done()])])
    out = text(call(live_server, "create_design", {"name": "Landing", "prompt": "a hero section"}))
    assert "Created Landing (slug landing)" in out and "Done. 2 steps, new version" in out
    assert "Agent's reply:\nBuilt a hero." in out and "projects/landing" in out
    assert eng.prompts[0]["prompt"] == "a hero section"
    assert projects.get("landing")["last_claude_code"] is not None


def test_send_message_by_name_and_unknown_project(live_server, fake_engine):
    eng = fake_engine([({"index.html": "x"}, [say("Changed."), done()])])
    projects.create("Pricing Page")
    out = text(call(live_server, "send_message", {"project": "pricing page", "message": "darker"}))
    assert "Changed." in out and eng.prompts[0]["prompt"] == "darker"
    missing = call(live_server, "send_message", {"project": "nope", "message": "x"})
    assert missing.is_error and "No project called 'nope'. Projects: Pricing Page" in text(missing)


def test_slow_turn_returns_early_then_wait_for_turn(live_server, fake_engine):
    fake_engine([({}, [say("Working."), pause(2), say("Finished."), done()])])
    projects.create("Slow")
    early = text(call(live_server, "send_message", {"project": "slow", "message": "go", "wait_seconds": 0}))
    assert "still running" in early
    later = text(call(live_server, "wait_for_turn", {"project": "slow"}))
    assert "Finished." in later
    idle = text(call(live_server, "wait_for_turn", {"project": "slow"}))
    assert idle.startswith("No turn is running. Last reply:\nFinished.")


def test_get_design_and_handoff(live_server):
    slug = projects.create("Checkout")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("<!doctype html><title>t</title><h1>Pay</h1>")
    (projects.design_dir(slug) / "HANDOFF.md").write_text("# Checkout\nOne screen.")
    projects.commit_version(slug, "first")
    design = call(live_server, "get_design", {"project": "Checkout"})
    assert [c.type for c in design.content] == ["text", "image"]
    assert "index.html" in text(design) and "latest: first" in text(design)
    handoff = text(call(live_server, "get_handoff", {"project": "checkout"}))
    assert "HANDOFF.md:\n# Checkout\nOne screen." in handoff and "/projects/checkout/index.html" in handoff


def test_sync_design_system_and_use_it(live_server, fake_engine, tmp_path):
    eng = fake_engine([({"README.md": "Use --brand.", "tokens.css": ":root{--brand:#123}"},
                        [tool("Write"), say("Extracted."), done()])])
    repo = tmp_path / "acme-app"
    repo.mkdir()
    out = text(call(live_server, "sync_design_system", {"source": str(repo)}))
    assert "Extracted." in out and "README.md:\nUse --brand." in out
    ds = projects.get("acme-app")
    assert ds["kind"] == "design-system" and eng.prompts[0]["prompt"].startswith("Extract")
    projects.create("Home")
    used = text(call(live_server, "use_design_system", {"project": "home", "design_system": "acme-app"}))
    assert "acme-app is attached to home" in used
    assert projects.get("home")["design_system"] == "acme-app"


def test_app_not_running():
    out = call("http://127.0.0.1:9", "list_designs")
    assert out.is_error and "not reachable" in text(out)


def test_questions_are_relayed_to_claude_code(live_server, fake_engine):
    fake_engine([({}, [ask([{"text": "Who is it for?", "options": ["Owners", "Accountants"]}]),
                       result(), say("Questions first."), done()])])
    projects.create("Asks")
    out = text(call(live_server, "send_message", {"project": "asks", "message": "a pricing page"}))
    assert "The design agent asked before building. Answer with send_message" in out
    assert "1. Who is it for? (options: Owners, Accountants)" in out


# ---- the plugin's additions: the studio starts itself, and the user approves there ----

import json  # noqa: E402
import socket  # noqa: E402
import urllib.request  # noqa: E402

# Answers every GET with an empty project list, then exits by itself (it is started detached).
FAKE_APP = ("import http.server,sys,threading\n"
            "class H(http.server.BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            "        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()\n"
            "        self.wfile.write(b'[]')\n"
            "    def log_message(self,*a): pass\n"
            "s=http.server.HTTPServer(('127.0.0.1',int(sys.argv[1])),H)\n"
            "threading.Timer(20,s.shutdown).start()\n"
            "s.serve_forever()\n")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_the_studio_starts_itself_when_it_is_not_running(tmp_path):
    port = free_port()
    script = tmp_path / "fake_app.py"
    script.write_text(FAKE_APP)
    log = tmp_path / "studio.log"
    out = call(f"http://127.0.0.1:{port}", "list_designs",
               env={"PM_APP_CMD": f"{sys.executable} {script} {port}", "PM_APP_LOG": str(log)})
    assert not out.is_error and text(out) == "No projects yet."
    assert log.exists()


def test_autostart_is_only_for_a_local_studio():
    out = call("http://127.0.0.2:9", "list_designs", env={"PM_APP_CMD": "false"})
    assert out.is_error and "not reachable" in text(out)


def approve(base, slug, why=""):
    req = urllib.request.Request(f"{base}/api/projects/{slug}/approve", data=json.dumps({"why": why}).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.load(res)


def test_the_user_approves_in_the_studio_and_the_terminal_waits_for_it(live_server):
    slug = projects.create("Checkout")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("<!doctype html><title>t</title><h1>Pay</h1>")
    projects.commit_version(slug, "first")
    handoff = text(call(live_server, "get_handoff", {"project": slug}))
    assert handoff.startswith("NOT APPROVED: the user has not approved this design yet.")
    waiting = text(call(live_server, "wait_for_approval", {"project": slug, "wait_seconds": 1}))
    assert waiting.startswith("Still waiting after 1s.") and f"/#/p/{slug}" in waiting

    approve(live_server, slug, why="the layout is right")
    done_ = text(call(live_server, "wait_for_approval", {"project": slug, "wait_seconds": 5}))
    assert done_.startswith("Approved for build by the user in the studio") and "'the layout is right'" in done_
    assert text(call(live_server, "get_handoff", {"project": slug})).startswith("Approved for build")

    (projects.design_dir(slug) / "index.html").write_text("<!doctype html><title>t</title><h1>Pay now</h1>")
    projects.commit_version(slug, "second")  # changed after approval: not approved any more
    assert text(call(live_server, "get_handoff", {"project": slug})).startswith(
        "NOT APPROVED: the user approved version")
