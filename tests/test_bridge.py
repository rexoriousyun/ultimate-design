"""static/canvas-bridge.js in real Chromium. The page is loaded top-level, where
window.parent is the window itself, so the test can play the studio's side of the
postMessage protocol from inside the page."""

from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

BRIDGE = (Path(__file__).resolve().parent.parent / "static" / "canvas-bridge.js").read_text()

TWEAKS = """<script type="application/json" id="tweaks">[
  {"name": "--accent", "type": "color", "value": "#000000"},
  {"name": "--radius", "type": "range", "unit": "px", "value": 4},
  {"name": "layout", "type": "enum", "options": ["cards", "table"], "value": "cards"},
  {"name": "headline", "type": "text", "value": "Hello"}
]</script>"""


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    page = browser.new_page()
    yield page
    page.close()


def load(page, body, head=""):
    page.set_content(
        f"<!doctype html><html><head>{head}</head><body>{body}"
        "<script>window.__msgs = []; addEventListener('message', e => {"
        " if (e.data && e.data.source === 'pm-bridge') __msgs.push(e.data) })</script>"
        f"<script>{BRIDGE}</script></body></html>")


def studio_says(page, msg):
    page.evaluate("m => postMessage({source: 'pm-studio', ...m}, '*')", msg)
    page.wait_for_timeout(50)


def bridge_said(page, kind, at_least=1):
    """The bridge's messages of one kind, once there are at least `at_least` of them
    (postMessage is async, so a message sent by the last action may not be in yet)."""
    page.wait_for_function(f"__msgs.filter(m => m.type === '{kind}').length >= {at_least}")
    return [m for m in page.evaluate("__msgs") if m["type"] == kind]


def test_ready_reports_tweaks_and_options(page):
    load(page, '<section data-option="1a" data-option-label="Calm"></section>'
               '<section data-option="1b"></section>', TWEAKS)
    ready = bridge_said(page, "ready")[0]
    assert [t["name"] for t in ready["tweaks"]] == ["--accent", "--radius", "layout", "headline"]
    assert ready["options"] == [{"id": "1a", "label": "Calm"}, {"id": "1b", "label": ""}]


def test_invalid_tweaks_json_is_ignored(page):
    load(page, "<p>x</p>", '<script type="application/json" id="tweaks">[not json</script>')
    assert bridge_said(page, "ready")[0]["tweaks"] == []


def test_tweak_defaults_apply_on_load_and_changes_apply_live(page):
    load(page, '<h1 data-tweak="headline">Hello</h1>', TWEAKS)
    assert page.evaluate("document.documentElement.dataset.layout") == "cards"

    studio_says(page, {"type": "set-tweak", "name": "--radius", "value": 12})
    studio_says(page, {"type": "set-tweak", "name": "layout", "value": "table"})
    studio_says(page, {"type": "set-tweak", "name": "headline", "value": "New words"})
    studio_says(page, {"type": "set-tweak", "name": "not-declared", "value": "x"})
    root = "document.documentElement"
    assert page.evaluate(f"{root}.style.getPropertyValue('--radius')") == "12px"
    assert page.evaluate(f"{root}.dataset.layout") == "table"
    assert page.inner_text("h1") == "New words"
    assert page.evaluate(f"{root}.hasAttribute('data-not-declared')") is False


def test_selectors_find_the_same_element(page):
    load(page, """
      <main><div class="plans">
        <article><h2>Solo</h2><a href="#">Start</a></article>
        <article><h2>Team</h2><a href="#">Start</a></article>
        <article id="agency"><h2>Agency</h2><a href="#">Talk</a></article>
      </div></main>""")
    assert page.evaluate("""() => [...document.querySelectorAll('main *')].every(el =>
        document.querySelector(__pmBridgeTest.selectorFor(el)) === el)""")
    assert page.evaluate("__pmBridgeTest.selectorFor(document.querySelector('#agency a'))") == "#agency > a"


def test_comment_mode_picks_instead_of_clicking(page):
    load(page, '<button id="buy" onclick="window.clicked = true">Buy now</button>')
    page.click("#buy")
    assert page.evaluate("window.clicked") is True

    page.evaluate("window.clicked = false")
    studio_says(page, {"type": "comment-mode", "on": True})
    page.click("#buy")
    picked = bridge_said(page, "picked")[0]
    assert picked["selector"] == "#buy" and picked["tag"] == "button" and picked["text"] == "Buy now"
    assert page.evaluate("window.clicked") is False

    studio_says(page, {"type": "comment-mode", "on": False})
    page.click("#buy")
    assert page.evaluate("window.clicked") is True


