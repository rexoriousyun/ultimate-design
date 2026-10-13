"""Local models: Claude Code pointed at Ollama's Anthropic-compatible API."""

import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

from app import engine, projects, server
from tests.conftest import done, say
from tests.test_server import new_project

LOCAL = "ollama:qwen3:8b"


def test_provider_env_only_for_local_models():
    assert engine.provider_env("claude-opus-5-5") == {}
    env = engine.provider_env(LOCAL)
    assert env["ANTHROPIC_BASE_URL"] == engine.ollama_proxy.start(engine.OLLAMA_URL)
    assert env["ANTHROPIC_BASE_URL"].startswith("http://127.0.0.1:")
    assert env["ANTHROPIC_AUTH_TOKEN"] == "ollama" and env["ANTHROPIC_API_KEY"] == ""
    assert env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "qwen3:8b"


def test_command_passes_bare_local_model_name(tmp_path):
    eng = engine.ClaudeCodeEngine(model="claude-opus-5-5", effort="low")
    cmd = eng.command(tmp_path, "s", False, engine.TurnOptions(model=LOCAL))
    assert cmd[cmd.index("--model") + 1] == "qwen3:8b"
    cmd = eng.command(tmp_path, "s", False)
    assert cmd[cmd.index("--model") + 1] == "claude-opus-5-5"


def test_default_model_is_current(monkeypatch):
    monkeypatch.delenv("PM_MODEL", raising=False)
    assert engine.ClaudeCodeEngine().model == "claude-opus-5-5" == engine.DEFAULT_MODEL
    # Superseded models are not offered for new choices.
    assert "claude-opus-5" not in engine.CLAUDE_MODELS
    assert "claude-sonnet-5" not in engine.CLAUDE_MODELS


def test_run_sets_provider_env_for_the_cli(tmp_path, monkeypatch):
    # A fake CLI that reports the environment it was started with.
    fake = ["python3", "-c",
            "import json,os; print(json.dumps({'type':'assistant','message':{'content':"
            "[{'type':'text','text':os.environ.get('ANTHROPIC_BASE_URL','none')}]}}))"]
    eng = engine.ClaudeCodeEngine(model="claude-opus-5-5", effort="low")
    monkeypatch.setattr(eng, "command", lambda *a, **k: fake)

    async def texts(options):
        return [e["text"] async for e in eng.run("k", tmp_path, "hi", "s", False, options)
                if e["type"] == "text"]
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    assert asyncio.run(texts(engine.TurnOptions(model=LOCAL))) == [engine.provider_env(LOCAL)["ANTHROPIC_BASE_URL"]]
    assert asyncio.run(texts(None)) == ["none"]


def test_local_models_reads_ollama_tags(monkeypatch):
    class Tags(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"models": [{"name": "qwen3:8b"}, {"name": "llama3:8b"}]}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Tags)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(engine, "OLLAMA_URL", f"http://127.0.0.1:{httpd.server_address[1]}")
        assert engine.local_models() == ["ollama:qwen3:8b", "ollama:llama3:8b"]
    finally:
        httpd.shutdown()
    monkeypatch.setattr(engine, "OLLAMA_URL", "http://127.0.0.1:9")  # nothing listens
    assert engine.local_models() == []


def test_project_model_is_validated_stored_and_used(client, fake_engine, monkeypatch):
    monkeypatch.setattr(server, "local_models", lambda: [LOCAL])
    eng = fake_engine([({}, [say(), done()])])
    bad = client.post("/api/projects", json={"name": "x", "model": "ollama:missing"})
    assert bad.status_code == 400

    slug = client.post("/api/projects", json={"name": "Local", "model": LOCAL}).json()["slug"]
    assert projects.get(slug)["model"] == LOCAL
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert eng.options.model == LOCAL
    assert projects.duplicate(slug)["model"] == LOCAL


def test_default_projects_use_claude(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    slug = new_project(client)
    assert projects.get(slug)["model"] is None
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert eng.options.model is None


def test_models_route(client, monkeypatch):
    monkeypatch.setattr(server, "local_models", lambda: [LOCAL])
    assert client.get("/api/models").json() == {"default": server.engine.model, "claude": engine.CLAUDE_MODELS,
                                                  "local": [LOCAL]}


def test_accepts_images(monkeypatch):
    class Show(BaseHTTPRequestHandler):
        def do_POST(self):
            name = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["model"]
            caps = ["completion", "vision"] if name == "llava:7b" else ["completion", "tools"]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"capabilities": caps}).encode())

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Show)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(engine, "OLLAMA_URL", f"http://127.0.0.1:{httpd.server_address[1]}")
        assert engine.accepts_images(None) and engine.accepts_images("claude-opus-5-5")
        assert engine.accepts_images("ollama:llava:7b")
        assert not engine.accepts_images(LOCAL)
    finally:
        httpd.shutdown()
    monkeypatch.setattr(engine, "OLLAMA_URL", "http://127.0.0.1:9")
    assert not engine.accepts_images(LOCAL)  # unknown: assume text-only, the safe choice


def test_text_only_models_get_no_images_flag(client, fake_engine, monkeypatch):
    monkeypatch.setattr(server, "local_models", lambda: [LOCAL])
    monkeypatch.setattr(server, "accepts_images", lambda model: model is None)
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    local = client.post("/api/projects", json={"name": "L", "model": LOCAL}).json()["slug"]
    client.post(f"/api/projects/{local}/chat", json={"message": "go"})
    assert eng.options.mcp_env.get("PM_NO_IMAGES") == "1"
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert "PM_NO_IMAGES" not in eng.options.mcp_env


def test_switching_models_keeps_or_restarts_the_conversation(client, monkeypatch):
    from app import projects, server
    monkeypatch.setattr(server, "local_models", lambda: ["ollama:qwen3:8b"])
    slug = client.post("/api/projects", json={"name": "Switch"}).json()["slug"]
    projects.touch(slug, session_id="s1")
    assert client.put(f"/api/projects/{slug}/model", json={"model": "gpt-9"}).status_code == 400
    # Between Claude models the conversation continues.
    meta = client.put(f"/api/projects/{slug}/model", json={"model": "claude-haiku-4-5-20251001"}).json()
    assert meta["model"] == "claude-haiku-4-5-20251001" and meta["session_id"] == "s1"
    assert server.turn_options(projects.get(slug)).model == "claude-haiku-4-5-20251001"
    # To a local model: a new session, and the agent is told.
    meta = client.put(f"/api/projects/{slug}/model", json={"model": "ollama:qwen3:8b"}).json()
    assert meta["session_id"] is None and "new conversation" in meta["pending_note"]
    # Back to the default Claude model (None) from local, with no session yet: nothing to reset.
    meta = client.put(f"/api/projects/{slug}/model", json={"model": None}).json()
    assert meta["model"] is None
    assert client.get("/api/models").json()["claude"]["claude-sonnet-5-5"] == "Sonnet 5.5"
    assert client.post("/api/projects", json={"name": "Picked", "model": "claude-sonnet-5-5"}).json()["model"] == "claude-sonnet-5-5"
