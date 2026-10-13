"""The studio UI (static/app.js) in real Chromium against a real server and FakeEngine:
the Paper design's behaviours that need JavaScript (docs/design/paper-handoff.md)."""

import json
import re

import pytest
from playwright.sync_api import expect, sync_playwright

from app import decisions, projects, server
from tests.conftest import ask, done, pause, result, say, tool
from tests.test_builtin import builtins  # noqa: F401 (fixture)

TWEAK_PAGE = """<!doctype html><html lang="en"><head><title>t</title>
<script type="application/json" id="tweaks">
[{"name": "--accent", "label": "Accent", "type": "color", "value": "#000000"}]
</script></head><body><h1>Hello</h1><button>Buy</button></body></html>"""


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    yield page
    context.close()


def design(name="p", html=TWEAK_PAGE, versions=1):
    slug = projects.create(name)["slug"]
    for n in range(versions):
        (projects.design_dir(slug) / "index.html").write_text(html.replace("Hello", f"Hello {n + 1}"))
        projects.commit_version(slug, f"version {n + 1}")
    return slug


def open_studio(page, base, slug):
    page.goto(f"{base}/#/p/{slug}")
    expect(page.locator("#project-name")).not_to_have_text("")


def open_settings(page):
    """Open the project-name popover: model, design system, palette, techniques, references
    (docs/gate-studio-redesign.md, section 7)."""
    if not page.locator("#project-menu").evaluate("d => d.open"):
        page.click("#project-menu summary")


def show_version(page, n):
    """Preview version n (1 is the oldest) from the History tab (section 6)."""
    page.click("#tab-history-btn")
    page.locator(".history-item", has_text=re.compile(rf"^{n} · ")).click()


def open_page(page, name):
    """Open a page from the outline on the left (section 5)."""
    page.locator(f'#outline-pages button[title="{name}"]').click()


def test_home_card_shows_model_system_and_badge(live_server, page, tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    ds = projects.create("Brand", projects.DESIGN_SYSTEM, str(source))
    slug = design("Pricing")
    projects.touch(slug, design_system=ds["slug"])
    page.goto(f"{live_server}/#/")
    cards = page.locator("#project-list li")
    expect(cards).to_have_count(1)  # design systems have their own section now
    pricing = cards.filter(has_text="Pricing")
    expect(pricing.locator(".meta")).to_have_text("Claude · Brand")
    page.click("#nav-systems")
    expect(page.locator("#projects-heading")).to_have_text("Design systems")
    expect(cards).to_have_count(1)
    expect(cards.filter(has_text="Brand").locator(".badge")).to_have_text("Design system")


def test_built_in_system_is_shown_read_only(builtins, live_server, page):
    page.goto(f"{live_server}/#/systems")
    card = page.locator("#project-list li", has_text="Brand")
    expect(card.locator(".badge")).to_have_text("Built-in system")
    expect(card.locator(".meta")).to_have_text("Claude · built in")
    expect(card.get_by_role("button", name="Duplicate Brand")).to_be_visible()
    expect(card.get_by_role("button", name="Delete Brand")).to_have_count(0)

    open_studio(page, live_server, "brand")
    expect(page.locator("#ds-source-note")).to_contain_text("design-systems/brand/ in the workspace")
    for control in ("#chat-form", "#comment-mode", "#edit-mode", "#draw-mode"):
        expect(page.locator(control)).to_be_hidden()
    expect(page.frame_locator("#canvas").locator("p")).to_have_text("Brand")

    # Another project in the same tab gets its controls back.
    open_studio(page, live_server, design("Pricing"))
    expect(page.locator("#chat-form")).to_be_visible()
    expect(page.locator("#edit-mode")).to_be_visible()


def test_design_system_form_error_marks_the_field(live_server, page):
    page.goto(f"{live_server}/#/systems")
    page.click("#new-open")  # on Systems, New opens on the design-system form
    expect(page.locator("#ds-name")).to_be_focused()
    page.fill("#ds-name", "Bad")
    page.fill("#ds-source", "relative/path")
    page.click("#new-ds button[type=submit]")
    expect(page.locator("#ds-error")).to_contain_text("absolute path")
    expect(page.locator("#ds-source")).to_have_attribute("aria-invalid", "true")


def test_running_turn_shows_live_progress_then_settles(live_server, page, fake_engine):
    fake_engine([({"index.html": TWEAK_PAGE}, [tool("Write"), pause(1.5), tool("mcp__pm__verify", "t2"),
                                               tool("mcp__linear__get_issue", "t3", ""), pause(1),
                                               say("Built it."), done()])])
    slug = projects.create("Run")["slug"]
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "make a page")
    page.keyboard.press("Enter")

    live = page.locator(".steps[data-live]")
    expect(live.locator(".step-label")).to_have_text("Writing index.html")
    expect(live.locator(".step-count")).to_contain_text("1 step · 0:0")
    expect(page.locator("#stage-pill")).to_have_text("Updates after every file write")
    expect(page.locator("#send")).to_be_disabled()
    expect(live.locator(".step-label")).to_have_text("Using linear: get_issue")  # a connector's tool

    expect(page.locator(".turn-meta")).to_contain_text("Done")
    expect(page.locator(".steps[data-live]")).to_have_count(0)
    expect(page.locator(".steps summary")).to_have_text("3 steps")
    expect(page.locator("#stage-pill")).to_be_hidden()
    expect(page.locator("#send")).to_be_enabled()


def test_tweaks_collapse_and_comment_mode_with_escape(live_server, page):
    open_studio(page, live_server, design())
    panel, pill = page.locator("#tweaks-panel"), page.locator("#tweaks-open")
    expect(panel).to_be_visible()

    page.click("#tweaks-collapse")
    expect(panel).to_be_hidden()
    expect(pill).to_be_focused()
    page.click("#tweaks-open")
    expect(panel).to_be_visible()
    expect(page.locator("#tweaks-collapse")).to_be_focused()

    page.click("#comment-mode")  # tweaks step aside while picking elements
    expect(panel).to_be_hidden()
    expect(page.locator("#stage-pill")).to_contain_text("Comment mode")
    page.keyboard.press("Escape")
    expect(page.locator("#comment-mode")).to_have_attribute("aria-pressed", "false")
    expect(panel).to_be_visible()
    expect(page.locator("#stage-pill")).to_be_hidden()


