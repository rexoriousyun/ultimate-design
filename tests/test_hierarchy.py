"""The hierarchy check (app/hierarchy.js via app/preview.py) in real Chromium: a page
declares its order of importance with data-priority, and verify fails where the rendered
prominence disagrees."""

import asyncio

from app.preview import DESKTOP, Previewer, hierarchy_problems

STYLE = """<style>
  body { margin: 0; padding: 32px; font: 16px/1.5 system-ui; color: #1c1b19; background: #fff; }
  h1 { font-size: 40px; font-weight: 700; margin: 0 0 16px; }
  .cta { display: inline-block; padding: 12px 20px; background: #1d4ed8; color: #fff; font-weight: 600;
         border-radius: 8px; text-decoration: none; }
  .quiet { font-size: 14px; color: #5f5b53; }
</style>"""


def check(tmp_path, body, hierarchy=True, height=DESKTOP[1]):
    (tmp_path / "index.html").write_text(f"<!doctype html><html lang=en><title>t</title>{STYLE}<body>{body}</body></html>")

    async def scenario():
        previewer = Previewer(tmp_path, hierarchy=hierarchy)
        try:
            return (await previewer.screenshot("index.html", (DESKTOP[0], height)))[1]
        finally:
            await previewer.close()
    return asyncio.run(scenario())


GOOD = ('<h1 data-priority="1">Plans for every team</h1>'
        '<p>Pick a plan, change it any time.</p>'
        '<a class="cta" href="#" data-priority="2">Start free trial</a> '
        '<a class="quiet" href="#" data-priority="3">Compare plans</a>')


def test_a_page_that_matches_its_declared_order_is_clean(tmp_path):
    problems = check(tmp_path, GOOD)
    assert problems.hierarchy == [] and problems.empty(), problems.report()


def test_missing_marks_fail(tmp_path):
    problems = check(tmp_path, "<h1>Plans</h1><a class=cta href=#>Start</a>")
    assert len(problems.hierarchy) == 1 and "No data-priority marks" in problems.hierarchy[0]
    assert not problems.empty()


def test_a_lower_priority_that_outshines_a_higher_one_fails_with_the_measurements(tmp_path):
    # The secondary link is set bigger and bolder than the main action.
    problems = check(tmp_path, '<h1 data-priority="1">Plans</h1>'
                               '<a class="quiet" href="#" data-priority="2">Start free trial</a> '
                               '<a href="#" data-priority="3" style="font-size:28px;font-weight:700">Compare plans</a>')
    assert len(problems.hierarchy) == 1, problems.hierarchy
    finding = problems.hierarchy[0]
    assert finding.startswith('priority 3 "Compare plans" (28px/700, contrast')
    assert 'stands out as much as priority 2 "Start free trial" (14px/400' in finding
    assert "Hierarchy (data-priority 1 is the most important" in problems.report()


def test_fill_counts_toward_prominence(tmp_path):
    # Same text size: the filled button outranks the plain link, so this order is right...
    ok = check(tmp_path, '<h1 data-priority="1">Plans</h1><a class="cta" href="#" data-priority="2">Start</a> '
                         '<a href="#" data-priority="3" style="font-weight:600">More</a>')
    assert ok.hierarchy == [], ok.hierarchy
    # ...and the reverse is not.
    bad = check(tmp_path, '<h1 data-priority="1">Plans</h1><a class="cta" href="#" data-priority="3">Start</a> '
                          '<a href="#" data-priority="2" style="font-weight:600">More</a>')
    assert len(bad.hierarchy) == 1 and "filled" in bad.hierarchy[0]


def test_unmarked_text_that_rivals_priority_one_fails(tmp_path):
    problems = check(tmp_path, '<p style="font-size:64px;font-weight:800">98%</p>' + GOOD)
    assert len(problems.hierarchy) == 1
    assert problems.hierarchy[0].startswith('unmarked "98%" (64px/800')


def test_position_below_the_fold_lowers_prominence(tmp_path):
    # Priority 1 is clearly stronger than priority 2 on the first screen...
    first = '<a class="cta" href="#" data-priority="1" style="font-size:20px">Buy now</a> '
    second = '<a class="cta" href="#" data-priority="2">Start</a>'
    assert check(tmp_path, first + second).hierarchy == []
    # ...but far down the page it no longer leads.
    problems = check(tmp_path, second + '<div style="height:2400px"></div>' + first)
    assert len(problems.hierarchy) == 1 and "below the fold" in problems.hierarchy[0]


def test_options_are_compared_only_within_themselves(tmp_path):
    # Option 1a's priority 2 would outrank option 1b's small priority 1 if they were compared.
    body = ('<section data-option="1a"><h1 data-priority="1">A</h1><a href=# data-priority="2">x</a></section>'
            '<section data-option="1b"><p data-priority="1" style="font-size:12px">B</p>'
            '<a class="quiet" href=# data-priority="2">y</a></section>')
    problems = check(tmp_path, body, height=3000)  # both options above the fold
    assert problems.hierarchy == [], problems.hierarchy


def test_nested_marks_are_measured_separately(tmp_path):
    # A card (priority 2) holding the page's headline (priority 1) is scored by its own text.
    body = ('<div data-priority="2" style="padding:24px;border:1px solid #ddd">'
            '<h1 data-priority="1">Plans</h1><p>Short intro text.</p></div>')
    problems = check(tmp_path, body)
    assert problems.hierarchy == [], problems.hierarchy


def test_invalid_values_and_hidden_elements(tmp_path):
    problems = check(tmp_path, GOOD + '<p data-priority="first">x</p>'
                                      '<p data-priority="1" hidden style="font-size:90px">Hidden</p>')
    assert problems.hierarchy == ['Not a priority: data-priority="first" on <p> (use a whole number from 1)']


def test_off_unless_asked(tmp_path):
    assert check(tmp_path, "<h1>No marks</h1>", hierarchy=False).hierarchy == []


def test_report_is_capped():
    result = {"missing": False, "invalid": [f"data-priority=\"x{i}\" on <p>" for i in range(12)],
              "violations": [], "unmarked": []}
    items = hierarchy_problems(result)
    assert len(items) == 9 and items[-1] == "... and 4 more"
