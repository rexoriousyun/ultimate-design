import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import engine, projects, rulebook, server, workspace


@pytest.fixture(autouse=True)
def tmp_storage(tmp_path, tmp_path_factory, monkeypatch):
    """Every test gets empty projects/ and data/ folders."""
    # A workspace of its own (never the machine's), whose rule book is design-guide (the fake
    # below) unless a test says otherwise (tests/test_workspace.py).
    monkeypatch.setattr(workspace, "DIR", tmp_path_factory.mktemp("workspace"))
    monkeypatch.setattr(workspace, "DEFAULT_RULES", "design-guide")
    monkeypatch.setattr(projects, "PROJECTS_DIR", tmp_path / "projects")
    monkeypatch.setattr(projects, "DATA_DIR", tmp_path / "data")
    # No built-in design systems unless a test provides some (tests/test_builtin.py).
    monkeypatch.setattr(projects, "BUILTIN_DIR", tmp_path / "no-builtins")
    # Never the machine's own Ollama: its pulled models would change what the UI shows.
    monkeypatch.setattr(engine, "OLLAMA_URL", "http://127.0.0.1:9")
    # Never the machine's own design-guide: a fake that exports the pinned sample rulebook and
    # whose gate reports what a test writes to fake-gate.json (none by default).
    fake = tmp_path_factory.mktemp("cli") / "design-guide"  # outside tmp_path, which tests list
    sample = Path(__file__).parent / "fixtures" / "rulebook-sample.json"
    gate = tmp_path / "fake-gate.json"
    # Proposals: fake-proposals.json if a test wrote one, else the pinned real output. Confirm and
    # reject append their arguments to proposal-answers and succeed, unless refuse.txt exists.
    proposals = Path(__file__).parent / "fixtures" / "proposals-sample.json"
    fake.write_text("#!/bin/sh\n"
                    'case "$1" in\n'
                    f'  export) cat "{sample}" ;;\n'
                    f'  gate) if [ -f "{gate}" ]; then cat "{gate}"; else echo \'{{"findings": []}}\'; fi ;;\n'
                    '  proposals) case "$2" in\n'
                    f'    confirm|reject) printf "%s\\n" "$@" >> "{tmp_path}/proposal-answers"\n'
                    f'      if [ -f "{tmp_path}/refuse.txt" ]; then cat "{tmp_path}/refuse.txt" >&2; exit 1; fi\n'
                    '      echo "{\\"action\\": \\"$2\\", \\"proposal\\": \\"$3\\"}" ;;\n'
                    f'    *) if [ -f "{tmp_path}/fake-proposals.json" ]; then cat "{tmp_path}/fake-proposals.json"; '
                    f'else cat "{proposals}"; fi ;;\n'
                    "  esac ;;\n"
                    "esac\n")
    fake.chmod(0o755)
    monkeypatch.setattr(rulebook, "COMMAND", str(fake))


@pytest.fixture
def client():
    # One event loop for the whole test, as under uvicorn: chat turns run as background
    # tasks that must outlive the request that started them.
    with TestClient(server.app) as c:
        yield c


class FakeEngine:
    """Stands in for ClaudeCodeEngine. Each run() replays the next scripted turn and can
    write files into the project folder first, like the agent would."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.prompts = []
        self.running = set()

    async def run(self, key, cwd, prompt, session_id, resume, options=None):
        self.prompts.append({"prompt": prompt, "session_id": session_id, "resume": resume})
        self.options = options
        files, events = self.turns.pop(0)
        for name, content in files.items():
            (cwd / name).write_text(content)
        for event in events:
            if event["type"] == "_sleep":  # scripted pause, to test a turn mid-flight
                await asyncio.sleep(event["seconds"])
                continue
            yield event

    def is_running(self, key):
        return key in self.running

    def stop(self, key):
        return False


@pytest.fixture
def fake_engine(monkeypatch):
    def install(turns):
        engine = FakeEngine(turns)
        monkeypatch.setattr(server, "engine", engine)
        return engine
    return install


def tool(name, id_="t1", path="index.html"):
    return {"type": "tool", "id": id_, "name": name, "summary": f"{name} {path}"}


def ask(questions, id_="q1"):
    """The agent calling ask_questions, as engine.normalize reports it."""
    return {"type": "tool", "id": id_, "name": "mcp__pm__ask_questions",
            "summary": "ask_questions", "questions": questions}


def plan(summary, steps, id_="p1"):
    """The agent calling propose_plan, as engine.normalize reports it."""
    return {"type": "tool", "id": id_, "name": "mcp__pm__propose_plan",
            "summary": "propose_plan", "plan": {"summary": summary, "steps": steps}}


def result(id_="q1", is_error=False):
    return {"type": "tool_result", "id": id_, "is_error": is_error}


def done(session_id="s1", is_error=False):
    return {"type": "done", "is_error": is_error, "cost_usd": 0.1, "session_id": session_id}


def say(text="Done."):
    """An assistant reply. Scripted turns need one: a turn with no text and no tool call
    is an empty turn, which the server nudges."""
    return {"type": "text", "text": text}


def pause(seconds):
    return {"type": "_sleep", "seconds": seconds}


@pytest.fixture
def live_server():
    """The app under a real uvicorn server on a free port. TestClient buffers streamed
    responses, so tests of a turn mid-flight (disconnect, reconnect) need real HTTP."""
    import socket
    import threading
    import time

    import uvicorn

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = uvicorn.Config(server.app, host="127.0.0.1", port=port, log_level="warning")
    srv = uvicorn.Server(config)
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    while not srv.started:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    thread.join(timeout=5)