def test_pins_mark_commented_elements(page):
    load(page, "<h1>Title</h1><p>Body</p>")
    studio_says(page, {"type": "pins", "pins": [
        {"selector": "h1", "label": "1"}, {"selector": "p", "label": "2"},
        {"selector": "#gone", "label": "3"}, {"selector": "::bad", "label": "4"}]})
    assert page.eval_on_selector_all(".pm-pin", "els => els.map(e => e.textContent)") == ["1", "2"]
    assert page.eval_on_selector_all(".pm-pinned", "els => els.length") == 2
    studio_says(page, {"type": "pins", "pins": []})
    assert page.eval_on_selector_all(".pm-pin", "els => els.length") == 0


def test_escape_is_forwarded_only_in_comment_mode(page):
    load(page, "<p>x</p>")
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)
    assert not [m for m in page.evaluate("__msgs") if m["type"] == "escape"]
    studio_says(page, {"type": "comment-mode", "on": True})
    page.keyboard.press("Escape")
    assert bridge_said(page, "escape")


def test_edit_mode_selects_and_reports_the_box(page):
    load(page, "<div id=card style='width:200px;padding:12px 8px;font-size:20px'>Hello</div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#card")
    sel = bridge_said(page, "selected")[-1]
    assert sel["selector"] == "#card" and sel["textLeaf"] is True
    assert sel["box"]["width"] == 216 and sel["box"]["paddingY"] == 12 and sel["box"]["paddingX"] == 8
    assert sel["box"]["fontSize"] == 20
    assert page.eval_on_selector("#card", "e => e.classList.contains('pm-selected')")
    assert page.locator(".pm-handle").count() == 1

    studio_says(page, {"type": "set-style", "selector": "#card", "prop": "padding-top", "value": "30px"})
    assert page.eval_on_selector("#card", "e => getComputedStyle(e).paddingTop") == "30px"
    studio_says(page, {"type": "edit-mode", "on": False})
    assert page.locator(".pm-handle").count() == 0


