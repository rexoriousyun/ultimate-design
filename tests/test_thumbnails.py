"""Home thumbnails: real Chromium through the thumbnail route."""

import struct

from app import projects, thumbnails
from tests.test_server import new_project
from tests.conftest import done, say


def png_size(data):
    assert data.startswith(b"\x89PNG")
    return struct.unpack(">II", data[16:24])


def page_version(slug, text):
    (projects.design_dir(slug) / "index.html").write_text(
        f"<!doctype html><title>t</title><body style='background:#123'><h1>{text}</h1>")
    return projects.commit_version(slug, text)


def test_no_design_is_404(client):
    slug = new_project(client)
    assert client.get(f"/api/projects/{slug}/thumbnail").status_code == 404
    assert client.get("/api/projects").json()[0]["version"] is None
    # Versions without a page (the default design system was attached): still nothing to show.
    (projects.design_dir(slug) / "notes.css").write_text("p{}")
    projects.commit_version(slug, "no page yet")
    assert client.get("/api/projects").json()[0]["version"] is None


def test_thumbnail_is_small_desktop_render_cached_per_version(client):
    slug = new_project(client)
    first = page_version(slug, "one")
    res = client.get(f"/api/projects/{slug}/thumbnail")
    assert res.headers["content-type"] == "image/png"
    assert png_size(res.content) == (432, 270)  # 1440x900 at scale 0.3
    assert thumbnails.cache_path(slug, first).exists()
    assert client.get("/api/projects").json()[0]["version"] == first

    # Served from the cache: overwrite the file and get the overwritten bytes back.
    thumbnails.cache_path(slug, first).write_bytes(b"\x89PNG cached")
    assert client.get(f"/api/projects/{slug}/thumbnail").content == b"\x89PNG cached"

    second = page_version(slug, "two")
    assert png_size(client.get(f"/api/projects/{slug}/thumbnail").content) == (432, 270)
    assert thumbnails.cache_path(slug, second).exists()
    assert not thumbnails.cache_path(slug, first).exists()  # old versions' files removed


def test_design_system_thumbnail_uses_its_specimen(client, tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    slug = client.post("/api/projects", json={"name": "DS", "kind": "design-system",
                                              "source": str(src)}).json()["slug"]
    (projects.design_dir(slug) / "specimen.html").write_text("<p>specimen</p>")
    projects.commit_version(slug, "extract")
    assert client.get(f"/api/projects/{slug}/thumbnail").status_code == 200


def test_not_cached_while_a_turn_runs(client, monkeypatch):
    import app.server as server
    slug = new_project(client)
    sha = page_version(slug, "one")
    monkeypatch.setattr(server, "busy", lambda s: True)
    assert client.get(f"/api/projects/{slug}/thumbnail").status_code == 200
    assert not thumbnails.cache_path(slug, sha).exists()


def test_project_from_before_version_history_renders_live(client):
    import shutil
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text("<h1>old</h1>")
    shutil.rmtree(projects.DATA_DIR / slug / "git")  # as made in milestone 1
    assert client.get("/api/projects").json()[0]["version"] == "live"
    assert png_size(client.get(f"/api/projects/{slug}/thumbnail").content) == (432, 270)
    assert not list((projects.DATA_DIR / slug).glob("thumb-*.png"))



def test_each_version_has_its_own_thumbnail(client, fake_engine):
    fake_engine([({"index.html": "<body style='background:#000'>"}, [say(), done()]),
                 ({"index.html": "<body style='background:#fff'>"}, [say(), done()])])
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    first, second = [v["sha"] for v in client.get(f"/api/projects/{slug}/versions").json()]
    a = client.get(f"/api/projects/{slug}/versions/{first}/thumbnail")
    b = client.get(f"/api/projects/{slug}/versions/{second}/thumbnail")
    assert a.status_code == b.status_code == 200 and a.headers["content-type"] == "image/png"
    assert a.content != b.content  # the black page and the white page
    assert thumbnails.version_cache_path(slug, first).exists()
    assert client.get(f"/api/projects/{slug}/versions/abc/thumbnail").status_code == 404
