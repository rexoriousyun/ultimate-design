"""Workspaces (app/workspace.py): where everything personal lives, which rule book a workspace uses,
its written guides, and the `python -m app.workspace` commands. The design-guide rule book itself is
covered by tests/test_rulebook.py."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import engine, projects, rulebook, server, workspace
from tests.conftest import done, say, tool

REPO = Path(__file__).resolve().parent.parent
PAGE = '<!doctype html><title>t</title><h1>Hi</h1>'
WROTE = [tool("Write"), tool(engine.VERIFY_TOOL, id_="t2"), say(), done()]


def turn(client, slug, message="go"):
    body = client.post(f"/api/projects/{slug}/chat", json={"message": message}).text
    return [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ")]


@pytest.fixture
def builtin_rules(monkeypatch):
    """A workspace on the built-in rule book, with no design-guide on the machine at all."""
    monkeypatch.setattr(workspace, "DEFAULT_RULES", "builtin")
    monkeypatch.setattr(rulebook, "COMMAND", "/nonexistent/design-guide")


# ---- where the workspace is ----

def test_pm_workspace_wins(tmp_path):
    assert workspace.resolve({"PM_WORKSPACE": str(tmp_path / "w")}, tmp_path) == (tmp_path / "w", False)


def test_a_fresh_checkout_uses_workspace_in_the_repo(tmp_path):
    assert workspace.resolve({}, tmp_path) == (tmp_path / "workspace", False)


def test_a_checkout_from_before_workspaces_keeps_its_folders_and_design_guide(tmp_path):
    (tmp_path / "projects").mkdir()
    assert workspace.resolve({}, tmp_path) == (tmp_path, True)
    (tmp_path / "workspace").mkdir()  # once moved, the workspace folder wins
    assert workspace.resolve({}, tmp_path) == (tmp_path / "workspace", False)


def test_all_storage_follows_pm_workspace(tmp_path):
    out = subprocess.run([sys.executable, "-c", "from app import projects, rulebook; "
                          "print(projects.PROJECTS_DIR, projects.DATA_DIR, projects.BUILTIN_DIR, sep='\\n')"],
                         cwd=REPO, env={**os.environ, "PM_WORKSPACE": str(tmp_path)},
                         capture_output=True, text=True, check=True).stdout.split()
    assert out == [str(tmp_path / "projects"), str(tmp_path / "data"), str(tmp_path / "design-systems")]


def test_the_repo_ignores_its_default_workspace():
    assert "workspace/" in (REPO / ".gitignore").read_text().split()


# ---- settings ----

def test_settings_default_and_override():
    assert workspace.settings() == {"name": None, "rules": "design-guide"}  # conftest's default
    (workspace.DIR / workspace.FILE).write_text(json.dumps({"name": "Acme", "rules": "builtin"}))
    assert workspace.settings() == {"name": "Acme", "rules": "builtin"}


def test_an_unknown_rule_book_is_an_error_not_a_fallback():
    (workspace.DIR / workspace.FILE).write_text(json.dumps({"rules": "design guide"}))
    with pytest.raises(ValueError, match="must be one of builtin, design-guide"):
        workspace.rules()


# ---- the built-in rule book ----

def test_builtin_export_never_runs_design_guide(builtin_rules, tmp_path):
    out = tmp_path / "rulebook.json"
    book = asyncio.run(rulebook.export(tmp_path, out, tmp_path))
    assert book["source"] == "builtin" and json.loads(out.read_text()) == book
    assert {r["id"]: r["layer"] for r in book["rules"]} == {
        "contrast-minimum": "floor", "reflow": "floor", "target-size-minimum": "floor"}
    assert all(r["check"]["kind"] == "measure" for r in book["rules"])


def test_builtin_rules_are_checked_in_the_page(builtin_rules, tmp_path):
    from tests.test_rulebook import check
    (tmp_path / "index.html").write_text('<!doctype html><title>t</title><p style="color:#bbb">faint</p>'
                                         '<button style="width:10px;height:10px;padding:0">a</button>'
                                         '<button style="width:10px;height:10px;padding:0">b</button>')
    problems = check(tmp_path, "index.html", json.loads(rulebook.BUILTIN.read_text()))
    assert any(line.startswith("contrast-minimum:") for line in problems.rules)
    assert any(line.startswith("target-size-minimum:") for line in problems.rules)


def test_a_builtin_turn_has_no_gate_pass_and_no_taste(builtin_rules, client, fake_engine, tmp_path):
    eng = fake_engine([({"index.html": PAGE}, WROTE)])
    (tmp_path / "fake-gate.json").write_text(json.dumps({"findings": [
        {"entryId": "contrast-minimum", "verdict": "fail", "reason": "x", "locators": []}]}))
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    streamed = turn(client, slug)
    assert not [e for e in streamed if e["type"] == "findings"]
    assert len(eng.prompts) == 1  # no rules nudge
    book = rulebook.load(rulebook.path(projects.data_dir(slug)))
    assert book["source"] == "builtin" and not [r for r in book["rules"] if r["layer"] == "taste"]


def test_builtin_workspaces_have_no_proposals(builtin_rules, client):
    assert client.get("/api/workspace").json() == {"name": None, "rules": "builtin", "guides": []}
    assert client.get("/api/proposals").status_code == 404
    assert client.post("/api/proposals/p1/confirm", json={"why": "yes"}).status_code == 404


# ---- guides ----

def write_guides():
    folder = workspace.DIR / workspace.GUIDES
    (folder / "forms").mkdir(parents=True)
    (folder / "README.md").write_text("how to add guides")
    (folder / "buttons.md").write_text("Primary on the right.")
    (folder / "forms" / "errors.md").write_text("Say what to do.")
    (folder / "logo.png").write_bytes(b"png")
    return folder


def test_guides_are_the_markdown_files_but_not_the_readme():
    folder = write_guides()
    assert workspace.guides() == [folder / "buttons.md", folder / "forms" / "errors.md"]


def test_a_design_turn_names_the_guides_and_may_read_them(client, fake_engine):
    folder = write_guides()
    eng = fake_engine([({}, [say(), done()])])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    turn(client, slug, "make the form")
    prompt = eng.prompts[0]["prompt"]
    assert str(folder / "buttons.md") in prompt and str(folder / "forms" / "errors.md") in prompt
    assert "README" not in prompt and prompt.endswith("make the form")
    assert folder in server.turn_options(projects.get(slug)).read_only_dirs
    assert client.get("/api/workspace").json()["guides"] == ["buttons.md", "forms/errors.md"]


def test_no_guides_no_note(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    turn(client, slug, "make the form")
    assert "guides" not in eng.prompts[0]["prompt"]


# ---- init and add-system ----

def test_init_makes_a_workspace_and_refuses_an_existing_one(tmp_path):
    folder = workspace.init(tmp_path / "acme", "Acme")
    assert json.loads((folder / "workspace.json").read_text()) == {"name": "Acme", "rules": "builtin"}
    assert json.loads((folder / "design-systems" / "manifest.json").read_text()) == {"systems": []}
    assert (folder / "guides" / "README.md").is_file()
    assert (folder / ".gitignore").read_text().split("\n")[1:3] == ["projects/", "data/"]
    with pytest.raises(FileExistsError):
        workspace.init(folder)


def test_cli_init_and_show(tmp_path):
    def cli(*args):
        return subprocess.run([sys.executable, "-m", "app.workspace", *args], cwd=REPO, capture_output=True,
                              text=True, env={**os.environ, "PM_WORKSPACE": str(tmp_path / "acme")})
    assert cli("init", str(tmp_path / "acme")).returncode == 0
    shown = json.loads(cli("show").stdout)
    assert shown["workspace"] == str(tmp_path / "acme") and shown["rules"] == "builtin" and not shown["legacy"]
    again = cli("init", str(tmp_path / "acme"))
    assert again.returncode == 1 and "already exists" in again.stderr


def test_a_shared_design_system_loads_read_only_for_everyone(client, monkeypatch):
    slug = client.post("/api/projects", json={"name": "Acme UI", "kind": projects.DESIGN_SYSTEM}).json()["slug"]
    (projects.design_dir(slug) / "tokens.css").write_text(":root { --acme: #123456; }")
    target = workspace.add_system(slug, "acme")
    assert (target / "tokens.css").is_file() and not (target / ".git").exists()
    manifest = json.loads((workspace.DIR / "design-systems" / "manifest.json").read_text())
    assert manifest["systems"] == [{"id": "acme", "name": "Acme UI"}]
    with pytest.raises(KeyError):
        workspace.add_system("nope")
    # A teammate's studio: an empty workspace that shares design-systems/.
    monkeypatch.setattr(projects, "BUILTIN_DIR", workspace.DIR / "design-systems")
    monkeypatch.setattr(projects, "DATA_DIR", workspace.DIR / "teammate-data")
    monkeypatch.setattr(projects, "PROJECTS_DIR", workspace.DIR / "teammate-projects")
    with TestClient(server.app):
        pass
    [meta] = [m for m in projects.list_all() if m["builtin"] == "acme"]
    assert (projects.design_dir(meta["slug"]) / "tokens.css").read_text() == ":root { --acme: #123456; }"
    # The workspace may make it everyone's default; a person's own pick still wins.
    assert projects.settings()["default_design_system"] is None
    (workspace.DIR / workspace.FILE).write_text(json.dumps({"default_design_system": "acme"}))
    assert client.get("/api/settings").json()["default_design_system"] == meta["slug"]
    new = client.post("/api/projects", json={"name": "Checkout"}).json()
    assert new["design_system"] == meta["slug"]
    client.put("/api/settings/default-design-system", json={"design_system": None})
    assert projects.settings()["default_design_system"] is None