def test_double_click_edits_text_in_place(page):
    load(page, "<p id=t>Old words</p><div id=box><b>mixed</b> content</div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.dblclick("#t")
    page.keyboard.press("Control+A")
    page.keyboard.type("New words")
    page.keyboard.press("Enter")
    edit = bridge_said(page, "text-edited")[0]
    assert edit == {"source": "pm-bridge", "type": "text-edited", "selector": "#t",
                    "before": "Old words", "after": "New words"}
    page.dblclick("#box")  # not a plain-text element: not editable
    assert page.eval_on_selector("#box", "e => e.isContentEditable") is False


def test_escape_while_editing_text_restores_it(page):
    load(page, "<p id=t>Keep me</p>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.dblclick("#t")
    page.keyboard.type("junk")
    page.keyboard.press("Escape")
    assert page.inner_text("#t") == "Keep me"
    assert not [m for m in page.evaluate("__msgs") if m["type"] == "text-edited"]


def test_resize_handle_reports_new_size(page):
    load(page, "<div id=box style='width:100px;height:50px;background:#eee'></div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#box")
    h = page.locator(".pm-handle").bounding_box()
    page.mouse.move(h["x"] + 6, h["y"] + 6)
    page.mouse.down()
    page.mouse.move(h["x"] + 56, h["y"] + 26, steps=5)
    page.mouse.up()
    change = bridge_said(page, "style-changed")[0]
    assert change["selector"] == "#box" and change["props"] == {"width": "150px", "height": "70px"}


def test_ready_reports_the_page_and_design_system_colour_tokens(page):
    # Tokens come only from design-system/ stylesheets, and only colours.
    page.route("**/design-system/tokens.css", lambda r: r.fulfill(
        content_type="text/css", body=":root { --ink: #1c1b19; --space-2: 8px; --accent: var(--ink); }"))
    page.route("**/site/page.html", lambda r: r.fulfill(content_type="text/html", body=(
        "<!doctype html><head><link rel=stylesheet href='design-system/tokens.css'>"
        "<style>:root { --mine: #ff0000 }</style></head><body><p>x</p>"
        "<script>window.__msgs = []; addEventListener('message', e => {"
        " if (e.data && e.data.source === 'pm-bridge') __msgs.push(e.data) })</script>"
        f"<script>{BRIDGE}</script></body>")))
    page.goto("http://example.test/site/page.html")
    ready = bridge_said(page, "ready")[0]
    assert ready["path"] == "/site/page.html"
    assert ready["tokens"] == [{"name": "--ink", "value": "#1c1b19"}, {"name": "--accent", "value": "#1c1b19"}]


def test_shift_click_selects_several_and_align_lines_them_up(page):
    load(page, "<div id=a style='width:50px;height:20px;margin-left:10px'>A</div>"
               "<div id=b style='width:80px;height:20px;margin-left:40px'>B</div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#a")
    page.click("#b", modifiers=["Shift"])
    sel = bridge_said(page, "selected", 2)[-1]
    assert sel["count"] == 2 and sel["selector"] == "#b"
    assert page.evaluate("getSelection().toString()") == ""  # no text selected along the way
    assert page.locator(".pm-handle").count() == 0  # no resize handle for a group
    studio_says(page, {"type": "align", "edge": "left"})
    lefts = page.evaluate("[a, b].map(e => e.getBoundingClientRect().left)")
    assert lefts[0] == lefts[1]
    changes = {m["selector"]: m["props"] for m in bridge_said(page, "style-changed", 2)}
    assert changes == {"#a": {"translate": "0px 0px"}, "#b": {"translate": "-30px 0px"}}
    studio_says(page, {"type": "align", "edge": "right"})
    rights = page.evaluate("[a, b].map(e => Math.round(e.getBoundingClientRect().right))")
    assert rights[0] == rights[1]
    n = len(bridge_said(page, "selected"))
    page.click("#a", modifiers=["Shift"])  # shift-click again removes it
    assert bridge_said(page, "selected", n + 1)[-1]["count"] == 1


def test_drag_moves_freely_with_translate(page):
    load(page, "<div id=box style='width:100px;height:40px;background:#eee'>Box</div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    box = page.locator("#box").bounding_box()
    page.mouse.move(box["x"] + 20, box["y"] + 20)
    page.mouse.down()
    page.mouse.move(box["x"] + 50, box["y"] + 35, steps=5)
    page.mouse.up()
    change = bridge_said(page, "style-changed")[-1]
    assert change == {"source": "pm-bridge", "type": "style-changed", "selector": "#box",
                      "props": {"translate": "30px 15px"}}
    # Dragging an unselected element selected it; the click that ends a drag doesn't reselect.
    assert bridge_said(page, "selected")[-1]["selector"] == "#box"
    assert page.locator("#box").bounding_box()["x"] == box["x"] + 30


def test_drag_in_a_flex_row_reorders_with_order(page):
    load(page, "<div id=row style='display:flex;gap:10px'>"
               "<div id=one style='width:60px;height:30px'>1</div>"
               "<div id=two style='width:60px;height:30px'>2</div>"
               "<div id=three style='width:60px;height:30px'>3</div></div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    one, three = page.locator("#one").bounding_box(), page.locator("#three").bounding_box()
    page.mouse.move(one["x"] + 10, one["y"] + 10)
    page.mouse.down()
    page.mouse.move(three["x"] + 50, three["y"] + 10, steps=8)  # past the middle of "3"
    page.mouse.up()
    xs = page.evaluate("[one, two, three].map(e => e.getBoundingClientRect().left)")
    assert xs[1] < xs[2] < xs[0]  # now 2, 3, 1
    orders = {m["selector"]: m["props"]["order"] for m in bridge_said(page, "style-changed", 3)}
    assert orders == {"#one": "2", "#two": "0", "#three": "1"}


def test_measure_reports_colours_and_position(page):
    load(page, "<p id=t style='color:#123456;background:#abcdef;translate:4px 6px'>x</p><p id=u>y</p>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#t")
    box = bridge_said(page, "selected")[-1]["box"]
    assert (box["color"], box["background"], box["x"], box["y"]) == ("#123456", "#abcdef", 4, 6)
    page.click("#u")
    assert bridge_said(page, "selected", 2)[-1]["box"]["background"] == ""  # transparent


def test_measure_reports_type_and_layout(page):
    load(page, "<h1 id=t style='font:700 32px/1.25 Georgia;letter-spacing:-0.5px'>Title</h1>"
               "<div id=row style='display:flex;gap:8px'><span>a</span></div><div id=empty style='height:20px'></div>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#t")
    box = bridge_said(page, "selected")[-1]["box"]
    assert (box["fontWeight"], box["letterSpacing"], box["lineHeight"], box["hasText"], box["layout"]) == \
        ("700", -0.5, 1.25, True, "")
    assert box["fontFamily"].startswith("Georgia")
    page.click("#row", position={"x": 200, "y": 5})
    assert bridge_said(page, "selected", 2)[-1]["box"]["layout"] == "flex"


def test_ready_reports_type_tokens_and_page_fonts(page):
    page.route("**/design-system/tokens.css", lambda r: r.fulfill(content_type="text/css", body=(
        ":root { --font-display: 'Fraunces', serif; --text-lg: 20px; --space-2: 8px; --ink: #111111; }")))
    page.route("**/site/p.html", lambda r: r.fulfill(content_type="text/html", body=(
        "<!doctype html><head><link rel=stylesheet href='design-system/tokens.css'></head>"
        "<body style='font-family: Georgia'><p>x</p><p>y</p>"
        "<script>window.__msgs = []; addEventListener('message', e => {"
        " if (e.data && e.data.source === 'pm-bridge') __msgs.push(e.data) })</script>"
        f"<script>{BRIDGE}</script></body>")))
    page.goto("http://example.test/site/p.html")
    ready = bridge_said(page, "ready")[0]
    assert ready["fontTokens"] == [{"name": "--font-display", "value": "'Fraunces', serif"}]
    assert ready["sizeTokens"] == [{"name": "--text-lg", "value": "20px"}]
    assert ready["tokens"] == [{"name": "--ink", "value": "#111111"}]
    assert ready["pageFonts"] == ["Georgia"]


def test_duplicate_and_wrap_preview_and_report(page):
    load(page, "<div id=row><p id=a>A</p><p id=b>B</p><p id=c>C</p></div><section><p id=far>Far</p></section>")
    studio_says(page, {"type": "edit-mode", "on": True})
    page.click("#b")
    studio_says(page, {"type": "duplicate"})
    dup = bridge_said(page, "structural")[-1]
    assert dup["ok"] and dup["kind"] == "duplicate" and dup["selector"] == "#b" and dup["text"] == "B"
    assert page.eval_on_selector_all("#row > p", "els => els.map(e => e.textContent)") == ["A", "B", "B", "C"]

    page.click("#a")
    page.click("#c", modifiers=["Shift"])
    studio_says(page, {"type": "wrap", "layout": "flex"})
    wrap = bridge_said(page, "structural", 2)[-1]
    assert wrap["ok"] and wrap["selectors"] == ["#a", "#c"] and wrap["layout"] == "flex"
    assert page.eval_on_selector("[data-pm-preview=wrap]", "e => getComputedStyle(e).display") == "flex"
    assert page.eval_on_selector_all("[data-pm-preview=wrap] > p", "els => els.map(e => e.id)") == ["a", "c"]

    page.click("#far")
    page.click("#b", modifiers=["Shift"])  # not siblings: refused, nothing moves
    studio_says(page, {"type": "wrap", "layout": "grid"})
    refused = bridge_said(page, "structural", 3)[-1]
    assert not refused["ok"] and "same container" in refused["reason"]
    assert page.locator("[data-pm-preview=wrap]").count() == 1


def test_ready_reports_the_pages_palette_and_priority_marks(page):
    load(page, '<h1 data-priority="1">A</h1><a data-priority="2">B</a>', '<meta name="palette" content="wada:006">')
    ready = bridge_said(page, "ready")[0]
    assert ready["palette"] == "wada:006" and ready["priorities"] == 2


def test_ready_without_palette_or_marks(page):
    load(page, "<p>x</p>")
    ready = bridge_said(page, "ready")[0]
    assert ready["palette"] is None and ready["priorities"] == 0


def test_priority_marks_drawn_on_request_and_ignored_by_picking(page):
    load(page, '<h1 data-priority="1" style="margin:40px">Big</h1><p data-priority="2">Small</p>'
               '<p data-priority="3" hidden>Gone</p>')
    bridge_said(page, "ready")
    assert page.locator(".pm-priority").count() == 0
    studio_says(page, {"type": "priorities", "on": True})
    assert page.locator(".pm-priority-badge").all_inner_texts() == ["1", "2"]  # hidden marks skipped
    offset = page.evaluate("(() => { const r = document.querySelector('.pm-priority').getBoundingClientRect();"
                           " const h = document.querySelector('h1').getBoundingClientRect();"
                           " return [r.left - h.left, r.top - h.top, r.width - h.width] })()")
    assert offset == [0, 0, 0]  # the mark sits exactly over its element
    assert page.evaluate("getComputedStyle(document.querySelector('.pm-priority')).pointerEvents") == "none"
    studio_says(page, {"type": "priorities", "on": False})
    assert page.locator(".pm-priority").count() == 0