def test_escape_inside_the_canvas_leaves_comment_mode(live_server, page):
    open_studio(page, live_server, design())
    expect(page.locator("#tweaks-panel")).to_be_visible()  # bridge is ready
    page.click("#comment-mode")
    # A keydown dispatched inside the frame never reaches the studio's document; only the
    # bridge's forwarding can end comment mode here.
    page.frame_locator("#canvas").locator("body").evaluate(
        "() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
    expect(page.locator("#comment-mode")).to_have_attribute("aria-pressed", "false")


def test_tweak_change_shows_unsaved_tag(live_server, page):
    open_studio(page, live_server, design())
    expect(page.locator("#tweaks-dirty")).to_be_hidden()
    page.locator("#tweak-0").fill("#ff0000")
    expect(page.locator("#tweaks-dirty")).to_be_visible()
    expect(page.locator("#tweaks-keep")).to_be_enabled()


def test_past_version_pill(live_server, page):
    open_studio(page, live_server, design(versions=2))
    expect(page.locator("#stage-pill")).to_be_hidden()
    show_version(page, 1)
    expect(page.locator("#stage-pill")).to_have_text("Previewing version 1 of 2, not the current design")
    expect(page.locator("#restore")).to_be_visible()
    expect(page.locator(".history-item[aria-current]")).to_contain_text("1 · version 1")
    show_version(page, 2)  # back to the current design
    expect(page.locator("#stage-pill")).to_be_hidden()
    expect(page.locator("#restore")).to_be_hidden()


def test_chat_resize_by_keyboard_is_clamped_and_remembered(live_server, page):
    slug = design()
    open_studio(page, live_server, slug)
    width = lambda: page.evaluate("document.querySelector('.chat-pane').getBoundingClientRect().width")
    start = width()
    page.focus("#chat-resize")  # the panel is on the right: its handle's Left widens it
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    assert width() == start + 32
    for _ in range(30):
        page.keyboard.press("ArrowLeft")
    assert width() == 560
    page.reload()
    expect(page.locator("#project-name")).not_to_have_text("")
    assert width() == 560


def test_phone_width_switches_between_chat_and_canvas(live_server, browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        open_studio(page, live_server, design())
        expect(page.locator(".view-switch")).to_be_visible()
        expect(page.locator(".chat-pane")).to_be_visible()
        expect(page.locator(".canvas-pane")).to_be_hidden()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        page.click(".view-switch button[data-view=canvas]")
        expect(page.locator(".canvas-pane")).to_be_visible()
        expect(page.locator(".chat-pane")).to_be_hidden()
        page.select_option("#viewport-select", "390")
        expect(page.locator('.segmented button[data-width="390"]')).to_have_attribute("aria-pressed", "true")

        # Picking an element opens the comment form, which lives in the chat view.
        page.click("#comment-mode")
        page.frame_locator("#canvas").locator("h1").click()
        expect(page.locator("#comment-form")).to_be_visible()
        expect(page.locator(".view-switch button[data-view=chat]")).to_have_attribute("aria-pressed", "true")
    finally:
        context.close()


def test_long_model_name_stays_inside_a_phone(live_server, browser, monkeypatch):
    # Ollama names pulled from Hugging Face run to 80+ characters; a select sizes to its
    # longest option.
    long = "ollama:hf.co/mradermacher/gemma-4-26B-A4B-it-ultra-uncensored-heretic-i1-GGUF:i1-IQ4_XS"
    monkeypatch.setattr(server, "local_models", lambda: [long])
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        open_studio(page, live_server, design())
        expect(page.locator(f'#model-select option[value="{long}"]')).to_have_count(1)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    finally:
        context.close()


# ---------- Home: thumbnails, filter and search, phone layout ----------

def test_cards_show_a_thumbnail_or_a_placeholder(live_server, page):
    design("With page")
    projects.create("Empty")
    page.goto(f"{live_server}/#/")
    with_page = page.locator("#project-list li", has_text="With page")
    img = with_page.locator(".thumb img")
    expect(img).to_have_attribute("alt", "")
    page.wait_for_function("() => { const i = document.querySelector('.thumb img'); return i && i.complete && i.naturalWidth > 0 }")
    assert img.evaluate("i => i.naturalWidth") == 432
    expect(page.locator("#project-list li", has_text="Empty").locator(".thumb")).to_have_text("No design yet")
    # The thumbnail opens the project, without adding a second tab stop per card.
    expect(with_page.locator("a.thumb")).to_have_attribute("tabindex", "-1")
    with_page.locator(".thumb").click()
    expect(page.locator("#project-name")).to_have_text("With page")


def test_search_and_filters_by_state_and_system(live_server, page, tmp_path):
    """Search is always visible (redesign gate, section 3); filters by state and system (4)."""
    for n in range(18):
        projects.create(f"Screen {n:02d}")
    src = tmp_path / "src"
    src.mkdir()
    brand = projects.create("Brand kit", projects.DESIGN_SYSTEM, str(src))
    approved = design("Checkout")
    projects.touch(approved, approved={"sha": projects.latest_version(approved), "at": 0, "why": None})
    themed = design("Themed")
    projects.touch(themed, design_system=brand["slug"])
    page.goto(f"{live_server}/#/")
    expect(page.locator("#project-search")).to_be_visible()
    expect(page.locator("#project-list li")).to_have_count(20)
    expect(page.locator("#project-list li", has_text="Checkout").locator(".card-state")).to_have_text("Approved for build")

    page.get_by_role("button", name="Needs approval 1").click()  # Themed: the only other one with a version
    expect(page.locator("#project-list .open")).to_have_text("Themed")
    page.get_by_role("button", name="Brand kit 1").click()
    expect(page.locator("#project-list .open")).to_have_text("Themed")
    page.get_by_role("button", name="All 20").click()
    page.fill("#project-search", "screen 1")
    expect(page.locator("#project-list li")).to_have_count(8)  # Screen 10-17
    page.fill("#project-search", "nothing like this")
    expect(page.locator("#project-list li")).to_have_count(0)
    expect(page.locator("#no-matches")).to_be_visible()


def test_phone_home_has_a_tab_bar_and_the_new_sheet(live_server, browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        design("Pricing")
        page.goto(f"{live_server}/#/")
        expect(page.locator("#project-list li")).to_have_count(1)
        expect(page.locator("#new-name")).to_be_hidden()  # creating is a sheet, not a column
        expect(page.locator(".rail")).to_have_css("position", "fixed")  # the tab bar
        page.click("#new-open")
        expect(page.locator("#new-name")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    finally:
        context.close()


def test_card_actions_stay_inside_their_card_at_320px(live_server, browser, tmp_path):
    # A design system's card has the most actions: Default, New design with it, Duplicate, Delete.
    projects.create("Brand", projects.DESIGN_SYSTEM, str(tmp_path))
    context = browser.new_context(viewport={"width": 320, "height": 700})
    page = context.new_page()
    try:
        page.goto(f"{live_server}/#/systems")
        expect(page.locator("#project-list li")).to_have_count(1)
        outside = page.evaluate("""() => [...document.querySelectorAll('#project-list .actions > *')].filter(el => {
            const r = el.getBoundingClientRect(), card = el.closest('li').getBoundingClientRect();
            return r.right > card.right + 0.5 || r.right > innerWidth + 0.5; }).map(el => el.textContent)""")
        assert outside == []
        # The buttons wrap below the time; the time itself stays on one line.
        heights = page.eval_on_selector_all("#project-list .when", "ws => ws.map(w => w.getBoundingClientRect().height)")
        line = page.locator("#project-list .when").first.evaluate("e => parseFloat(getComputedStyle(e).lineHeight)")
        assert max(heights) <= line + 1, (heights, line)
    finally:
        context.close()


def test_attach_remove_and_send_files(live_server, page, fake_engine, tmp_path):
    eng = fake_engine([({}, [say("Seen it."), done()])])
    slug = projects.create("Files")["slug"]
    mock = tmp_path / "mockup.png"
    mock.write_bytes(b"\x89PNG fake")
    notes = tmp_path / "notes.md"
    notes.write_text("# brief")
    open_studio(page, live_server, slug)

    page.set_input_files("#attach-input", [str(mock), str(notes)])
    chips = page.locator("#attachment-list li")
    expect(chips).to_have_count(2)
    page.click("#attachment-list button[aria-label='Remove notes.md']")
    expect(chips).to_have_count(1)
    expect(chips).to_contain_text("mockup.png")

    page.click("#send")  # no text: files alone can be sent
    expect(page.locator(".msg.user .msg-files a")).to_have_text("mockup.png")
    expect(page.locator("#attachment-list")).to_be_hidden()
    expect(page.locator(".turn-meta")).to_contain_text("Done")
    assert "mockup.png" in eng.prompts[0]["prompt"] and "notes.md" not in eng.prompts[0]["prompt"]


def test_edit_mode_changes_are_saved_as_a_version(live_server, page):
    slug = design("Editable")
    open_studio(page, live_server, slug)
    expect(page.locator("#tweaks-panel")).to_be_visible()  # bridge ready
    page.click("#edit-mode")
    expect(page.locator("#edit-panel")).to_be_visible()
    expect(page.locator("#tweaks-panel")).to_be_hidden()
    expect(page.locator("#tweaks-open")).to_be_hidden()  # would sit on top of the inspector
    expect(page.locator("#stage-pill")).to_contain_text("Edit mode")

    frame = page.frame_locator("#canvas")
    frame.locator("h1").click()
    expect(page.locator("#edit-target")).to_contain_text("<h1>")
    page.fill("#edit-pad-y", "24")
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).paddingTop") == "24px"
    frame.locator("h1").dblclick()
    page.keyboard.press("Control+A")
    page.keyboard.type("Hello there")
    page.keyboard.press("Enter")
    expect(page.locator("#edit-count")).to_have_text("3 unsaved")  # padding top + bottom, text

    page.click("#edit-save")
    expect(page.locator("#status")).to_have_text("Edits saved as a new version.")
    html = (projects.design_dir(slug) / "index.html").read_text()
    assert "<h1>Hello there</h1>" in html and "data-studio-edits" in html
    assert "padding-top: 24px !important" in (projects.design_dir(slug) / "studio-edits.css").read_text()
    assert projects.list_versions(slug)[-1]["message"] == "Direct edits"
    expect(page.locator("#edit-count")).to_be_hidden()

    # Each change is Rex's decision, with the value it replaced read from the page.
    logged = decisions.read(decisions.path(projects.data_dir(slug)))
    by_prop = {r["subject"]["property"]: r for r in logged}
    assert set(by_prop) == {"padding-top", "padding-bottom", "text"}
    assert (by_prop["padding-top"]["from"], by_prop["padding-top"]["chose"]) == ("0px", "24px")
    assert by_prop["text"]["chose"] == "Hello there" and by_prop["text"]["topic"] == "copy"
    # He may say why, in his own words; nothing is filled in for him.
    why = page.locator(".msg.why-card")
    expect(why.get_by_label("Logged as 3 decisions. Why? (optional)")).to_have_value("")
    why.get_by_label("Logged as 3 decisions. Why? (optional)").fill("more air above the title")
    why.get_by_role("button", name="Add reason").click()
    expect(why).to_have_text("Reason added.")
    reasons = [r for r in decisions.read(decisions.path(projects.data_dir(slug))) if r["why"]]
    assert len(reasons) == 3 and {r["why"] for r in reasons} == {"more air above the title"}

    page.keyboard.press("Escape")
    expect(page.locator("#edit-mode")).to_have_attribute("aria-pressed", "false")
    expect(page.locator("#tweaks-panel")).to_be_visible()


def test_claude_code_link_indicator(live_server, page):
    slug = design("Linked")
    open_studio(page, live_server, slug)
    expect(page.locator("#link-note")).to_be_hidden()
    projects.mark_linked(slug)
    open_studio(page, live_server, slug)
    page.reload()
    expect(page.locator("#link-note")).to_have_text("Claude Code · just now")


def test_canvas_follows_links_between_pages(live_server, page):
    slug = design("Flow", "<!doctype html><title>t</title><h1>Hello</h1><a href='pricing.html'>See pricing</a>")
    (projects.design_dir(slug) / "pricing.html").write_text(
        "<!doctype html><title>p</title><h2>Plans</h2><a href='index.html'>Back</a>")
    projects.commit_version(slug, "pricing")
    projects.touch(slug)
    from app import comments
    comments.add(projects.comments_path(slug), "h2", "h2", "Plans", "Say more", "pricing.html")
    open_studio(page, live_server, slug)
    expect(page.locator("#outline-pages button")).to_have_text(["index.html", "pricing.html"])
    frame = page.frame_locator("#canvas")
    expect(frame.locator(".pm-pin")).to_have_count(0)  # the comment is on the other page

    frame.locator("a").click()  # a link inside the design
    expect(frame.locator("h2")).to_have_text("Plans")
    expect(page.locator("#page-select")).to_have_value("pricing.html")
    expect(page.locator('#outline-pages button[aria-current="page"]')).to_have_text("pricing.html")
    expect(page.locator("#open-tab")).to_have_attribute("href", f"/p/{slug}/pricing.html")
    expect(frame.locator(".pm-pin")).to_have_count(1)
    page.click("#comment-mode")  # the studio's tools work on the new page
    frame.locator("h2").click()
    expect(page.locator("#comment-form")).to_be_visible()
    page.fill("#comment-note", "Bigger")
    page.click("#comment-form button[type=submit]")
    expect(page.locator("#comment-list li")).to_have_count(2)
    assert comments.open_comments(projects.comments_path(slug))[-1]["page"] == "pricing.html"

    open_page(page, "index.html")
    expect(frame.locator("h1")).to_have_text("Hello 1")


PALETTE_PAGE = ("<!doctype html><title>t</title><meta name=palette content='wada:006'>"
                "<body style='background:#f48067;color:#051230'><h1 data-priority=1>Hello</h1>"
                "<p data-priority=2>Body</p></body>")


def test_page_palette_is_shown_and_offered_in_edit_mode(live_server, page):
    slug = design("Paletted", PALETTE_PAGE)
    (projects.design_dir(slug) / "plain.html").write_text("<!doctype html><title>p</title><h1>Plain</h1>")
    projects.commit_version(slug, "plain")
    open_studio(page, live_server, slug)
    note = page.locator("#palette-note")
    expect(note).to_contain_text("Palette · Wada 006")
    expect(note.locator(".swatch")).to_have_count(2)
    expect(note.locator(".swatch[aria-label='Deep Indigo #051230']")).to_have_attribute("title", "Deep Indigo #051230")

    page.click("#edit-mode")
    frame = page.frame_locator("#canvas")
    frame.locator("h1").click()
    expect(page.locator("#edit-color-token option")).to_have_text(
        ["Custom", "Grenadine Pink · #f48067", "Deep Indigo · #051230"])
    expect(page.locator("#edit-color-token")).to_have_value("#051230")  # the h1's current colour
    page.select_option("#edit-color-token", "#f48067")
    expect(page.locator("#edit-color")).to_have_value("#f48067")
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).color") == "rgb(244, 128, 103)"
    page.click("#edit-discard")
    page.click("#edit-mode")

    open_page(page, "plain.html")  # a page without a palette
    expect(frame.locator("h1")).to_have_text("Plain")
    expect(note).to_be_hidden()


def test_palette_browser_filters_and_drafts_a_message(live_server, page):
    slug = design("Browsing", PALETTE_PAGE)
    open_studio(page, live_server, slug)
    expect(page.locator("#project-chip")).to_have_text("Wada 006")
    open_settings(page)
    expect(page.locator("#palette-note")).to_be_visible()
    page.click("#palette-browse")
    dialog = page.locator("#palette-browser")
    expect(dialog).to_be_visible()
    expect(page.locator("#palette-count")).to_have_text("348 of 348 combinations")
    current = page.locator(".palette-item[aria-current=true]")
    expect(current).to_have_attribute("data-number", "6")  # this page's palette is marked
    expect(current.locator(".palette-number")).to_have_text("Wada 006 · current")
    # Each tile's name is its visible text (WCAG 2.5.3, label in name).
    expect(current).to_have_accessible_name(re.compile(r"^Wada 006 · current Grenadine Pink, Deep Indigo contrast-tone"))

    page.select_option("#pf-size", "2")
    expect(page.locator("#palette-count")).to_have_text("120 of 348 combinations")
    page.check("#pf-text")
    page.select_option("#pf-harmony", "contrast-tone")
    sizes = page.eval_on_selector_all(".palette-item .palette-strip", "ss => ss.map(s => s.children.length)")
    assert sizes and set(sizes) == {2}
    ratios = page.eval_on_selector_all(".palette-tags", "ts => ts.map(t => parseFloat(t.textContent.split('text ')[1]))")
    assert min(ratios) >= 4.5
    page.fill("#pf-search", "indigo")
    names = page.eval_on_selector_all(".palette-names", "ns => ns.map(n => n.textContent)")
    assert names and all("indigo" in n.lower() for n in names)

    page.locator(".palette-item[data-number='6']").click()
    expect(dialog).to_be_hidden()
    expect(page.locator("#chat-input")).to_have_value(
        "Use Wada 006 (Grenadine Pink #f48067, Deep Indigo #051230) as the palette for this design.")
    expect(page.locator("#chat-input")).to_be_focused()

    open_settings(page)
    page.click("#palette-browse")
    page.keyboard.press("Escape")  # a native dialog closes on Esc
    expect(dialog).to_be_hidden()


def test_palette_browser_only_without_a_design_system(live_server, page, tmp_path):
    ds = projects.create("Brand", projects.DESIGN_SYSTEM, str(tmp_path))
    slug = design("Systemed")
    open_studio(page, live_server, slug)
    open_settings(page)
    expect(page.locator("#palette-browse")).to_be_visible()  # no palette yet: still offered
    page.select_option("#ds-select", ds["slug"])
    expect(page.locator("#palette-browse")).to_be_hidden()
    expect(page.locator("#project-chip")).to_have_text("Brand")
    open_studio(page, live_server, ds["slug"])
    open_settings(page)
    expect(page.locator("#palette-browse")).to_be_hidden()


def test_palette_browser_fits_a_phone(live_server, browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        open_studio(page, live_server, design("Phone palette", PALETTE_PAGE))
        open_settings(page)
        page.click("#palette-browse")
        expect(page.locator("#palette-browser")).to_be_visible()
        width = page.locator("#palette-browser").evaluate("e => e.getBoundingClientRect().width")
        assert width <= 390
        assert page.locator("#palette-grid").evaluate("e => e.scrollWidth <= e.clientWidth")
    finally:
        context.close()


def test_techniques_browser_shows_a_live_demo_and_drafts_a_message(live_server, page):
    open_studio(page, live_server, design("Textured"))
    open_settings(page)
    page.click("#technique-browse")
    dialog = page.locator("#technique-browser")
    expect(dialog).to_be_visible()
    expect(page.locator("#technique-count")).to_have_text("41 of 41 techniques")
    expect(page.locator("#technique-grid .technique-item img").first).to_have_attribute("src", re.compile(r"\.png$"))

    page.select_option("#tf-kind", "three")
    kinds = page.eval_on_selector_all("#technique-grid .technique-kind", "ks => ks.map(k => k.textContent)")
    assert kinds and set(kinds) == {"three"}
    page.select_option("#tf-kind", "")
    page.fill("#tf-search", "grain")
    expect(page.locator("#technique-grid [data-id='noise-grain']")).to_be_visible()
    expect(page.locator("#technique-grid [data-id='noise-grain']")).to_have_accessible_name(
        re.compile(r"^Noise grain svg Resolution-independent film grain"))

    page.click("#technique-grid [data-id='noise-grain']")
    expect(page.locator("#technique-detail")).to_be_visible()
    expect(page.locator("#technique-name")).to_have_text("Noise grain")
    expect(page.locator("#technique-demo")).to_have_attribute("src", "/library/demo/noise-grain")
    expect(page.frame_locator("#technique-demo").locator("#stage svg")).to_have_count(1)  # the live demo
    page.click(".technique-notes summary >> nth=0")
    expect(page.locator("#technique-notes")).to_contain_text("feTurbulence")
    # The parameter map: what each knob does, its range, and the sweep's strip as evidence.
    page.click(".technique-notes summary >> nth=1")
    opacity = page.locator(".technique-param", has_text="opacity")
    expect(opacity.locator("code")).to_have_text("opacity")
    expect(opacity).to_contain_text("0.05–0.6, default 0.22")
    expect(opacity).to_contain_text("How strongly the grain shows")
    expect(opacity.locator("img")).to_have_attribute("src", "/creative-library/recipes/web/sweeps/noise-grain/opacity.png")
    expect(opacity.locator("a")).to_have_attribute("href", "/creative-library/recipes/web/sweeps/noise-grain/opacity.png")
    expect(opacity.locator(".technique-param-note")).to_contain_text("Flat between 0.05 and 0.11")
    expect(page.locator("#technique-use")).to_have_text("Use on this design")
    page.click("#technique-use")
    expect(dialog).to_be_hidden()
    expect(page.locator("#chat-input")).to_have_value(
        "Use the Noise grain technique from the library (creative-library/recipes/web/noise-grain.js) in this design.")

    open_settings(page)
    page.click("#technique-browse")  # reopens on the list, not the last detail
    expect(page.locator("#technique-list")).to_be_visible()
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()


def test_techniques_answer_a_design_ask(live_server, page):
    open_studio(page, live_server, design("Asking"))
    open_settings(page)
    page.click("#technique-browse")
    # The README's ask, from its example chip: ranked by the library's intent index.
    page.click("#technique-list .intent-examples >> text=make this feel hand-made")
    expect(page.locator("#tf-search")).to_have_value("make this feel hand-made")
    expect(page.locator("#technique-count")).to_contain_text("for “make this feel hand-made”, best first")
    top = page.eval_on_selector_all("#technique-grid .technique-item", "bs => bs.slice(0, 3).map(b => b.dataset.id)")
    assert {"noise-grain", "squiggle-wobble", "pattern-hatch"} & set(top), top
    why = page.locator("#technique-grid [data-id='squiggle-wobble'] .technique-why")
    expect(why).to_have_text("For: wobbly hand-drawn lines")

    page.fill("#tf-search", "a retro broken screen")  # broken ~ corrupted, screen ~ tv: synonyms
    first = page.locator("#technique-grid .technique-item").first
    expect(first).to_have_attribute("data-id", "vhs-glitch")
    expect(first.locator(".technique-why")).to_have_text(re.compile(r"^For: (VHS tape glitch|corrupted signal|retro TV)$"))

    page.fill("#tf-search", "add depth without 3D")  # a negation keeps three.js out
    ids = page.eval_on_selector_all("#technique-grid .technique-item", "bs => bs.map(b => b.dataset.id)")
    assert ids and ids[0] == "liquid-glass" and not any(i.startswith("three-") for i in ids), ids
    page.fill("#tf-search", "kerberos authentication ticket")
    expect(page.locator("#technique-count")).to_have_text("Nothing in the library for “kerberos authentication ticket” yet.")
    expect(page.locator("#technique-grid li")).to_have_count(0)


def test_apply_a_technique_to_the_edit_mode_selection(live_server, page):
    open_studio(page, live_server, design("Selecting"))
    page.click("#edit-mode")
    page.frame_locator("#canvas").locator("h1").click()
    page.click("#edit-technique")
    page.click("#technique-grid [data-id='halftone']")
    expect(page.locator("#technique-target")).to_have_text('For the selected <h1> "Hello 1"')
    page.click("#technique-use")
    value = page.locator("#chat-input").input_value()
    assert value.startswith('Apply the Halftone technique from the library (creative-library/recipes/web/halftone.js) '
                            'to the selected <h1> "Hello 1" (`') and value.endswith("`).")


def test_turn_footer_opens_the_technique_it_names(live_server, page, fake_engine):
    lib = "/home/x/ultimate-design/creative-library"
    fake_engine([({}, [tool("Read", "t1", f"{lib}/recipes/web/halftone.js"), say("Built."), done()])])
    open_studio(page, live_server, design("Footer"))
    page.fill("#chat-input", "make it printed")
    page.keyboard.press("Enter")
    page.click(".turn-techniques .link-button")
    expect(page.locator("#technique-detail")).to_be_visible()
    expect(page.locator("#technique-name")).to_have_text("Halftone")


def test_library_and_systems_start_designs_from_techniques_palettes_and_systems(live_server, page, tmp_path):
    ds = projects.create("Brand", projects.DESIGN_SYSTEM, str(tmp_path))
    page.goto(f"{live_server}/#/")
    page.click("#nav-library")
    expect(page.locator("#library")).to_be_visible()
    expect(page.locator(".home-body")).to_be_hidden()
    expect(page.locator("#nav-library")).to_have_attribute("aria-current", "page")
    expect(page.locator("#library-technique-count")).to_have_text("41 of 41 techniques")

    page.click("#library-technique-grid [data-id='halftone']")
    expect(page.locator("#technique-use")).to_have_text("Start a design with it")
    page.click("#technique-use")
    expect(page.locator("#project-name")).to_have_text("Halftone")
    expect(page.locator("#chat-input")).to_have_value(
        "Use the Halftone technique from the library (creative-library/recipes/web/halftone.js) in this design.")

    page.goto(f"{live_server}/#/library")
    page.click(".library-tabs [data-tab=palettes]")
    expect(page.locator("#library-palette-count")).to_have_text("348 of 348 combinations")
    page.select_option("#lp-size", "4")
    expect(page.locator("#library-palette-count")).to_have_text("108 of 348 combinations")
    page.click("#library-palette-grid [data-number='348']")
    expect(page.locator("#project-name")).to_have_text("Wada 348")
    expect(page.locator("#chat-input")).to_have_value(re.compile(r"^Use Wada 348 \(.+\) as the palette for this design\.$"))

    page.goto(f"{live_server}/#/systems")  # systems are their own section, not a library tab
    card = page.locator("#project-list li", has_text="Brand")
    card.get_by_role("button", name="New design with Brand").click()
    expect(page.locator("#project-name")).to_have_text("Brand design")
    slug = page.evaluate("location.hash").split("/")[-1]
    assert projects.get(slug)["design_system"] == ds["slug"]

    page.click("text=All projects")  # back to Home lands on Projects, not the Library
    expect(page.locator(".home-body")).to_be_visible()
    expect(page.locator("#nav-projects")).to_have_attribute("aria-current", "page")


def test_library_and_technique_detail_fit_a_phone(live_server, browser):
    narrow = browser.new_context(viewport={"width": 320, "height": 700})
    try:
        page = narrow.new_page()
        page.goto(f"{live_server}/#/library")
        expect(page.locator("#library-technique-grid .technique-item").first).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")  # tabs scroll, not the page
    finally:
        narrow.close()
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        page.goto(f"{live_server}/#/library")
        expect(page.locator("#library-technique-grid .technique-item").first).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.click("#library-technique-grid [data-id='halftone']")
        expect(page.locator("#technique-detail")).to_be_visible()
        assert page.locator("#technique-browser").evaluate("e => e.getBoundingClientRect().width") <= 390
        assert page.locator("#technique-detail").evaluate("e => e.scrollWidth <= e.clientWidth")
    finally:
        context.close()


def test_priority_marks_toggle_only_where_the_page_has_them(live_server, page):
    slug = design("Ranked", PALETTE_PAGE)
    open_studio(page, live_server, slug)
    toggle = page.locator("#priority-mode")
    expect(toggle).to_be_visible()
    expect(toggle).to_have_attribute("title", "Show priority marks")
    # It is a way of looking at the canvas, so it sits in the toolbar, and the bar stays one row.
    middles = {page.locator(s).evaluate("e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }")
               for s in ("#reload", "#priority-mode", "#export", "#approve")}
    assert max(middles) - min(middles) <= 1, middles  # one row: controls of different heights, centred
    toggle.click()
    expect(toggle).to_have_attribute("aria-pressed", "true")
    frame = page.frame_locator("#canvas")
    expect(frame.locator(".pm-priority-badge")).to_have_text(["1", "2"])
    page.click("#reload")  # stays on across a reload
    expect(frame.locator(".pm-priority-badge")).to_have_count(2)
    toggle.click()
    expect(frame.locator(".pm-priority")).to_have_count(0)

    open_studio(page, live_server, design("Unranked"))
    expect(page.locator("#priority-mode")).to_be_hidden()


def test_priority_toggle_keeps_its_label_on_a_phone(live_server, browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    try:
        open_studio(page, live_server, design("Ranked", PALETTE_PAGE))
        toggle = page.locator("#priority-mode")
        expect(toggle).to_have_text("Priority marks")
        assert toggle.evaluate("e => e.scrollWidth <= e.clientWidth")  # phone toolbar toggles go icon-only
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    finally:
        context.close()


def test_turn_shows_tokens_techniques_and_the_project_total(live_server, page, fake_engine):
    lib = "/home/x/ultimate-design/creative-library"
    tokens = {"input": 1200, "output": 3400, "cache_read": 52000, "cache_write": 900}
    fake_engine([({}, [tool("Read", "t1", f"{lib}/palettes/wada/combinations.md"),
                       tool("Read", "t2", f"{lib}/recipes/web/halftone.js"),
                       tool("Read", "t3", f"{lib}/recipes/web/registry.js"),
                       say("Built."), {**done(), "tokens": tokens}])])
    slug = design("Costed")
    open_studio(page, live_server, slug)
    expect(page.locator("#usage-note")).to_be_hidden()
    page.fill("#chat-input", "make a page")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta").first).to_have_text(
        "Done · $0.100 API-equivalent · 1.2k in · 3.4k out · 52.0k cache read")
    expect(page.locator(".turn-techniques")).to_have_text("From the technique library: Wada palettes, halftone")
    expect(page.locator("#usage-note")).to_have_text("1 turn · $0.10 API-equivalent")
    page.reload()  # the same, rebuilt from the saved chat and the server's total
    expect(page.locator(".turn-techniques")).to_have_text("From the technique library: Wada palettes, halftone")
    expect(page.locator("#usage-note")).to_have_text("1 turn · $0.10 API-equivalent")
    expect(page.locator("#usage-note")).to_have_attribute(
        "title", "Tokens so far: 1.2k in · 3.4k out · 52.0k cache read, 900 cache write")


def test_icon_buttons_have_tooltips_and_the_zoom_shows_its_scale(live_server, page):
    page.goto(f"{live_server}/#/")
    expect(page.locator("#nav-library")).to_have_attribute("href", "#/library")  # the Library is in the app
    open_studio(page, live_server, design("Tips"))
    labels = page.eval_on_selector_all(".btn-icon[aria-label]", "bs => bs.map(b => [b.getAttribute('aria-label'), b.title])")
    assert labels and all(label == title for label, title in labels), labels
    zoom = page.locator("#zoom")
    expect(zoom).to_have_text(re.compile(r"^\d+%$"))
    expect(zoom).to_have_attribute("title", re.compile(r"^1440px at \d+%$"))


def test_edit_colour_from_the_design_system_and_align(live_server, page):
    slug = design("Coloured", "<!doctype html><title>t</title><link rel=stylesheet href='design-system/tokens.css'>"
                              "<h1>Hello</h1><p style='margin-left:40px'>Body</p>")
    (projects.design_dir(slug) / "design-system").mkdir()
    (projects.design_dir(slug) / "design-system" / "tokens.css").write_text(":root { --ink: #3d4a8f; }")
    open_studio(page, live_server, slug)
    page.click("#edit-mode")
    frame = page.frame_locator("#canvas")
    frame.locator("h1").click()
    expect(page.locator("#edit-color-token option")).to_have_text(["Custom", "ink"])
    page.select_option("#edit-color-token", "var(--ink)")
    expect(page.locator("#edit-color")).to_have_value("#3d4a8f")
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).color") == "rgb(61, 74, 143)"

    frame.locator("p").click(modifiers=["Shift"])
    expect(page.locator("#edit-align-group")).to_be_visible()
    expect(page.locator("#edit-fields")).to_be_hidden()
    page.click("[data-edge=left]")
    lefts = [frame.locator(s).evaluate("e => e.getBoundingClientRect().left") for s in ("h1", "p")]
    assert lefts[0] == lefts[1]

    page.click("#edit-save")
    expect(page.locator("#status")).to_have_text("Edits saved as a new version.")
    css = (projects.design_dir(slug) / "studio-edits.css").read_text()
    assert "color: var(--ink) !important" in css and "translate: -40px 0px !important" in css


def test_branch_from_a_past_version(live_server, page):
    slug = design("Tree", versions=2)
    open_studio(page, live_server, slug)
    show_version(page, 1)
    page.click("#branch")
    expect(page.locator("#project-name")).to_have_text("Tree (branch)")
    expect(page.frame_locator("#canvas").locator("h1")).to_have_text("Hello 1")


def test_default_system_starters_and_connectors_on_home(live_server, page, tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    ds = projects.create("Brand", projects.DESIGN_SYSTEM, str(source))
    (projects.design_dir(ds["slug"]) / "tokens.css").write_text(":root { --ink: #111; }")
    page.goto(f"{live_server}/#/systems")
    card = page.locator("#project-list li").filter(has_text="Brand")
    card.get_by_role("button", name="Default for new designs: Brand").click()
    expect(card.locator(".badge")).to_have_text("Default system")
    expect(page.locator("#new-ds-select")).to_have_value(ds["slug"])

    page.click("#nav-projects")
    page.click("#new-open")
    page.locator("#connectors summary").click()
    page.fill("#connector-name", "notes")
    page.fill("#connector-config", "not json")
    page.click("#new-connector button[type=submit]")
    expect(page.locator("#connector-error")).to_have_text("The config is not valid JSON.")
    page.fill("#connector-config", '{"command": "notes-mcp"}')
    page.click("#new-connector button[type=submit]")
    expect(page.locator("#connector-list li")).to_have_text("notesnotes-mcp")

    page.get_by_role("button", name="Dashboard").click()  # a starter
    expect(page.locator("#project-name")).to_have_text("Dashboard")
    expect(page.locator("#chat-input")).to_have_value(re.compile("^An analytics dashboard"))
    expect(page.locator("#ds-select")).to_have_value(ds["slug"])
    open_settings(page)
    page.locator("#connector-choice summary").click()
    page.get_by_role("checkbox", name="notes").check()
    expect(page.locator("#connector-summary")).to_have_text("Connectors · 1 on")
    slug = page.url.rsplit("/", 1)[1]
    assert projects.get(slug)["connectors"] == ["notes"]


def test_design_system_from_uploaded_files(live_server, page, tmp_path):
    logo = tmp_path / "logo.svg"
    logo.write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    page.goto(f"{live_server}/#/systems")
    page.click("#new-open")
    page.fill("#ds-name", "From files")
    page.click("#ds-create")
    expect(page.locator("#ds-error")).to_have_text("Give a source, attach files, or both.")
    page.set_input_files("#ds-files", str(logo))
    expect(page.locator("#ds-files-names")).to_have_text("logo.svg")
    page.click("#ds-create")
    expect(page.locator("#project-name")).to_have_text("From files")
    expect(page.locator("#attachment-list li")).to_have_text("logo.svg")
    expect(page.locator("#chat-input")).to_have_value("Extract the design system from the attached files.")
    expect(page.locator("#ds-source-note")).to_have_text("Extracted from attached files")


def test_questions_form_answers_in_one_click_and_closes(live_server, page, fake_engine):
    eng = fake_engine([
        ({}, [ask([{"text": "Who is it for?", "options": ["Owners", "Accountants"]},
                   {"text": "Which plans matter?", "options": ["Solo", "Team", "Firm"], "multiple": True},
                   {"text": "Anything to include?"}]), result(), say("A few questions first."), done()]),
        ({"index.html": TWEAK_PAGE}, [say("Built."), done()]),
    ])
    slug = projects.create("Asker")["slug"]
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a pricing page")
    page.keyboard.press("Enter")
    card = page.locator(".msg.questions")
    expect(card.get_by_role("heading")).to_have_text("A few questions first")
    # The agent's intro streams after its questions; the form still comes last in the turn.
    expect(page.locator(".turn-meta")).to_have_count(1)
    assert page.evaluate("[...document.querySelectorAll('#chat-log > *')].map(e => e.className.replace(' enter', '')).slice(-3)") == [
        "msg assistant", "msg questions", "turn-meta"]
    card.get_by_label("Accountants").check()
    card.get_by_label("Team").check()
    card.get_by_label("Firm").check()
    card.get_by_label("Your answer").fill("a money-back line")
    card.get_by_role("button", name="Send answers").click()
    expect(page.locator(".turn-meta")).to_have_count(2)
    assert eng.prompts[1]["prompt"] == (
        "Answers to your questions:\n1. Who is it for?\n   Accountants\n2. Which plans matter?\n   Team, Firm\n"
        "3. Anything to include?\n   a money-back line")
    expect(card.get_by_role("button", name="Send answers")).to_be_disabled()  # answered once
    # The two questions with options are Rex's picks; the free-text one is not a choice.
    picks = decisions.read(decisions.path(projects.data_dir(slug)))
    assert [(p["chose"], p["over"]) for p in picks] == [
        ("Accountants", ["Owners"]), (["Team", "Firm"], ["Solo"])]
    page.reload()  # history: the answered card stays closed
    expect(page.locator(".msg.questions button").first).to_be_disabled()


def test_just_build_it(live_server, page, fake_engine):
    eng = fake_engine([({}, [ask([{"text": "Who is it for?"}]), result(), done()]),
                       ({}, [say("Built."), done()])])
    slug = projects.create("Skipper")["slug"]
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a page")
    page.keyboard.press("Enter")
    page.get_by_role("button", name="Just build it").click()
    expect(page.locator(".turn-meta")).to_have_count(2)
    assert eng.prompts[1]["prompt"].startswith("No preference on these. Build it with your own assumptions")


def test_selection_and_view_go_with_the_message(live_server, page, fake_engine):
    eng = fake_engine([({}, [say("Bigger."), done()])])
    slug = design("Contextual")
    open_studio(page, live_server, slug)
    page.click("[data-width='390']")
    page.click("#edit-mode")
    page.frame_locator("#canvas").locator("h1").click()
    expect(page.locator("#edit-target")).to_contain_text("<h1>")
    page.fill("#chat-input", "make this bigger")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta")).to_have_count(1)
    prompt = eng.prompts[0]["prompt"]
    assert "looking at index.html at 390px (mobile)" in prompt and "selected <h1> \"Hello 1\" (`body > h1`)" in prompt
    expect(page.locator(".msg.user .msg-context")).to_have_text("On 390px · <h1> “Hello 1”")


def test_references_connect_and_disconnect(live_server, page, tmp_path):
    repo = tmp_path / "shop-app"
    repo.mkdir()
    slug = design("Referenced")
    open_studio(page, live_server, slug)
    open_settings(page)
    page.locator("#reference-choice summary").click()
    page.fill("#reference-source", "not/absolute")
    page.click("#reference-add")
    expect(page.locator("#reference-error")).to_contain_text("absolute path")
    page.fill("#reference-source", str(repo))
    page.click("#reference-add")
    expect(page.locator("#reference-list li")).to_have_text(str(repo))
    expect(page.locator("#reference-summary")).to_have_text("References · 1")
    assert projects.get(slug)["references"][0]["source"] == str(repo)
    page.get_by_role("button", name=f"Disconnect {repo}").click()
    expect(page.locator("#reference-list")).to_be_hidden()
    assert projects.get(slug)["references"] == []


def board_project(name="Boarded"):
    import json
    slug = design(name)
    folder = projects.design_dir(slug)
    (folder / "directions").mkdir()
    for key, label in (("a", "Warm"), ("b", "Dense")):
        (folder / "directions" / f"{key}.html").write_text(f"<!doctype html><title>{key}</title><h1>{label}</h1>")
    (folder / "board.json").write_text(json.dumps({"rows": ["Screens", "Directions"], "frames": [
        {"page": "index.html", "title": "Home"}, {"page": "index.html", "title": "Home, phone", "width": 390},
        {"page": "directions/a.html", "title": "A · Warm", "row": 1},
        {"page": "directions/b.html", "title": "B · Dense", "row": 1}]}))
    projects.commit_version(slug, "board")
    return slug


def test_board_shows_frames_in_rows_and_opens_one(live_server, page):
    slug = board_project()
    open_studio(page, live_server, slug)
    page.click("#view-board")
    board = page.locator("#board")
    expect(board.locator(".board-row-title")).to_have_text(["Screens", "Directions"])
    expect(board.locator(".frame-title")).to_have_text(["Home", "Home, phone", "A · Warm", "B · Dense"])
    expect(page.locator("#canvas-box")).to_be_hidden()
    expect(page.locator("#comment-mode")).to_be_disabled()
    expect(page.locator("#edit-mode")).to_be_disabled()
    expect(page.locator("#tweaks-panel")).to_be_hidden()
    expect(page.locator(".toolbar .viewport")).to_be_hidden()
    phone = board.locator(".board-frame").nth(1).locator(".frame-view")
    assert phone.evaluate("e => e.style.width") == "390px"

    board.locator(".board-frame").nth(3).locator(".frame-view").click()
    expect(board.locator(".board-frame[data-selected] .frame-title")).to_have_text("B · Dense")
    expect(page.locator("#stage-pill")).to_contain_text("“B · Dense” selected")

    page.get_by_role("button", name="Open Home, phone").click()
    expect(page.locator("#view-page")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#canvas-box")).to_be_visible()
    expect(page.locator(".toolbar .viewport [data-width='390']")).to_have_attribute("aria-pressed", "true")
    expect(page.frame_locator("#canvas").locator("h1")).to_have_text("Hello 1")


def test_board_zoom_and_fit(live_server, page):
    slug = board_project("Zoomed")
    open_studio(page, live_server, slug)
    page.click("#view-board")
    expect(page.locator(".board-frame")).to_have_count(4)
    level = page.locator("#board-zoom-level")
    fitted = level.inner_text()
    page.click("#board-zoom-in")
    expect(level).not_to_have_text(fitted)
    before = level.inner_text()
    page.click("#board-zoom-out")
    page.click("#board-zoom-out")
    assert int(level.inner_text().rstrip("%")) < int(before.rstrip("%"))
    page.click("#board-fit")
    expect(level).to_have_text(fitted)
    page.locator("#board").focus()
    page.keyboard.press("+")
    expect(level).not_to_have_text(fitted)


def test_board_selection_goes_with_the_message_and_the_board_refreshes(live_server, page, fake_engine):
    import json
    new_board = json.dumps({"rows": ["Screens"], "frames": [{"page": "index.html", "title": "Home v2"}]})
    eng = fake_engine([({"board.json": new_board}, [tool("Write", "t1", "board.json"), say("Done."), done()])])
    slug = board_project("Chatty")
    open_studio(page, live_server, slug)
    page.click("#view-board")
    page.locator(".board-frame").nth(2).locator(".frame-view").click()
    page.fill("#chat-input", "make this one darker")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta")).to_have_count(1)
    assert "selected the frame for directions/a.html at 1440px" in eng.prompts[0]["prompt"]
    expect(page.locator(".frame-title").first).to_have_text("Home v2")  # reloaded after the write


def test_past_version_disables_the_board(live_server, page):
    slug = design("Old", versions=2)
    open_studio(page, live_server, slug)
    show_version(page, 1)
    expect(page.locator("#view-board")).to_be_disabled()
    expect(page.locator("#approve")).to_be_disabled()  # approval is of the current design


def test_top_bar_never_overflows_the_window(live_server, page):
    # With several pages, both views: Approve for build stays inside the window.
    slug = board_project("Crowded")
    open_studio(page, live_server, slug)
    for view in ("#view-page", "#view-board"):
        page.click(view)
        approve = page.locator("#approve").bounding_box()
        assert approve["x"] + approve["width"] <= page.evaluate("innerWidth"), view


def test_top_bar_fits_one_row_at_1440_with_several_pages(live_server, page):
    slug = board_project("One row")
    open_studio(page, live_server, slug)
    expect(page.locator("#outline-pages button")).not_to_have_count(0)
    expect(page.locator("#page-picker")).to_be_hidden()  # the outline lists the pages on a desk
    boxes = [page.locator(sel).bounding_box() for sel in ("#project-name", "#view-page", "#export summary", "#approve")]
    middles = {round(b["y"] + b["height"] / 2) for b in boxes}
    assert max(middles) - min(middles) <= 1, middles


FLEX_PAGE = """<!doctype html><html lang="en"><title>t</title><body>
<h1>Hello</h1><div id="row" style="display:flex;gap:8px"><p id="a">Alpha</p><p id="b">Beta</p></div>
<p id="note">A note</p></body></html>"""


def test_type_controls_are_contextual_live_and_saved(live_server, page):
    slug = design("Typed", FLEX_PAGE)
    open_studio(page, live_server, slug)
    page.click("#edit-mode")
    frame = page.frame_locator("#canvas")
    frame.locator("#row").click(position={"x": 400, "y": 4})  # the flex container, not a child
    expect(page.locator("#edit-gap")).to_be_visible()
    frame.locator("h1").click()
    expect(page.locator("#edit-gap")).to_be_hidden()  # not a flex or grid container
    expect(page.locator(".edit-type")).to_be_visible()
    page.select_option("#edit-weight", "300")
    page.fill("#edit-tracking", "2")
    page.fill("#edit-leading", "1.1")
    h1 = frame.locator("h1")
    assert h1.evaluate("e => [getComputedStyle(e).fontWeight, getComputedStyle(e).letterSpacing]") == ["300", "2px"]
    page.click("#edit-save")
    expect(page.locator("#status")).to_have_text("Edits saved as a new version.")
    css = (projects.design_dir(slug) / "studio-edits.css").read_text()
    assert "font-weight: 300 !important" in css and "letter-spacing: 2px !important" in css
    assert "line-height: 1.1 !important" in css


def test_delete_duplicate_and_wrap(live_server, page):
    slug = design("Structured", FLEX_PAGE)
    open_studio(page, live_server, slug)
    page.click("#edit-mode")
    frame = page.frame_locator("#canvas")
    frame.locator("#note").click()
    page.click("#edit-delete")
    expect(frame.locator("#note")).to_be_hidden()
    frame.locator("#b").click()
    page.click("#edit-duplicate")
    expect(frame.locator("#row > p")).to_have_count(3)
    frame.locator("h1").click()
    frame.locator("#a").click(modifiers=["Shift"])
    page.click("#edit-wrap-flex")
    expect(page.locator("#status")).to_contain_text("same container")  # h1 and #a aren't siblings
    expect(page.locator("#edit-count")).to_have_text("2 unsaved")  # the delete and the duplicate
    frame.locator("#a").click()
    frame.locator("#b").first.click(modifiers=["Shift"])
    page.click("#edit-wrap-flex")
    expect(page.locator("#edit-count")).to_have_text("3 unsaved")
    page.click("#edit-save")
    expect(page.locator("#chat-input")).to_have_value(re.compile("^Please make these changes"))
    message = page.locator("#chat-input").input_value()
    assert message.startswith("Please make these changes I previewed in Edit mode:")
    assert "Duplicate <p> “Beta” (`#b`), placing the copy right after it." in message
    assert "(“Alpha”)" in message and "in a flex row with a 16px gap" in message
    assert "display: none !important" in (projects.design_dir(slug) / "studio-edits.css").read_text()
    assert projects.get(slug)["pending_deletes"][0]["selector"] == "#note"
    expect(page.locator("#status")).to_contain_text("Duplicating and wrapping need the agent")


def test_exports_follow_the_page_on_the_canvas(live_server, page):
    slug = board_project("Exporting")
    open_studio(page, live_server, slug)
    pdf = page.locator("#export a[data-format='pdf']")
    expect(pdf).to_have_attribute("href", f"/api/projects/{slug}/export/pdf?page=index.html")
    open_page(page, "directions/a.html")
    expect(pdf).to_have_attribute("href", f"/api/projects/{slug}/export/pdf?page=directions%2Fa.html")
    expect(page.locator("#export a[data-format='frames']")).to_have_attribute("href", f"/api/projects/{slug}/export/frames")


def test_model_can_be_switched_in_the_studio(live_server, page):
    slug = design("Switchable")
    open_studio(page, live_server, slug)
    open_settings(page)
    expect(page.locator("#model-select option").first).to_contain_text("default")
    page.select_option("#model-select", "claude-haiku-4-5-20251001")
    expect(page.locator("#status")).to_have_text("Model changed from your next message.")
    assert projects.get(slug)["model"] == "claude-haiku-4-5-20251001"
    page.goto(f"{live_server}/#/")
    expect(page.locator("#project-list li", has_text="Switchable").locator(".meta")).to_have_text("Claude haiku-4-5")


def test_present_steps_through_the_frames(live_server, page):
    slug = board_project("Presented")
    open_studio(page, live_server, slug)
    page.click("#present")
    view = page.locator("#present-view")
    expect(view).to_be_visible()
    expect(page.locator("#present-title")).to_have_text("1 / 4 · Home")
    expect(page.locator("#present-prev")).to_be_disabled()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#present-title")).to_have_text("2 / 4 · Home, phone")
    page.click("#present-next")
    expect(page.locator("#present-title")).to_have_text("3 / 4 · A · Warm")
    # With focus inside the design, the bridge passes the stepping keys on.
    frame = page.frame_locator("#present-frame")
    expect(frame.locator("h1")).to_have_text("Warm")
    frame.locator("h1").click()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#present-title")).to_have_text("4 / 4 · B · Dense")
    expect(page.locator("#present-next")).to_be_disabled()
    page.keyboard.press("Escape")
    expect(view).to_be_hidden()


def test_draw_and_attach_a_sketch(live_server, page):
    slug = design("Sketched")
    open_studio(page, live_server, slug)
    page.click("#draw-mode")
    expect(page.locator("#draw-bar")).to_be_visible()
    expect(page.locator("#draw-attach")).to_be_disabled()
    expect(page.locator("#tweaks-panel")).to_be_hidden()
    box = page.locator("#draw-layer").bounding_box()
    page.mouse.move(box["x"] + 40, box["y"] + 40)
    page.mouse.down()
    page.mouse.move(box["x"] + 160, box["y"] + 90, steps=6)
    page.mouse.up()
    page.click("[aria-label='Blue pen']")
    page.mouse.click(box["x"] + 200, box["y"] + 60)
    page.click("#draw-undo")  # removes the blue dot
    page.click("#draw-attach")
    expect(page.locator("#attachment-list li")).to_have_text("sketch-1.png")
    expect(page.locator("#draw-bar")).to_be_hidden()
    item = projects.data_dir(slug) / "attachments"
    assert any(p.name.endswith(".png") for p in item.iterdir())
    page.click("#draw-mode")
    page.keyboard.press("Escape")
    expect(page.locator("#draw-mode")).to_have_attribute("aria-pressed", "false")


def test_unticked_comments_stay_back(live_server, page, fake_engine):
    from app import comments
    eng = fake_engine([({}, [say(), done()])])
    slug = design("Choosy")
    comments.add(projects.comments_path(slug), "h1", "h1", "Hello 1", "Bigger")
    comments.add(projects.comments_path(slug), "button", "button", "Buy", "Greener")
    open_studio(page, live_server, slug)
    page.get_by_label("Send comment 1 with the next message").uncheck()
    page.fill("#chat-input", "go")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta")).to_have_count(1)
    assert "Greener" in eng.prompts[0]["prompt"] and "Bigger" not in eng.prompts[0]["prompt"]
    expect(page.locator(".msg.user .msg-comments li")).to_have_count(1)
    expect(page.locator("#comment-list li")).to_have_count(2)  # both still open


def test_findings_card_names_rules_and_dismisses_all_but_the_floor(live_server, page, fake_engine, tmp_path):
    import json as _json
    (tmp_path / "fake-gate.json").write_text(_json.dumps({"findings": [
        {"entryId": "control-accessible-name", "title": "Every control needs an accessible name",
         "verdict": "fail", "reason": "button has no name", "locators": ["button"]},
        {"entryId": "no-raw-design-values", "title": "Use the project's tokens", "verdict": "flag",
         "reason": "padding 4px is not a token", "locators": ["h1"]}]}))
    fake_engine([({"index.html": TWEAK_PAGE}, [tool("Write"), tool("mcp__pm__verify", id_="t2"), say("Built."), done()]),
                 ({}, [say("Fixed."), done()])])
    slug = projects.create("Ruled")["slug"]
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a page")
    page.keyboard.press("Enter")
    card = page.locator("#chat-log .msg.findings")
    expect(card.get_by_role("heading")).to_have_text("design-guide's rules: 2 findings")
    floor = card.locator("li", has_text="control-accessible-name")
    expect(floor).to_contain_text("Must fix")
    expect(floor.get_by_role("button")).to_have_count(0)  # the floor cannot be dismissed
    tokens = card.locator("li", has_text="no-raw-design-values")
    tokens.get_by_role("button", name="Dismiss for this project").click()
    expect(tokens).to_contain_text("Dismissed for this project.")
    expect(page.locator(".msg.why-card")).to_be_visible()
    [record] = decisions.read(decisions.path(projects.data_dir(slug)))
    assert (record["rule"], record["dismissed"]) == ("no-raw-design-values", True)


def test_rules_view_shows_proposals_and_confirms_in_rexs_words(live_server, page, tmp_path):
    page.goto(f"{live_server}/#/rules")
    expect(page.locator("#nav-rules")).to_have_attribute("aria-current", "page")
    card = page.locator(".proposal")
    expect(card.get_by_role("heading")).to_have_text("New rule: type · Heading type?")
    expect(card).to_contain_text("Serif, in bakery, florist · 3 decisions")
    expect(card.locator(".proposal-decisions li").first).to_contain_text("Serif over Sans · bakery")
    expect(card.locator(".proposal-decisions li").first).to_contain_text("“serif is warmer”")
    expect(card.locator(".proposal-decisions li").nth(1)).to_contain_text("no reason given")
    expect(card).to_contain_text("Confirming writes: applies when subject has text; alternatives Serif, Sans.")
    card.get_by_text("Confirm or reject…").click()
    # No reason: the server refuses before design-guide is asked, and says why.
    card.get_by_role("button", name="Confirm").click()
    expect(card.locator(".proposal-error")).to_have_text("Confirming a rule needs your reason, in your words")
    card.get_by_label("Your reason, in your words (needed to confirm)").fill("serif headings, every time")
    card.get_by_label("Rule id (kebab-case)").fill("serif-headings")
    card.get_by_label("Title").fill("Headings are serif")
    card.get_by_label("Category").select_option("a11y")
    card.get_by_role("button", name="Confirm").click()
    expect(card).to_contain_text("Confirmed. design-guide wrote the rule.")
    args = (tmp_path / "proposal-answers").read_text().splitlines()
    assert args[1:3] == ["confirm", "p-7a1e21ae7d"] and "serif headings, every time" in args


def test_rules_view_says_when_there_are_no_decision_logs(live_server, page, tmp_path):
    (tmp_path / "fake-proposals.json").write_text(json.dumps({
        "generated": "x", "rulebook": "x", "logs": 0, "problems": [], "proposals": [], "withheld": [],
        "threshold": {"decisions": 3, "projects": 2, "contraryWindowDays": 91},
        "counted": {"decisions": 0, "superseded": 0, "floor": 0, "restores": 0}}))
    page.goto(f"{live_server}/#/rules")
    expect(page.locator("#rules-status")).to_have_text(
        "No decision logs yet. Your picks, rejections and edits are logged as you design. "
        "A rule is proposed when 3 decisions from 2 projects go the same way.")
    expect(page.locator(".proposal")).to_have_count(0)


def test_approve_for_build_marks_the_current_version(live_server, page):
    slug = design("Approvable")
    open_studio(page, live_server, slug)
    button = page.get_by_role("button", name="Approve for build")
    expect(button).to_be_enabled()
    button.click()
    expect(page.get_by_role("button", name="Approved for build")).to_be_disabled()
    assert projects.get(slug)["approved"]["sha"] == projects.latest_version(slug)
    # A new version is not approved: the button comes back for it.
    (projects.design_dir(slug) / "index.html").write_text("<!doctype html><title>x</title><h1>Changed</h1>")
    projects.commit_version(slug, "changed")
    page.reload()
    expect(page.get_by_role("button", name="Approve for build")).to_be_enabled()


def test_findings_card_lists_the_agents_declared_exceptions(live_server, page, fake_engine):
    page_html = ("<!doctype html><title>t</title><style>:root{--ds-override-warning:#b45309}"
                 "h1{color:var(--ds-override-warning)}</style><h1>Hi</h1>")
    fake_engine([({"index.html": page_html}, [tool("Write"), tool("mcp__pm__verify", id_="t2"), say("Built."), done()])])
    slug = projects.create("Excepted")["slug"]
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a page")
    page.keyboard.press("Enter")
    card = page.locator("#chat-log .msg.findings")
    expect(card).to_contain_text("Exceptions the agent declared")
    expect(card.locator(".finding-exceptions li")).to_have_text("--ds-override-warning: #b45309 (index.html)")



def test_search_also_finds_techniques_and_palettes(live_server, page):
    """One search across the studio (redesign gate, section 3)."""
    page.goto(f"{live_server}/#/")
    page.keyboard.press("/")
    expect(page.locator("#project-search")).to_be_focused()
    page.keyboard.type("halftone")
    more = page.locator("#search-more")
    expect(more.locator(".search-group", has_text="Techniques").get_by_role("button", name="Halftone")).to_be_visible()
    page.fill("#project-search", "grenadine")
    expect(more.locator(".search-group", has_text="Wada palettes").locator("li").first).to_contain_text("Grenadine")


def test_canvas_first_studio_panel_outline_and_settings(live_server, page, fake_engine, tmp_path):
    """The studio's structure (docs/gate-studio-redesign.md, sections 5-7)."""
    (tmp_path / "fake-gate.json").write_text(json.dumps({"findings": [
        {"entryId": "no-raw-design-values", "title": "Use the project's tokens", "verdict": "flag",
         "reason": "padding 17px", "locators": ["h1"]}]}))
    fake_engine([({"index.html": TWEAK_PAGE}, [tool("Write"), tool("mcp__pm__verify", id_="t2"), say("Built."), done()])])
    slug = projects.create("Structured")["slug"]
    (projects.design_dir(slug) / "directions").mkdir()
    (projects.design_dir(slug) / "directions" / "a.html").write_text("<!doctype html><title>a</title><h1>A</h1>")
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a page")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta")).to_have_count(1)

    # Left: the pages by folder.
    expect(page.locator("#outline-pages .outline-label")).to_have_text(["Pages", "Directions"])
    expect(page.locator('#outline-pages button[aria-current="page"]')).to_have_text("index.html")

    # Right: one panel with tabs; arrow keys move between them.
    expect(page.locator("#findings-count")).to_have_text("1")
    page.click("#tab-agent-btn")
    page.keyboard.press("ArrowRight")
    expect(page.locator("#tab-inspect-btn")).to_have_attribute("aria-selected", "true")
    expect(page.locator("#tab-inspect")).to_be_visible()
    expect(page.locator("#tab-agent")).to_be_hidden()
    expect(page.locator("#chat-input")).to_be_visible()  # the composer is under every tab
    page.keyboard.press("ArrowRight")
    expect(page.locator("#tab-findings .msg.findings")).to_contain_text("no-raw-design-values")
    page.click("#tab-history-btn")
    expect(page.locator(".history-item img")).to_have_attribute(
        "src", re.compile(rf"^/api/projects/{slug}/versions/[0-9a-f]+/thumbnail$"))

    # Edit mode opens Inspect; leaving it returns to Agent.
    page.click("#edit-mode")
    expect(page.locator("#tab-inspect-btn")).to_have_attribute("aria-selected", "true")
    expect(page.locator("#edit-panel")).to_be_visible()
    page.click("#edit-mode")
    expect(page.locator("#tab-agent-btn")).to_have_attribute("aria-selected", "true")

    # The project's settings are a popover from its name, closed by Escape.
    open_settings(page)
    expect(page.locator("#model-select")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#model-select")).to_be_hidden()


def test_transitions_animate_new_things_but_not_saved_history_or_reduced_motion(live_server, browser, fake_engine):
    """Motion (style.css): a tab's panel and a new chat message ease in; the history replayed when
    a project opens does not; and with prefers-reduced-motion every duration is zero."""
    fake_engine([({"index.html": TWEAK_PAGE}, [say("Built."), done()])])
    slug = design("Moving")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    open_studio(page, live_server, slug)
    page.fill("#chat-input", "a page")
    page.keyboard.press("Enter")
    expect(page.locator(".turn-meta")).to_have_count(1)
    assert page.locator("#chat-log .msg.assistant").last.evaluate("el => el.classList.contains('enter')")
    page.click("#tab-history-btn")
    assert page.eval_on_selector("#tab-history", "el => getComputedStyle(el).animationName") == "pm-enter"
    assert page.eval_on_selector("#tab-history", "el => getComputedStyle(el).animationDuration") == "0.2s"
    page.reload()  # the saved conversation appears at once
    expect(page.locator("#chat-log .msg.assistant")).to_have_count(1)
    assert page.locator("#chat-log .enter").count() == 0
    context.close()

    context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    open_studio(page, live_server, slug)
    page.click("#tab-history-btn")
    assert page.eval_on_selector("#tab-history", "el => getComputedStyle(el).animationDuration") == "0s"
    assert page.eval_on_selector(".side-tabs button", "el => getComputedStyle(el).transitionDuration").startswith("0s")
    context.close()



def test_motion_from_the_inspector_previews_saves_and_reads_back(live_server, page):
    """The inspector's Motion group: the bridge previews the same CSS app/edits.py saves."""
    from app import edits
    slug = design("Animated")
    open_studio(page, live_server, slug)
    expect(page.locator("#tweaks-panel")).to_be_visible()  # bridge ready
    sample = {"h1": {"motion-enter": "scale", "motion-hover": "grow", "motion-speed": "quick"},
              "p": {"motion-hover": "dim"}, ".x": {"motion-enter": "fade"}}
    frame = page.frame_locator("#canvas")
    assert frame.locator("body").evaluate("(b, s) => window.__pmMotionCss(s)", sample) == edits.motion_css(sample)

    page.click("#edit-mode")
    frame.locator("h1").click()
    expect(page.locator("#edit-motion-enter")).to_have_value("none")
    page.select_option("#edit-motion-enter", "rise")
    page.select_option("#edit-motion-speed", "slow")
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).animationName") == "pm-motion-rise"
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).animationDuration") == "0.6s"
    page.click("#edit-motion-play")
    page.click("#edit-save")
    expect(page.locator("#status")).to_have_text("Edits saved as a new version.")
    css = (projects.design_dir(slug) / "studio-edits.css").read_text()
    assert "pm-motion-rise 600ms" in css

    page.reload()
    expect(page.locator("#tweaks-panel")).to_be_visible()
    page.click("#edit-mode")
    frame.locator("h1").click()
    expect(page.locator("#edit-motion-enter")).to_have_value("rise")
    expect(page.locator("#edit-motion-speed")).to_have_value("slow")



def test_plan_first_shows_a_plan_to_edit_and_approve(live_server, page, fake_engine):
    from tests.conftest import plan
    engine = fake_engine([
        ({}, [plan("A pricing page", ["Hero with the offer", "Three plans"]), result("p1"),
              say("Here is the plan."), done()]),
        ({"index.html": TWEAK_PAGE}, [say("Built."), done()]),
    ])
    slug = projects.create("Planned")["slug"]
    open_studio(page, live_server, slug)
    page.click("#plan-first")
    expect(page.locator("#plan-first")).to_have_attribute("aria-pressed", "true")
    page.fill("#chat-input", "a pricing page")
    page.keyboard.press("Enter")
    card = page.locator(".msg.plan")
    expect(card.get_by_role("heading")).to_have_text("Plan")
    expect(card.get_by_role("textbox", name="Step 2")).to_have_value("Three plans")
    card.get_by_role("textbox", name="Step 2").fill("Three plans and an FAQ")
    card.get_by_role("button", name="Remove step 1").click()
    card.get_by_role("button", name="Build this").click()
    expect(page.locator(".turn-meta")).to_have_count(2)
    assert engine.prompts[1]["prompt"].endswith("Build this plan:\n1. Three plans and an FAQ")
    expect(card.get_by_role("button", name="Build this")).to_be_disabled()  # answered

    page.reload()  # the toggle is the project's
    expect(page.locator("#plan-first")).to_have_attribute("aria-pressed", "true")



def test_compare_shows_two_versions_side_by_side_with_changes_outlined(live_server, page):
    slug = design("Compared", versions=3)
    open_studio(page, live_server, slug)
    page.click("#tab-history-btn")
    expect(page.locator("#compare")).to_have_text("What changed last")
    page.click("#compare")
    view = page.locator("#compare-view")
    expect(view).to_be_visible()
    expect(page.locator("#compare-label")).to_have_text("Version 2 → Version 3 · index.html")
    expect(page.locator("#compare-status")).to_have_text("1 changed area")
    expect(page.locator("#compare-files li")).to_have_text(["index.html +1 −1"])
    expect(page.locator("#compare-a-boxes .compare-box")).to_have_count(1)
    expect(page.locator("#compare-b-boxes .compare-box")).to_have_count(1)
    expect(page.locator("#compare-b")).to_have_attribute("alt", "index.html in version 3")
    page.click("#compare-highlight")
    expect(page.locator("#compare-b-boxes")).to_be_hidden()

    show_version(page, 1)  # choosing a version closes Compare; then compare it with the current
    expect(view).to_be_hidden()
    expect(page.locator("#compare")).to_have_text("Compare with current")
    page.click("#compare")
    expect(page.locator("#compare-label")).to_have_text("Version 1 → Version 3 · index.html")
    page.click("#compare-close")
    expect(view).to_be_hidden()



def test_a_page_made_at_one_width_is_shown_at_that_width(live_server, page):
    """A letter sheet (<meta name="viewport" content="width=816">) was drawn in a 1440 frame,
    leaving its background as a wide strip on the right (found 2026-10-08 on a flyer)."""
    slug = design("Flyer")
    sheet = ('<!doctype html><meta name="viewport" content="width=816"><title>sheet</title>'
             '<style>body{margin:0;background:#f5ecc2}.page{width:816px;height:1056px;background:#007190}</style>'
             '<div class="page"></div>')
    (projects.design_dir(slug) / "sheet.html").write_text(sheet)
    projects.commit_version(slug, "a sheet")
    open_studio(page, live_server, slug)
    expect(page.locator("#tweaks-panel")).to_be_visible()  # bridge ready on index.html
    assert page.eval_on_selector("#canvas", "f => f.style.width") == "1440px"
    expect(page.locator('.toolbar .viewport button[data-width="834"]')).to_be_enabled()

    open_page(page, "sheet.html")
    expect(page.locator('.toolbar .viewport button[data-width="834"]')).to_be_disabled()
    assert page.eval_on_selector("#canvas", "f => f.style.width") == "816px"
    gap = page.frame_locator("#canvas").locator(".page").evaluate(
        "p => document.documentElement.clientWidth - p.getBoundingClientRect().right")
    assert gap == 0  # no strip of background beside the sheet

    open_page(page, "index.html")
    expect(page.locator('.toolbar .viewport button[data-width="834"]')).to_be_enabled()
    page.wait_for_function("document.querySelector('#canvas').style.width === '1440px'")



OUTSIDE_TOP_BAR = """() => {
  const vw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('.studio-top button, .studio-top a, .studio-top summary, .studio-top select')]
    .filter(e => e.offsetParent && !(e.closest('details:not([open])') && !e.closest('summary')))
    .filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 0.5 || r.left < -0.5; })
    .map(e => e.id || e.textContent.trim());
}"""


@pytest.mark.parametrize("width", [1440, 1280, 1024])
def test_the_top_bar_keeps_every_control_in_the_window(live_server, browser, width):
    """With a long name and Priority marks shown, Approve for build was pushed past the right
    edge at 1440, and more controls at 1280 and 1024 (found 2026-10-08). The toolbar wraps."""
    marked = TWEAK_PAGE.replace("<h1", '<h1 data-priority="1"')
    slug = design("Retirement Residence Marketing Flyer", marked)
    context = browser.new_context(viewport={"width": width, "height": 900})
    page = context.new_page()
    open_studio(page, live_server, slug)
    expect(page.locator("#priority-mode")).to_be_visible()
    expect(page.locator("#approve")).to_be_visible()
    assert page.evaluate(OUTSIDE_TOP_BAR) == []
    right = page.evaluate("document.querySelector('#approve').getBoundingClientRect().right")
    assert width - 40 < right <= width  # at the right end, not wrapped to the left of a row
    context.close()
