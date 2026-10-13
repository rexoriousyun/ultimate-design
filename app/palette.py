"""Wada palettes: a page names one of Sanzo Wada's 348 colour combinations with
`<meta name="palette" content="wada:006">`, and `verify` holds its colours to it.

The data is the technique library's `palettes/wada/colors.json` (159 colours, each listing
the combinations it is in; see `creative-library/palettes/wada/README.md`).
"""

import functools
import json
import re
from pathlib import Path

WADA_FILE = Path(__file__).resolve().parent.parent / "creative-library" / "palettes" / "wada" / "colors.json"
META = re.compile(r"\s*wada\s*:\s*0*(\d{1,3})\s*", re.I)


@functools.cache
def _combinations() -> dict[int, list[dict]]:
    by_id: dict[int, list[dict]] = {}
    for color in json.loads(WADA_FILE.read_text()):
        for n in color["combinations"]:
            by_id.setdefault(n, []).append({"name": color["name"], "hex": color["hex"]})
    return by_id


def combination(n: int) -> list[dict] | None:
    """The colours of combination n ({name, hex}), or None if there is no such number."""
    return _combinations().get(n)


INDEX_LINE = re.compile(r"- (\d{3}) \(\d\) .+ · ([a-z-]+), ([a-z-]+), ([a-z]+) · text: .+ ([\d.]+):1")


@functools.cache
def _tags() -> dict[int, dict]:
    """The computed tags per combination, read from combinations.md, which the library's
    `npm run sync` writes (engine/palettes/wada.js), so the tags have one source."""
    tags = {}
    for line in (WADA_FILE.parent / "combinations.md").read_text().splitlines():
        if match := INDEX_LINE.fullmatch(line):
            n, harmony, value, strength, ratio = match.groups()
            tags[int(n)] = {"harmony": harmony, "value": value, "strength": strength, "text_contrast": float(ratio)}
    return tags


def all_combinations() -> dict[str, dict]:
    """Every combination, keyed by its number as a string (for JSON): its colours and the
    computed tags (harmony, value, strength, text_contrast = its best pair's ratio)."""
    return {str(n): {"colors": colours, **_tags().get(n, {})} for n, colours in sorted(_combinations().items())}


def parse(content: str) -> int | None:
    """The combination number in a palette meta's content ("wada:006"), or None."""
    match = META.fullmatch(content or "")
    return int(match.group(1)) if match else None


_META_TAG = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""\b(name|content)\s*=\s*["']([^"']*)["']""", re.I)


def meta_content(html: str) -> str | None:
    """The content of a page's <meta name="palette"> as written ("wada:006"), or None."""
    for tag in _META_TAG.findall(html):
        attrs = {k.lower(): v for k, v in _ATTR.findall(tag)}
        if attrs.get("name", "").lower() == "palette":
            return attrs.get("content")
    return None


def label(n: int) -> str:
    return f"Wada {n:03d} (" + ", ".join(f"{c['name']} {c['hex']}" for c in combination(n)) + ")"
