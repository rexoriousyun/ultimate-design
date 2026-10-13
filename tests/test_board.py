"""The board (app/board.py): a project's pages as frames in rows, from board.json or by
default; its route; its problems reported by verify; and the board's studio context."""

import asyncio
import json

from app import board, projects
from app.preview import DESKTOP, Previewer
from app.server import ViewContext, describe_view
from tests.test_server import new_project

PAGE = "<!doctype html><html lang=en><title>t</title><h1 data-priority='1'>Hi</h1></html>"


def site(folder, *pages):
    for page in pages:
        (folder / page).parent.mkdir(parents=True, exist_ok=True)
        (folder / page).write_text(PAGE)
    return folder


def test_without_board_json_every_page_is_a_frame_entry_first(tmp_path):
    site(tmp_path, "pricing.html", "index.html", "design-system/specimen.html")
    b = board.load(tmp_path)
    assert [(f["page"], f["title"], f["width"], f["height"], f["row"]) for f in b["frames"]] == [
        ("index.html", "Home", 1440, 900, 0), ("pricing.html", "pricing", 1440, 900, 0)]
    assert b["rows"] == [""] and b["problems"] == []


def test_board_json_rows_frames_widths_and_unlisted_pages(tmp_path):
    site(tmp_path, "index.html", "directions/a.html", "directions/b.html", "about.html")
    (tmp_path / "board.json").write_text(json.dumps({
        "rows": ["Screens", "Directions"],
        "frames": [{"page": "index.html", "title": "Home"},
                   {"page": "index.html", "title": "Home, phone", "width": 390},
                   {"page": "directions/a.html", "title": "A · Warm", "row": 1},
                   {"page": "directions/b.html", "title": "B · Dense", "row": 1}]}))
    b = board.load(tmp_path)
    assert b["rows"] == ["Screens", "Directions"] and b["problems"] == []
    assert [(f["title"], f["width"], f["height"], f["row"]) for f in b["frames"]] == [
        ("Home", 1440, 900, 0), ("Home, phone", 390, 844, 0), ("A · Warm", 1440, 900, 1),
        ("B · Dense", 1440, 900, 1), ("about", 1440, 900, 0)]  # unlisted page joins the first row


def test_problems_are_reported_not_raised(tmp_path):
    site(tmp_path, "index.html")
    (tmp_path / "board.json").write_text("{not json")
    assert board.load(tmp_path)["problems"][0].startswith("board.json is not valid")
    (tmp_path / "board.json").write_text(json.dumps({"frames": [
        {"page": "gone.html"}, {"title": "no page"}, {"page": "index.html", "width": 1000}]}))
    b = board.load(tmp_path)
    assert b["problems"] == ["board.json: frame 1 names gone.html, which does not exist",
                             'board.json: frame 2 needs a "page"',
                             "board.json: frame 3 width 1000 is not one of 390, 834, 1440"]
    assert [f["width"] for f in b["frames"]] == [1440]
    (tmp_path / "board.json").write_text(json.dumps({"frames": [{"page": "index.html"}] * 30}))
    b = board.load(tmp_path)
    assert len(b["frames"]) == board.MAX_FRAMES and "the board shows the first 24" in b["problems"][0]


def test_route(client):
    slug = new_project(client)
    site(projects.design_dir(slug), "index.html", "pricing.html")
    b = client.get(f"/api/projects/{slug}/board").json()
    assert [f["page"] for f in b["frames"]] == ["index.html", "pricing.html"]


def test_verify_reports_board_problems(tmp_path):
    site(tmp_path, "index.html")

    def report():
        async def scenario():
            previewer = Previewer(tmp_path)
            try:
                return (await previewer.screenshot("index.html", DESKTOP))[1]
            finally:
                await previewer.close()
        return asyncio.run(scenario())
    assert report().board == []  # no board.json: nothing to check
    (tmp_path / "board.json").write_text(json.dumps({"frames": [{"page": "gone.html"}]}))
    problems = report()
    assert problems.board == ["board.json: frame 1 names gone.html, which does not exist"]
    assert not problems.empty() and "Board (board.json):" in problems.report()


def test_board_context():
    assert describe_view(ViewContext(view="board")) == \
        "(Studio context: The user is on the board, seeing all frames side by side.)"
    line = describe_view(ViewContext(view="board", page="directions/b.html", width=390))
    assert line.endswith('They selected the frame for directions/b.html at 390px; "this" most likely means that frame.)')
