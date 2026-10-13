"""Wada palettes (app/palette.py): a page names a combination with <meta name="palette">,
and verify holds its colours to it. The Chromium tests run real headless Chromium."""

from app import palette
from app.preview import DESKTOP
from tests.test_preview import run

# Combination 006: Grenadine Pink #f48067 and Deep Indigo #051230 (7.2:1).
PAGE = ("<!doctype html><title>t</title><meta name=palette content='{meta}'>"
        "<style>{css}</style><body><h1>Groove</h1><p class=note>Open late</p></body>")
ON_PALETTE = "body { background: #f48067; color: #051230; }"


def page(tmp_path, css=ON_PALETTE, meta="wada:006"):
    (tmp_path / "index.html").write_text(PAGE.format(meta=meta, css=css))
    return run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)[1]


def test_combinations_come_from_the_library_data():
    assert palette.combination(1) == [{"name": "English Red", "hex": "#d96629"},
                                      {"name": "Cerulian Blue", "hex": "#0093a5"}]
    assert {c["name"] for c in palette.combination(6)} == {"Grenadine Pink", "Deep Indigo"}
    assert len(palette.combination(348)) == 4
    assert palette.combination(0) is None and palette.combination(349) is None
    assert "Wada 006 (" in palette.label(6) and "#051230" in palette.label(6)


def test_meta_content_is_parsed_leniently():
    assert palette.parse("wada:006") == 6
    assert palette.parse(" WADA : 6 ") == 6
    assert palette.parse("wada:348") == 348
    assert palette.parse("006") is None and palette.parse("sanzo:6") is None and palette.parse("") is None


def test_page_in_its_palette_is_clean(tmp_path):
    problems = page(tmp_path)
    assert problems.empty(), problems.report()


def test_colours_outside_the_palette_fail_verify(tmp_path):
    problems = page(tmp_path, ON_PALETTE + ".note { color: #3366ff; }")
    assert problems.off_palette and not problems.empty()
    assert 'colour #3366ff: 1 element(s), e.g. "Open late"' in problems.off_palette[0]
    assert "Wada 006" in problems.off_palette[0]
    report = problems.report()
    assert "Not from the page's Wada palette" in report and "--palette-override-" in report


def test_declared_overrides_and_studio_edits_are_allowed(tmp_path):
    css = (":root { --palette-override-paper: #fff8f0; }"
           "body { background: var(--palette-override-paper); color: #051230; }")
    (tmp_path / "studio-edits.css").write_text(".note { color: #f48067 !important; background: #222222; }")
    (tmp_path / "index.html").write_text(
        PAGE.format(meta="wada:006", css=css).replace("</style>", "</style><link rel=stylesheet href=studio-edits.css>"))
    problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)[1]
    assert problems.off_palette == [], problems.report()


def test_unknown_combination_is_reported(tmp_path):
    problems = page(tmp_path, meta="wada:400")
    assert problems.off_palette == ['<meta name="palette" content="wada:400"> names no Wada combination; '
                                    "use wada:001 to wada:348 (palettes/wada/combinations.md)"]


def test_no_meta_no_palette_check(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title><p style='color:#3366ff'>x</p>")
    problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)[1]
    assert problems.off_palette == []


def test_a_design_system_takes_precedence_over_a_palette(tmp_path):
    (tmp_path / "design-system").mkdir()
    (tmp_path / "design-system" / "tokens.css").write_text(":root { --ink: #1c1b19; --paper: #f7f6f3; }")
    css = "body { background: var(--paper); color: var(--ink); }"
    (tmp_path / "index.html").write_text(
        PAGE.format(meta="wada:006", css=css).replace("<style>", "<link rel=stylesheet href=design-system/tokens.css><style>"))
    problems = run(lambda p: p.screenshot("index.html", DESKTOP), tmp_path)[1]
    assert problems.off_palette == [] and problems.off_system == [], problems.report()
