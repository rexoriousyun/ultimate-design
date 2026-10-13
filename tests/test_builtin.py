"""Built-in design systems: design-systems/<id>/ in the workspace becomes a read-only
design-system project at startup (projects.seed_builtin)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import projects, server
from tests.test_server import new_project

@pytest.fixture
def builtins(tmp_path, monkeypatch):
    """A one-system design-systems/ folder."""
    root = tmp_path / "design-systems"
    system = root / "brand"
    (system / "specimen").mkdir(parents=True)
    (root / "manifest.json").write_text(json.dumps({"systems": [{"id": "brand", "name": "Brand"},
                                                                 {"id": "gone", "name": "Gone"}]}))
    (system / "tokens.css").write_text(":root { --brand: #123456; }")
    (system / "README.md").write_text("Use --brand.")
    (system / "specimen.html").write_text('<link rel="stylesheet" href="specimen/doc.css"><p>Brand</p>')
    (system / "specimen" / "doc.css").write_text("p { margin: 0; }")
    monkeypatch.setattr(projects, "BUILTIN_DIR", root)
    return system


def builtin_project(ds_id="brand"):
    return next(m for m in projects.list_all() if m["builtin"] == ds_id)


def test_startup_makes_each_listed_system_a_project(builtins):
    with TestClient(server.app):
        pass
    meta = builtin_project()
    assert meta["kind"] == "design-system" and meta["name"] == "Brand" and meta["slug"] == "brand"
    assert meta["entry"] == "specimen.html"
    assert sorted(projects.list_files("brand")) == ["README.md", "specimen.html", "specimen/doc.css", "tokens.css"]
    assert len(projects.list_versions("brand")) == 1
    # A manifest entry without a folder is skipped.
    assert [m["builtin"] for m in projects.list_all()] == ["brand"]


def test_seeding_again_follows_the_repo(builtins):
    projects.seed_builtin()
    projects.seed_builtin()  # unchanged: no new version, no second project
    assert len(projects.list_versions("brand")) == 1 and len(projects.list_all()) == 1

    (builtins / "tokens.css").write_text(":root { --brand: #654321; }")
    (builtins / "README.md").unlink()
    projects.seed_builtin()
    assert len(projects.list_versions("brand")) == 2
    assert "#654321" in (projects.design_dir("brand") / "tokens.css").read_text()
    assert not (projects.design_dir("brand") / "README.md").exists()


def test_a_user_project_with_the_same_name_is_left_alone(builtins):
    mine = projects.create("Brand")["slug"]
    projects.seed_builtin()
    assert projects.get(mine)["builtin"] is None
    assert builtin_project()["slug"] == "brand-2"


def test_attaching_copies_the_system_but_not_its_specimen(builtins, client):
    projects.seed_builtin()
    slug = new_project(client)
    assert client.put(f"/api/projects/{slug}/design-system", json={"design_system": "brand"}).status_code == 200
    copied = projects.design_dir(slug) / "design-system"
    assert sorted(p.name for p in copied.rglob("*")) == ["README.md", "tokens.css"]


def test_built_in_system_is_read_only_but_can_be_duplicated(builtins, client):
    projects.seed_builtin()
    sha = projects.list_versions("brand")[0]["sha"]
    refused = [
        client.post("/api/projects/brand/chat", json={"message": "make it red"}),
        client.post("/api/projects/brand/edits", json={"texts": []}),
        client.post("/api/projects/brand/tweaks", json={"values": {}}),
        client.post("/api/projects/brand/restore", json={"sha": sha}),
        client.delete("/api/projects/brand"),
    ]
    assert [r.status_code for r in refused] == [403] * 5
    assert "design-systems/brand/" in refused[0].json()["detail"]
    assert projects.exists("brand") and len(projects.list_versions("brand")) == 1

    copy = client.post("/api/projects/brand/duplicate").json()
    assert copy["builtin"] is None and copy["kind"] == "design-system"
    assert (projects.design_dir(copy["slug"]) / "tokens.css").exists()
    assert client.delete(f"/api/projects/{copy['slug']}").status_code == 200
