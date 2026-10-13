import pytest

from app import tweaks

PAGE = """<!doctype html><html><head>
<script type="application/json" id="tweaks">
[{"name": "--accent", "type": "color", "value": "#111111"},
 {"name": "layout", "type": "enum", "options": ["a", "b"], "value": "a"}]
</script>
<style>body { color: var(--accent); }</style>
</head><body><script>console.log("other script")</script></body></html>"""


def test_read():
    assert [t["name"] for t in tweaks.read(PAGE)] == ["--accent", "layout"]
    assert tweaks.read("<html></html>") is None


def test_set_defaults_changes_only_values_in_the_block():
    html = tweaks.set_defaults(PAGE, {"layout": "b", "unknown": 1})
    assert {t["name"]: t["value"] for t in tweaks.read(html)} == {"--accent": "#111111", "layout": "b"}
    assert html.startswith("<!doctype html><html><head>\n<script type=\"application/json\" id=\"tweaks\">")
    assert html.endswith('<script>console.log("other script")</script></body></html>')


def test_set_defaults_accepts_single_quoted_id_and_extra_attributes():
    page = "<script id='tweaks' type=\"application/json\">[{\"name\": \"x\", \"value\": 1}]</script>"
    assert tweaks.read(tweaks.set_defaults(page, {"x": 2}))[0]["value"] == 2


def test_set_defaults_without_block_raises():
    with pytest.raises(ValueError):
        tweaks.set_defaults("<html></html>", {"x": 1})
