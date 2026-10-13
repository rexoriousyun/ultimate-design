"""Print: paper frames on the board, their PDF export (one designed page at the paper's
size, or a paginated document), the board PDF with every frame, and verify's check for
content past a fixed page's edge. Real Chromium; PDFs read with pypdf."""

import asyncio
import io
import json

from pypdf import PdfReader

from app import board, projects
from app.preview import DESKTOP, Previewer
from tests.test_server import new_project

PT = 0.75  # PDF points per CSS px


def sizes(pdf: bytes) -> list[tuple[int, int]]:
    return [(round(float(p.mediabox.width)), round(float(p.mediabox.height))) for p in PdfReader(io.BytesIO(pdf)).pages]


def printed_site(folder, flyer_height=1056):
    (folder / "index.html").write_text("<!doctype html><title>t</title><h1>Site</h1>")
    (folder / "flyer.html").write_text(
        f"<!doctype html><title>f</title><body style='margin:0'><div style='width:816px;height:{flyer_height}px;"
        "display:flow-root;background:#f3ede2'><h1>Sail on Saturday</h1></div></body>")
    (folder / "report.html").write_text("<!doctype html><title>r</title><body>"
                                        + "".join(f"<p>Paragraph {i} of a long report.</p>" for i in range(200)) + "</body>")
    (folder / "board.json").write_text(json.dumps({"frames": [
        {"page": "index.html", "title": "Site"},
        {"page": "flyer.html", "title": "Flyer", "paper": "letter"},
        {"page": "flyer.html", "title": "Flyer, A4 landscape", "paper": "a4", "landscape": True},
        {"page": "report.html", "title": "Report", "paper": "a4", "print": "flow"}]}))
    return folder


def test_paper_frames_on_the_board(tmp_path):
    b = board.load(printed_site(tmp_path))
    assert [(f["title"], f["width"], f["height"], f["paper"], f["print"]) for f in b["frames"]] == [
        ("Site", 1440, 900, None, None), ("Flyer", 816, 1056, "letter", "page"),
        ("Flyer, A4 landscape", 1123, 794, "a4", "page"), ("Report", 794, 1123, "a4", "flow")]
    (tmp_path / "board.json").write_text(json.dumps({"frames": [
        {"page": "flyer.html", "paper": "tabloid"}, {"page": "report.html", "paper": "a4", "print": "flow", "landscape": True}]}))
    assert board.load(tmp_path)["problems"] == [
        "board.json: frame 1 paper tabloid is not letter or a4",
        'board.json: frame 2 print must be "page" or "flow" (flow is portrait only)']


def test_page_and_board_pdf_exports(client):
    slug = new_project(client)
    printed_site(projects.design_dir(slug))
    flyer = client.get(f"/api/projects/{slug}/export/pdf", params={"page": "flyer.html"})
    assert sizes(flyer.content) == [(612, 792)]  # one Letter page
    report = client.get(f"/api/projects/{slug}/export/pdf", params={"page": "report.html"}).content
    assert len(sizes(report)) > 1 and set(sizes(report)) == {(596, 843)}  # paginated on A4 (595.92 x 842.88 pt)
    site = client.get(f"/api/projects/{slug}/export/pdf").content
    assert len(sizes(site)) == 1 and sizes(site)[0][0] == 1080  # the old long screen page

    whole = client.get(f"/api/projects/{slug}/export/frames")
    assert whole.headers["content-disposition"] == f'attachment; filename="{slug}-board.pdf"'
    pages = sizes(whole.content)
    assert pages[:3] == [(1080, 675), (612, 792), (843, 596)] and set(pages[3:]) == {(596, 843)}
    assert client.get(f"/api/projects/{slug}/export/pdf", params={"page": "../x.html"}).status_code == 404


def test_verify_fails_content_past_a_fixed_page(tmp_path):
    def board_problems(folder):
        async def scenario():
            previewer = Previewer(folder)
            try:
                return (await previewer.screenshot("flyer.html", DESKTOP))[1].board
            finally:
                await previewer.close()
        return asyncio.run(scenario())
    assert board_problems(printed_site(tmp_path)) == []
    assert board_problems(printed_site(tmp_path, flyer_height=1300)) == [
        "flyer.html is a letter page (816x1056px) but its content is 1300px tall; everything past "
        "1056px is cut from the PDF"]
