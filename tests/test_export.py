import base64
import io
import zipfile

from app import export

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


def make_site(root):
    (root / "css").mkdir()
    (root / "img").mkdir()
    (root / "img" / "dot.png").write_bytes(PNG_1PX)
    (root / "css" / "site.css").write_text("body { background: url('../img/dot.png'); }")
    (root / "app.js").write_text("const s = '</script>'; document.title = 'ok';")
    (root / "index.html").write_text(
        '<html><head><link rel="stylesheet" href="css/site.css">'
        '<link rel="stylesheet" href="https://fonts.example/x.css">'
        '<link rel="icon" href="img/dot.png"></head><body>'
        '<img src="img/dot.png" alt=""><img src="missing.png" alt="">'
        '<div style="background: url(img/dot.png)"></div>'
        '<script src="app.js"></script><script src="https://cdn.example/lib.js"></script>'
        '</body></html>')


def test_inline_html_embeds_local_assets(tmp_path):
    make_site(tmp_path)
    html = export.inline_html(tmp_path, "index.html")
    data_png = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()

    assert "css/site.css" not in html and f'url("{data_png}")' in html  # CSS inlined, its url() too
    assert f'<img src="{data_png}"' in html
    assert "document.title = 'ok'" in html and "<\\/script>" in html  # script inlined safely
    assert 'href="https://fonts.example/x.css"' in html  # remote left alone
    assert 'src="https://cdn.example/lib.js"' in html
    assert 'src="missing.png"' in html  # missing left alone
    assert '<link rel="icon" href="img/dot.png">' in html  # only stylesheets are inlined
    assert html.count(data_png) == 3  # css url, img, style attribute


def test_inline_html_never_reads_outside_the_project(tmp_path):
    (tmp_path / "secret.css").write_text("SECRET")
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text('<link rel="stylesheet" href="../secret.css">')
    assert "SECRET" not in export.inline_html(site, "index.html")


def test_zip_folder(tmp_path):
    make_site(tmp_path)
    names = zipfile.ZipFile(io.BytesIO(export.zip_folder(tmp_path, "proj"))).namelist()
    assert sorted(names) == ["proj/app.js", "proj/css/site.css", "proj/img/dot.png", "proj/index.html"]
