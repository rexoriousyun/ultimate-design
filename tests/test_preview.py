"""Runs real headless Chromium. Needs `uv run playwright install chromium` once."""

import asyncio
import re

from app.preview import DESKTOP, MOBILE, Previewer

PNG_MAGIC = b"\x89PNG"


def run(coro_fn, folder):
    async def scenario():
        previewer = Previewer(folder)
        try:
            return await coro_fn(previewer)
        finally:
            await previewer.close()
    return asyncio.run(scenario())


def test_clean_page_has_no_problems(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title><h1>Hello</h1>")
    png, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert png.startswith(PNG_MAGIC)
    assert problems.empty()
    assert problems.report().startswith("No console errors")


def test_reports_exceptions_console_errors_and_missing_files(tmp_path):
    (tmp_path / "index.html").write_text(
        "<!doctype html><title>t</title><link rel=stylesheet href=missing.css>"
        "<script>console.error('bad thing'); undefinedFunction();</script>")
    _, problems = run(lambda p: p.screenshot("index.html", MOBILE), tmp_path)
    assert any("undefinedFunction" in e for e in problems.page_errors)
    assert "bad thing" in problems.console_errors
    assert any("missing.css" in r for r in problems.failed_requests)
    assert "Uncaught exceptions:" in problems.report()


def test_missing_entry_file_is_a_problem(tmp_path):
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert problems.failed_requests == ["index.html does not exist in the project"]


def test_eval_js_and_fetch_work_over_http(tmp_path):
    (tmp_path / "data.json").write_text('{"n": 3}')
    (tmp_path / "index.html").write_text(
        "<!doctype html><title>t</title><script>"
        "fetch('data.json').then(r => r.json()).then(d => document.title = 'n=' + d.n)</script>")
    assert run(lambda p: p.evaluate("index.html", "document.title"), tmp_path) == '"n=3"'


def test_viewport_width_is_applied(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title>")
    width = run(lambda p: p.evaluate("index.html", "innerWidth", MOBILE), tmp_path)
    assert width == str(MOBILE[0])


def test_pdf_is_one_page_of_the_full_height(tmp_path):
    (tmp_path / "index.html").write_text(
        "<!doctype html><title>t</title><body style='margin:0'><div style='height:3000px'>tall</div>")
    pdf = run(lambda p: p.pdf("index.html"), tmp_path)
    assert pdf.startswith(b"%PDF")
    assert len(re.findall(rb"/Type\s*/Page(?!s)", pdf)) == 1  # one page, not 3000px split up


CONTRAST_PAGE = """<!doctype html><title>t</title>
<body style="background:#ffffff;color:#111111">
  <p>Readable body text</p>
  <p style="color:#a0907c">Faint text</p>
  <p style="color:#a0907c">More faint text</p>
  <h1 style="color:#8a8a8a;font-size:32px">Large grey heading</h1>
  <p style="color:#8a8a8a">Small grey text</p>
  <div style="background:#2f2820"><span style="color:#3a332c">Dark on dark</span></div>
  <div style="background:rgba(0,0,0,0.8)"><span style="color:#ffffff">White on mostly black</span></div>
  <div style="background:rgba(0,0,0,0.5)"><span style="color:#ffffff">White on half black</span></div>
  <div style="background-image:linear-gradient(#fff,#000)"><span style="color:#777">On gradient</span></div>
  <button disabled style="color:#cccccc">Disabled</button>
  <span aria-disabled="true" style="color:#cccccc">Aria disabled</span>
  <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);color:#eee">sr only</span>
</body>"""


def test_contrast_failures_are_reported_and_grouped(tmp_path):
    (tmp_path / "index.html").write_text(CONTRAST_PAGE)
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    report = "\n".join(problems.low_contrast)
    assert "#a0907c on #ffffff: 3.09:1, needs 4.5:1 (2 element(s)" in report
    assert "Small grey text" in report and "Large grey heading" not in report  # 3.45:1 passes 3:1 when large
    assert "#3a332c on #2f2820" in report
    assert "#ffffff on #808080" in report  # 50% black over white composites to mid grey: 3.95:1
    for exempt in ("Readable", "White on mostly black", "On gradient", "Disabled", "Aria disabled", "sr only"):
        assert exempt not in report
    assert not problems.empty()


def test_unloaded_css_and_js_are_reported(tmp_path):
    (tmp_path / "used.css").write_text("p{color:#000}")
    (tmp_path / "forgotten.css").write_text("p{}")
    (tmp_path / "js").mkdir()
    (tmp_path / "js" / "app.js").write_text("")
    (tmp_path / "notes.md").write_text("not an asset")
    (tmp_path / "index.html").write_text(
        '<!doctype html><title>t</title><link rel="stylesheet" href="used.css?v=2"><p>x</p>')
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert problems.unloaded_files == ["forgotten.css", "js/app.js"]
    assert "does not load" in problems.report()


def design_system_site(tmp_path, page_css):
    (tmp_path / "design-system").mkdir()
    (tmp_path / "design-system" / "tokens.css").write_text(
        ":root { --ink: #1c1b19; --paper: #f7f6f3; --accent: var(--brand); --brand: #3d4a8f;"
        " --font-body: 'Work Sans', system-ui; }"
        " @media (prefers-color-scheme: dark) { :root { --ink: #f1efea; } }")
    (tmp_path / "index.html").write_text(
        "<!doctype html><title>t</title><link rel=stylesheet href='design-system/tokens.css'>"
        f"<style>{page_css}</style><body><h1>Title</h1><p class=off>Off-system text</p>"
        "<a class=btn href=#>Go</a></body>")


def test_conformance_reports_colours_and_fonts_not_in_the_system(tmp_path):
    design_system_site(tmp_path,
        "body { background: var(--paper); color: var(--ink); font-family: var(--font-body); }"
        ".btn { background: var(--accent); color: #ffffff; }"
        ".off { color: #ff0000; font-family: Georgia; }")
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    notes = "\n".join(problems.off_system)
    assert 'colour #ff0000: 1 element(s), e.g. "Off-system text"' in notes
    assert "colour #ffffff" in notes  # white text is not a system token here
    assert 'font "georgia"' in notes
    assert "#1c1b19" not in notes and "#3d4a8f" not in notes and "#f7f6f3" not in notes
    assert "work sans" not in notes


def test_conformance_failure_blocks_a_clean_verify(tmp_path):
    design_system_site(tmp_path, "body { color: #7a0000; font-family: 'Work Sans'; } a { color: #1c1b19; }")
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert problems.off_system and not problems.empty()
    assert "Not from the design system" in problems.report()
    assert "--ds-override-" in problems.report()


def test_declared_overrides_and_studio_edits_are_allowed(tmp_path):
    # A contrast fix declared as --ds-override-*, and a colour the user picked in Edit mode.
    design_system_site(tmp_path,
        ":root { --ds-override-ink-strong: #7a0000; }"
        "body { background: var(--paper); color: var(--ds-override-ink-strong); font-family: var(--font-body); }"
        ".btn { background: var(--accent); color: var(--paper); }")
    (tmp_path / "studio-edits.css").write_text(".off { color: #123456 !important; }")
    html = (tmp_path / "index.html").read_text()
    (tmp_path / "index.html").write_text(html.replace("</style>", "</style><link rel=stylesheet href='studio-edits.css'>"))
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert problems.off_system == [] and problems.empty(), problems.report()


def test_no_design_system_no_conformance_check(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title><p style='color:#ff0000'>x</p>")
    _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
    assert problems.off_system == []


def test_css_hex():
    from app.preview import css_hex
    assert css_hex("rgb(61, 74, 143)") == "#3d4a8f"
    assert css_hex("rgba(0, 0, 0, 0.5)") == "#000000 at 50%"


def test_look_alikes_of_system_components_fail(tmp_path):
    design_system_site(tmp_path, "body { background: var(--paper); color: var(--ink); font-family: var(--font-body); }"
                                 ".btn { background: var(--accent); color: var(--paper); }")
    (tmp_path / "design-system" / "components").mkdir()
    (tmp_path / "design-system" / "components" / "components.css").write_text(
        ".ds-card { border: 1px solid var(--ink); } .ds-card__title { font-weight: 600; }"
        ".ds-button { background: var(--accent); } .ds-button--ghost { background: none; }")
    page = (tmp_path / "index.html").read_text()
    advice = "use the ds-{0} markup from design-system/README.md (keep your own class for layout only)"

    def notes(html):
        (tmp_path / "index.html").write_text(html)
        _, problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)
        return [n for n in problems.off_system if "looks like" in n]

    cards = ("<div class=card-grid><div class=invoice-card style='border:1px solid var(--ink)'>Acme</div>"
             "<div class=invoice-card style='border:1px solid var(--ink)'>Beta</div></div>")
    found = notes(page.replace("</body>", cards + "</body>"))
    # The fixture's filled .btn link is also a button that isn't ds-button.
    assert found == [
        ".invoice-card (2 element(s), e.g. \"Acme\") looks like the system's ds-card but isn't it: " + advice.format("card"),
        "<a> (1 element(s), e.g. \"Go\") looks like the system's ds-button but isn't it: " + advice.format("button")]
    # The real components, a boxless wrapper, and a part inside a component all pass.
    real = page.replace("<a class=btn href=#>Go</a>", "<a class='ds-button' href=#>Go</a>").replace(
        "</body>", "<div class=card-grid><section class=ds-card><p class=card-meta style='background:var(--paper)'>x</p>"
        "</section></div></body>")
    assert notes(real) == []
