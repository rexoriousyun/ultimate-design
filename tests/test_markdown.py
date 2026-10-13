"""static/markdown.js in real Chromium."""

from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

SCRIPT = (Path(__file__).resolve().parent.parent / "static" / "markdown.js").read_text()


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(f"<!doctype html><body><div id=out></div><script>{SCRIPT}</script>")
        yield page
        browser.close()


def render(page, text):
    return page.evaluate("t => { const d = document.getElementById('out'); d.replaceChildren(renderMarkdown(t)); return d.innerHTML; }", text)


def test_inline_formatting(page):
    assert render(page, "Now **bold**, *italic*, _also_ and `a.css`.") == \
        "<p>Now <strong>bold</strong>, <em>italic</em>, <em>also</em> and <code>a.css</code>.</p>"


def test_paragraphs_line_breaks_and_lists(page):
    html = render(page, "First line\nsecond line\n\n- one\n- **two**\n\n1. a\n2. b\nAfter")
    assert html == ("<p>First line<br>second line</p><ul><li>one</li><li><strong>two</strong></li></ul>"
                    "<ol><li>a</li><li>b</li></ol><p>After</p>")


def test_headings_become_bold_paragraphs(page):
    assert render(page, "## Things to know") == "<p><strong>Things to know</strong></p>"


def test_html_in_model_text_stays_text(page):
    html = render(page, "<img src=x onerror=alert(1)> **<b>x</b>**")
    assert "<img" not in html and "&lt;img" in html
    assert html.count("<b>") == 0


def test_lone_asterisks_are_left_alone(page):
    assert render(page, "3 * 4 = 12 and a * b") == "<p>3 * 4 = 12 and a * b</p>"
