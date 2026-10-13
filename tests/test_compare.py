"""Comparing two versions (app/compare.py): real Chromium through the compare routes."""

from app import projects
from tests.test_server import new_project
from tests.test_thumbnails import png_size

PAGE = """<!doctype html><title>t</title><body style="margin:0;font:20px sans-serif">
<h1 style="margin:40px">{title}</h1><div style="height:1600px;background:#eee"></div>
<p style="margin:40px">{footer}</p>"""


def version(slug, title, footer="Same footer", name="index.html"):
    (projects.design_dir(slug) / name).write_text(PAGE.format(title=title, footer=footer))
    return projects.commit_version(slug, title)


def test_compare_finds_where_the_page_changed_and_which_files(client):
    slug = new_project(client)
    a = version(slug, "Hello")
    b = version(slug, "Goodbye", footer="New footer")
    res = client.get(f"/api/projects/{slug}/compare", params={"a": a, "b": b, "width": 834}).json()
    assert res["files"] == [{"path": "index.html", "added": 2, "removed": 2}]
    assert res["size"]["width"] == 834 and res["size"]["heights"][0] > 1600  # the whole page
    tops = [box["y"] for box in res["boxes"]]
    assert len(tops) == 2 and tops[0] < 120 and tops[1] > 1600  # the heading, then the footer
    assert all(box["h"] < 120 for box in res["boxes"])  # not the unchanged block between

    shot = client.get(f"/api/projects/{slug}/versions/{a}/shot", params={"width": 834})
    assert png_size(shot.content)[0] == 834 and png_size(shot.content)[1] > 1600
    assert shot.headers["cache-control"].endswith("immutable")


def test_an_unchanged_page_has_no_boxes_and_a_missing_page_says_so(client):
    slug = new_project(client)
    a = version(slug, "Hello")
    (projects.design_dir(slug) / "notes.txt").write_text("only notes changed")
    b = projects.commit_version(slug, "notes")
    res = client.get(f"/api/projects/{slug}/compare", params={"a": a, "b": b}).json()
    assert res["boxes"] == [] and res["files"] == [{"path": "notes.txt", "added": 1, "removed": 0}]

    c = version(slug, "Pricing", name="pricing.html")
    res = client.get(f"/api/projects/{slug}/compare", params={"a": a, "b": c, "page": "pricing.html"}).json()
    assert res["missing"] == "a" and res["boxes"] == []


def test_compare_refuses_unknown_versions_and_odd_pages(client):
    slug = new_project(client)
    a = version(slug, "Hello")
    assert client.get(f"/api/projects/{slug}/compare", params={"a": a, "b": "deadbeef"}).status_code == 404
    assert client.get(f"/api/projects/{slug}/compare",
                      params={"a": a, "b": a, "page": "../secret.html"}).status_code == 400
    assert client.get(f"/api/projects/{slug}/versions/{a}/shot", params={"width": 9000}).status_code == 400
