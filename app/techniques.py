"""The technique library's web recipes for the studio: a catalogue to browse and a live demo
page per recipe. The design agent reads the same files (see docs/agent.md); the studio only
shows them and drafts requests.

Read from `creative-library/recipes/web/manifest.json`, which the library's `npm run sync`
writes by running every recipe, so nothing here parses recipe code beyond its header comment.
"""

import functools
import html
import json
import re
from pathlib import Path

LIBRARY_DIR = Path(__file__).resolve().parent.parent / "creative-library"
WEB_DIR = LIBRARY_DIR / "recipes" / "web"
THREE_BUILD = "node_modules/three/build/three.min.js"
HEADER = re.compile(r"\A\s*/\*\*(.*?)\*/", re.S)


def _notes(source: Path) -> str:
    """The recipe's header comment, which says what carries the effect, as plain text."""
    match = HEADER.match(source.read_text())
    if not match:
        return ""
    lines = [re.sub(r"^\s*\* ?", "", line) for line in match.group(1).splitlines()]
    return "\n".join(lines).strip()


@functools.cache
def _manifest() -> dict[str, dict]:
    components = json.loads((WEB_DIR / "manifest.json").read_text())["components"]
    return {c["id"]: c for c in components}


@functools.cache
def _intents() -> dict[str, list[str]]:
    """The library's intent index: what each recipe is for (recipes/web/intents.json)."""
    return json.loads((WEB_DIR / "intents.json").read_text())["intents"]


def _evidence(technique_id: str) -> dict[str, dict]:
    """Per prop, what the library's sweep measured (recipes/web/sweeps/<id>.json): the
    verdict, the strip of frames as a URL, and the reason or flat segments when there are some."""
    file = WEB_DIR / "sweeps" / f"{technique_id}.json"
    if not file.is_file():
        return {}
    out = {}
    for name, p in json.loads(file.read_text())["params"].items():
        entry = {k: p[k] for k in ("verdict", "reason", "flatSegments") if k in p}
        if "strip" in p:
            entry["strip"] = f"/creative-library/recipes/web/{p['strip']}"
        out[name] = entry
    return out


def all_techniques() -> list[dict]:
    """Every web recipe: id, label, primitive, description, intents, props (with their
    parameter maps), evidence (per prop, from the sweep), screenshot (a URL under the app's
    /creative-library/ mount, or null) and notes (its header comment)."""
    result = []
    for c in sorted(_manifest().values(), key=lambda c: c["label"].lower()):
        shot = WEB_DIR / "screenshots" / f"{c['id']}.png"
        result.append({"id": c["id"], "label": c["label"], "primitive": c["primitive"],
                       "description": c.get("description", ""), "intents": _intents().get(c["id"], []),
                       "props": c.get("props", {}), "evidence": _evidence(c["id"]),
                       "source": f"creative-library/{c['source']}",
                       "screenshot": f"/creative-library/recipes/web/screenshots/{c['id']}.png" if shot.is_file() else None,
                       "notes": _notes(LIBRARY_DIR / c["source"])})
    return result


def demo_html(technique_id: str) -> str | None:
    """A page that mounts one recipe's own demo the way the library's render gate does:
    three.js when the recipe needs it, the registry, its dependencies, then the recipe."""
    recipe = _manifest().get(technique_id)
    if recipe is None:
        return None
    scripts = []
    if recipe.get("requires"):
        scripts.append(THREE_BUILD)
    scripts.append("recipes/web/registry.js")
    scripts += [_manifest()[dep]["source"] for dep in recipe.get("dependsOn", []) if dep in _manifest()]
    scripts.append(recipe["source"])
    tags = "".join(f'<script src="/creative-library/{html.escape(s)}"></script>' for s in scripts)
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<title>{html.escape(recipe['label'])}</title>"
            "<style>html,body{margin:0;background:#fff;color:#1a1a1a;font-family:system-ui,sans-serif}"
            "#stage{padding:16px}</style></head><body><div id=\"stage\"></div>" + tags
            + f"<script>window.UI.get({json.dumps(technique_id)}).demo(document.getElementById('stage'));</script>"
            "</body></html>")
