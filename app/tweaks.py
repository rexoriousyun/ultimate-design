"""The tweaks block: tweakable values a design declares for the studio's Tweaks panel.

    <script type="application/json" id="tweaks">
    [{"name": "--accent", "label": "Accent", "type": "color", "value": "#c2410c"}, ...]
    </script>

static/canvas-bridge.js applies values live in the canvas. This module rewrites the
block's default values when the user keeps them. Convention: docs/agent.md.
"""

import json
import re

BLOCK = re.compile(
    r'(<script\b[^>]*\bid=["\']tweaks["\'][^>]*>)(.*?)(</script>)', re.S | re.I)


def read(html: str) -> list[dict] | None:
    match = BLOCK.search(html)
    if not match:
        return None
    return json.loads(match.group(2))


def set_defaults(html: str, values: dict) -> str:
    """Return html with each named tweak's "value" replaced. Unknown names are ignored."""
    match = BLOCK.search(html)
    if not match:
        raise ValueError("no tweaks block")
    tweaks = json.loads(match.group(2))
    for tweak in tweaks:
        if tweak.get("name") in values:
            tweak["value"] = values[tweak["name"]]
    body = "\n" + json.dumps(tweaks, indent=2) + "\n"
    return html[:match.start(2)] + body + html[match.end(2):]
