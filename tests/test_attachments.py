"""Files attached to chat messages, and captured web pages."""

import zipfile
from pathlib import Path

import pytest

from app import attachments, projects
from app.preview import serve_folder
from tests.conftest import done, say
from tests.test_server import new_project

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'


def office(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for name, xml in files.items():
            z.writestr(name, xml)
    return path.read_bytes()


def test_office_text_extraction(tmp_path):
    docx = office(tmp_path / "a.docx", {"word/document.xml":
        f'<w:document {W}><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>'})
    pptx = office(tmp_path / "b.pptx", {
        "ppt/slides/slide2.xml": f'<p:sld xmlns:p="p" {A}><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>',
        "ppt/slides/slide10.xml": f'<p:sld xmlns:p="p" {A}><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>',
        "ppt/slides/slide1.xml": f'<p:sld xmlns:p="p" {A}><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>'})
    xlsx = office(tmp_path / "c.xlsx", {
        "xl/sharedStrings.xml": f'<sst {S}><si><t>Plan</t></si><si><t>Price</t></si></sst>',
        "xl/worksheets/sheet1.xml": f'<worksheet {S}><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
                                    '<row><c t="inlineStr"><is><t>Pro</t></is></c><c><v>29</v></c></row></sheetData></worksheet>'})
    data = tmp_path / "data"
    data.mkdir()
    doc = attachments.add(data, "brief.docx", docx)
    assert open(doc["text_path"]).read() == "Hello world\nSecond"
    deck = attachments.add(data, "deck.pptx", pptx)
    assert open(deck["text_path"]).read() == "--- Slide 1 ---\nOne\n\n--- Slide 2 ---\nTwo\n\n--- Slide 3 ---\nTen"
    sheet = attachments.add(data, "prices.xlsx", xlsx)
    assert open(sheet["text_path"]).read() == "--- sheet1 ---\nPlan\tPrice\nPro\t29"
    broken = attachments.add(data, "broken.docx", b"not a zip")
    assert broken["text_path"] is None


def test_add_remove_and_send(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    a = attachments.add(data, "../../etc/My Mockup.PNG", b"png")
    assert a["kind"] == "image" and a["name"] == "My Mockup.PNG"
    assert attachments.folder(data) in Path(a["path"]).parents  # no path escape
    b = attachments.add(data, "notes.md", b"# notes")
    assert [x["id"] for x in attachments.pending(data)] == [a["id"], b["id"]]
    assert attachments.remove(data, b["id"]) and not attachments.remove(data, b["id"])
    sent = attachments.mark_sent(data)
    assert [x["id"] for x in sent] == [a["id"]] and attachments.pending(data) == []
    assert not attachments.remove(data, a["id"])  # sent attachments stay


def test_rejects_unsupported_and_huge(tmp_path):
    with pytest.raises(attachments.AttachmentError, match="not supported"):
        attachments.add(tmp_path, "tool.exe", b"x")
    with pytest.raises(attachments.AttachmentError, match="20 MB"):
        attachments.add(tmp_path, "big.png", b"x" * (attachments.MAX_BYTES + 1))


def test_prompt_block_warns_text_only_models_about_images():
    items = [{"path": "/d/a.png", "text_path": None, "name": "a.png", "kind": "image", "source": None},
             {"path": "/d/b.docx", "text_path": "/d/b.docx.txt", "name": "b.docx", "kind": "document",
              "source": None},
             {"path": "/d/s.png", "text_path": None, "name": "s.png", "kind": "image",
              "source": "https://x.com"}]
    block = attachments.prompt_block(items, images_ok=True)
    assert "- /d/a.png (a.png: image)" in block
    assert "- /d/b.docx.txt (b.docx: document, as extracted text)" in block
    assert "captured from https://x.com" in block
    assert "cannot view images" in attachments.prompt_block(items, images_ok=False)


def test_upload_send_and_agent_access(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    slug = new_project(client)
    res = client.post(f"/api/projects/{slug}/attachments?name=mock.png", content=b"\x89PNGdata")
    assert res.status_code == 200
    item = res.json()
    assert client.get(f"/api/projects/{slug}").json()["attachments"][0]["id"] == item["id"]
    assert client.get(f"/api/projects/{slug}/attachments/{item['id']}").content == b"\x89PNGdata"

    assert client.post(f"/api/projects/{slug}/chat", json={"message": ""}).status_code == 200
    prompt = eng.prompts[0]["prompt"]
    assert prompt.startswith("Please use the attached files.") and item["path"] in prompt
    assert attachments.folder(projects.data_dir(slug)) in eng.options.read_only_dirs
    logged = projects.read_chat(slug)[0]
    assert logged["attachments"] == [{"id": item["id"], "name": "mock.png", "kind": "image", "source": None}]
    assert client.get(f"/api/projects/{slug}").json()["attachments"] == []


def test_upload_errors_and_delete(client):
    slug = new_project(client)
    assert client.post(f"/api/projects/{slug}/attachments?name=x.exe", content=b"x").status_code == 400
    item = client.post(f"/api/projects/{slug}/attachments?name=a.txt", content=b"a").json()
    assert client.delete(f"/api/projects/{slug}/attachments/{item['id']}").status_code == 200
    assert client.delete(f"/api/projects/{slug}/attachments/{item['id']}").status_code == 404


def test_capture_a_page(client, tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("<!doctype html><title>Acme pricing</title><h1>Plans</h1><p>Pro $29</p>")
    server = serve_folder(site)
    try:
        slug = new_project(client)
        url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
        res = client.post(f"/api/projects/{slug}/attachments/capture", json={"url": url})
        assert res.status_code == 200
        shot, text = res.json()
        assert shot["kind"] == "image" and shot["source"] == url and shot["name"] == "127.0.0.1.png"
        assert open(shot["path"], "rb").read().startswith(b"\x89PNG")
        body = open(text["path"]).read()
        assert body.startswith("Acme pricing\n" + url) and "Pro $29" in body
    finally:
        server.shutdown()
    assert client.post(f"/api/projects/{slug}/attachments/capture",
                       json={"url": "file:///etc/passwd"}).status_code == 400
    bad = client.post(f"/api/projects/{slug}/attachments/capture", json={"url": "http://127.0.0.1:9/"})
    assert bad.status_code == 400 and "Could not capture" in bad.json()["detail"]


def test_sketch_is_the_page_with_the_strokes_on_top(client):
    import base64
    import io

    from playwright.sync_api import sync_playwright
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text(
        "<!doctype html><title>t</title><body style='margin:0;background:#ffffff'>"
        "<div style='height:3000px'></div></body>")
    # A transparent drawing with one red block in its top-left corner, drawn by Chromium.
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        overlay = pg.evaluate("""() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100;
            const x = c.getContext('2d'); x.fillStyle = '#e03131'; x.fillRect(0, 0, 50, 50); return c.toDataURL('image/png'); }""")
        b.close()
    item = client.post(f"/api/projects/{slug}/attachments/sketch", json={
        "page": "index.html", "width": 400, "height": 200, "scroll_y": 500, "overlay": overlay}).json()
    assert item["name"] == "sketch-1.png" and item["kind"] == "image"
    png = Path(attachments.get(projects.data_dir(slug), item["id"])["path"]).read_bytes()
    with sync_playwright() as p:  # read two pixels back
        b = p.chromium.launch()
        pg = b.new_page()
        colours = pg.evaluate("""async (src) => { const img = new Image(); img.src = src; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            return [img.width, img.height, [...x.getImageData(20, 20, 1, 1).data], [...x.getImageData(300, 150, 1, 1).data]]; }""",
            "data:image/png;base64," + base64.b64encode(png).decode())
        b.close()
    width, height, inked, blank = colours
    assert (width, height) == (400, 200)
    assert inked[:3] == [224, 49, 49] and blank[:3] == [255, 255, 255]  # the stroke scaled 2x onto the page
    assert client.post(f"/api/projects/{slug}/attachments/sketch", json={
        "page": "../x.html", "width": 400, "height": 200, "overlay": overlay}).status_code == 404
    assert client.post(f"/api/projects/{slug}/attachments/sketch", json={
        "page": "index.html", "width": 400, "height": 200, "overlay": "data:text/plain,hi"}).status_code == 400
