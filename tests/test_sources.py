"""GitHub and Figma design-system sources. GitHub is a local git repo standing in for the
remote; Figma is a fake API server. No network."""

import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import projects, sources
from app.server import describe_source, turn_options

PNG = b"\x89PNG\r\n\x1a\nfake"


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd,
                   check=True, capture_output=True)


@pytest.fixture
def fake_github(tmp_path, monkeypatch):
    """A repo at ~/remote/acme/ui with a src/ folder; clone URLs point at it."""
    repo = tmp_path / "remote" / "acme" / "ui"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "theme.css").write_text(":root { --brand: #123456; }")
    (repo / "README.md").write_text("ui kit")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    monkeypatch.setattr(sources, "github_clone_url",
                        lambda owner, name: str(tmp_path / "remote" / owner / name))
    return repo


def test_kind():
    assert sources.kind("https://github.com/acme/ui") == "github"
    assert sources.kind("https://github.com/acme/ui.git") == "github"
    assert sources.kind("https://github.com/acme/ui/tree/main/src/tokens") == "github"
    assert sources.kind("https://www.figma.com/design/AbC123/My-file?node-id=1-2") == "figma"
    assert sources.kind("https://figma.com/file/AbC123/x") == "figma"
    assert sources.kind("/home/me/code") == "path"
    assert sources.kind("https://gitlab.com/acme/ui") == "path"


def test_clone_whole_repo_and_subfolder(fake_github, tmp_path):
    whole = sources.fetch("https://github.com/acme/ui", tmp_path / "a")
    assert (whole / "README.md").read_text() == "ui kit"
    sub = sources.fetch("https://github.com/acme/ui/tree/main/src", tmp_path / "b")
    assert sub == tmp_path / "b" / "src" and (sub / "theme.css").exists()


def test_clone_errors(fake_github, tmp_path):
    with pytest.raises(sources.SourceError, match="Could not clone acme/missing"):
        sources.fetch("https://github.com/acme/missing", tmp_path / "c")
    with pytest.raises(sources.SourceError, match="not a folder"):
        sources.fetch("https://github.com/acme/ui/tree/main/nope", tmp_path / "d")


def test_design_system_from_github_url(client, fake_github):
    res = client.post("/api/projects", json={"name": "UI kit", "kind": "design-system",
                                             "source": "https://github.com/acme/ui/tree/main/src"})
    assert res.status_code == 200
    meta = res.json()
    assert meta["source"] == "https://github.com/acme/ui/tree/main/src"
    assert meta["source_dir"].endswith("/source/src")
    options = turn_options(projects.get(meta["slug"]))
    assert [str(d) for d in options.read_only_dirs] == [meta["source_dir"]]
    assert "the GitHub repository https://github.com/acme/ui/tree/main/src, cloned read-only at" \
        in options.system_prompt


def test_failed_clone_leaves_no_project(client, fake_github):
    res = client.post("/api/projects", json={"name": "Bad", "kind": "design-system",
                                             "source": "https://github.com/acme/missing"})
    assert res.status_code == 400 and "Could not clone" in res.json()["detail"]
    assert client.get("/api/projects").json() == []


def test_refresh_fetches_again(client, fake_github):
    slug = client.post("/api/projects", json={"name": "UI", "kind": "design-system",
                                              "source": "https://github.com/acme/ui"}).json()["slug"]
    (fake_github / "new.css").write_text("x")
    git(fake_github, "add", "-A")
    git(fake_github, "commit", "-q", "-m", "more")
    assert client.post(f"/api/projects/{slug}/source/refresh").status_code == 200
    assert (projects.fetched_source_dir(slug) / "new.css").exists()
    assert "fetched again" in projects.get(slug)["pending_note"]


def test_refresh_rejects_local_sources(client, tmp_path):
    slug = client.post("/api/projects", json={"name": "L", "kind": "design-system",
                                              "source": str(tmp_path)}).json()["slug"]
    assert client.post(f"/api/projects/{slug}/source/refresh").status_code == 400


def test_bad_local_path_mentions_urls(client):
    res = client.post("/api/projects", json={"name": "x", "kind": "design-system", "source": "rel/path"})
    assert "GitHub URL or a Figma URL" in res.json()["detail"]


FIGMA_FILE = {
    "name": "Brand kit",
    "styles": {"S:1": {"name": "Primary", "styleType": "FILL"}},
    "document": {"children": [{"name": "Page 1", "type": "CANVAS", "children": [
        {"id": "1:2", "name": "Home", "type": "FRAME", "cornerRadius": 12,
         "fills": [{"type": "SOLID", "color": {"r": 1, "g": 1, "b": 1, "a": 1}}],
         "children": [
             {"type": "TEXT", "style": {"fontFamily": "Inter", "fontSize": 32, "fontWeight": 700,
                                        "lineHeightPx": 38.4},
              "fills": [{"type": "SOLID", "color": {"r": 0.1, "g": 0.2, "b": 0.4, "a": 1}}]},
             {"type": "RECTANGLE", "fills": [{"type": "SOLID", "opacity": 0.5,
                                              "color": {"r": 0, "g": 0, "b": 0, "a": 1}}]}]},
        {"id": "9:9", "name": "Note", "type": "TEXT"}]}]},
}


@pytest.fixture
def fake_figma(monkeypatch):
    seen = []

    class Api(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("X-Figma-Token")))
            base = f"http://127.0.0.1:{self.server.server_address[1]}"
            if self.path.startswith("/v1/files/Missing"):
                self.send_response(404)
                self.end_headers()
                return
            if self.path.startswith("/v1/files/"):
                body = json.dumps(FIGMA_FILE).encode()
            elif self.path.startswith("/v1/images/"):
                body = json.dumps({"images": {"1:2": f"{base}/render/1.png"}}).encode()
            else:
                body = PNG
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Api)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(sources, "FIGMA_API", f"http://127.0.0.1:{server.server_address[1]}")
    monkeypatch.setenv("FIGMA_TOKEN", "tok")
    yield seen
    server.shutdown()


def test_figma_export(fake_figma, tmp_path):
    out = sources.fetch("https://www.figma.com/design/Key123/Brand-kit", tmp_path / "f")
    assert json.loads((out / "figma-file.json").read_text())["name"] == "Brand kit"
    summary = json.loads((out / "figma-summary.json").read_text())
    assert summary["colors"] == {"#ffffff": 1, "#1a3366": 1, "#000000 at 50%": 1}
    assert summary["text_styles"] == {"Inter 32px weight 700 / 38px": 1}
    assert summary["radii"] == {"12px": 1}
    assert summary["named_styles"] == {"S:1": {"name": "Primary", "type": "FILL"}}
    assert [p.name for p in (out / "frames").iterdir()] == ["01-Page-1-Home.png"]
    assert all(token == "tok" for path, token in fake_figma if path.startswith("/v1/"))


def test_figma_needs_a_token(monkeypatch, tmp_path):
    monkeypatch.delenv("FIGMA_TOKEN", raising=False)
    with pytest.raises(sources.SourceError, match="FIGMA_TOKEN"):
        sources.fetch("https://www.figma.com/file/Key123/x", tmp_path / "f")


def test_figma_api_error(fake_figma, tmp_path):
    with pytest.raises(sources.SourceError, match="Figma API error 404"):
        sources.fetch("https://www.figma.com/file/Missing/x", tmp_path / "f")


def test_figma_prompt_names_the_files():
    meta = {"source": "https://www.figma.com/design/K/x", "source_dir": "/d/source"}
    text = describe_source(meta)
    assert "figma-summary.json" in text and "frames/*.png" in text and "/d/source" in text
