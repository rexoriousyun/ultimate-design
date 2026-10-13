"""Direct canvas edits: text changed in place and style changes (size, spacing, type,
radius, alignment, colour, position, order) made in the studio's Edit mode, saved without
a model turn.

- Text: the old text is replaced in the project's .html/.js files only when it occurs
  exactly once (as written, or HTML-escaped). Anything else is returned as unplaced, and
  the studio offers to hand it to the agent.
- Styles: kept per page in data/<slug>/style-edits.json and written to one stylesheet per
  page (studio-edits.css for the entry page, studio-edits-<page>.css for others) as one
  rule per selector with !important, so they win over the design's own CSS. Each page
  links its own file last in <head>. Moves are CSS only: `order` inside a flex or grid
  parent, otherwise `translate`.
- Motion: `motion-enter`, `motion-hover` and `motion-speed` are stored like styles and
  written as an entrance animation, a hover state and its transition (`motion_css`), only
  under prefers-reduced-motion: no-preference. The canvas bridge previews the same CSS
  (`motionCss` in static/canvas-bridge.js); a test holds the two to one output.
"""

import html
import json
import os
import re
from pathlib import Path

CSS_FILE = "studio-edits.css"
TEXT_FILES = {".html", ".htm", ".js"}

PROPS = {"width", "height", "padding-top", "padding-right", "padding-bottom", "padding-left",
         "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "font-size",
         "border-radius", "text-align", "color", "background-color", "translate", "order",
         "font-family", "font-weight", "letter-spacing", "line-height", "font-size", "display"}
# Motion presets from the inspector's Motion group, and what each one writes.
MOTION = {"motion-enter": {"none", "fade", "rise", "scale"},
          "motion-hover": {"none", "lift", "grow", "dim"},
          "motion-speed": {"quick", "normal", "slow"}}
SPEED_MS = {"quick": 150, "normal": 300, "slow": 600}
MOTION_EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)"
ENTER_FROM = {"fade": "opacity: 0;", "rise": "opacity: 0; transform: translateY(16px);",
              "scale": "opacity: 0; transform: scale(0.96);"}
HOVER_TO = {"lift": "transform: translateY(-4px)", "grow": "transform: scale(1.03)", "dim": "opacity: 0.8"}
LENGTH = re.compile(r"^(auto|-?\d+(\.\d+)?px)$")
ALIGN = {"left", "center", "right", "justify"}
# A hex colour, or a design-system token picked from the panel.
COLOR = re.compile(r"^(#[0-9a-fA-F]{3,8}|var\(--[A-Za-z0-9_-]+\))$")
TRANSLATE = re.compile(r"^-?\d+(\.\d+)?px -?\d+(\.\d+)?px$")
ORDER = re.compile(r"^-?\d{1,4}$")
# A font stack ("Work Sans", system-ui, sans-serif) or a design-system token.
FONT_FAMILY = re.compile(r"""^([A-Za-z0-9 ,"'_-]{1,160}|var\(--[A-Za-z0-9_-]+\))$""")
TRACKING = re.compile(r"^(normal|-?\d+(\.\d+)?(px|em))$")
LEADING = re.compile(r"^(normal|\d+(\.\d+)?(px)?)$")
TOKEN = re.compile(r"^var\(--[A-Za-z0-9_-]+\)$")
# Anything that could end the rule and start another. ">" is fine: it is the child combinator.
BAD_SELECTOR = re.compile(r"[{};]|/\*|\n")


class EditError(Exception):
    """Shown to the user."""


def valid_value(prop: str, value: str) -> bool:
    match prop:
        case "text-align":
            return value in ALIGN
        case "color" | "background-color":
            return bool(COLOR.match(value))
        case "translate":
            return bool(TRANSLATE.match(value))
        case "order":
            return bool(ORDER.match(value))
        case "font-family":
            return bool(FONT_FAMILY.match(value))
        case "font-weight":
            return value in {str(w) for w in range(100, 1000, 100)}
        case "letter-spacing":
            return bool(TRACKING.match(value))
        case "line-height":
            return bool(LEADING.match(value))
        case "font-size":  # a length, or a design-system type token
            return bool(LENGTH.match(value) or TOKEN.match(value))
        case "display":  # only to delete: the element is hidden until the agent removes it
            return value == "none"
        case "motion-enter" | "motion-hover" | "motion-speed":
            return value in MOTION[prop]
    return prop in PROPS and bool(LENGTH.match(value))


def validate_styles(styles: dict) -> dict:
    clean = {}
    for selector, props in styles.items():
        if not selector.strip() or BAD_SELECTOR.search(selector) or len(selector) > 500:
            raise EditError(f"Unusable selector: {selector[:60]}")
        for prop, value in props.items():
            if not valid_value(prop, value):
                raise EditError(f"Unsupported style {prop}: {value}")
        clean[selector.strip()] = dict(props)
    return clean


def css_name(page: str, entry: str) -> str:
    """The stylesheet holding one page's edits, at the top of the design folder."""
    if page == entry:
        return CSS_FILE
    stem = re.sub(r"[^A-Za-z0-9]+", "-", page.removesuffix(".html").removesuffix(".htm")).strip("-")
    return f"studio-edits-{stem}.css"


def _load(store: Path, entry: str) -> dict:
    """{page: {selector: {prop: value}}}. Files from before multi-page support were one
    flat {selector: props} map for the entry page."""
    data = json.loads(store.read_text()) if store.exists() else {}
    if any(isinstance(v, str) for props in data.values() for v in props.values()):
        return {entry: data}
    return data


def apply_text(folder: Path, before: str, after: str) -> str | None:
    """Replace `before` with `after` where it occurs exactly once across the design's
    .html/.js files. Returns the file's relative path, or None if not found or ambiguous."""
    if not before.strip() or before == after:
        return None
    forms = [(before, after), (html.escape(before, quote=False), html.escape(after, quote=False))]
    hits = []
    for path in sorted(folder.rglob("*")):
        if path.suffix.lower() not in TEXT_FILES or not path.is_file() or "design-system" in path.parts:
            continue
        content = path.read_text()
        for old, new in dict(forms).items():
            count = content.count(old)
            if count:
                hits.append((path, old, new, count))
    if len(hits) != 1 or hits[0][3] != 1:
        return None
    path, old, new, _ = hits[0]
    path.write_text(path.read_text().replace(old, new))
    return str(path.relative_to(folder))


def motion_css(styles: dict) -> str:
    """The motion edits of one page as CSS: the presets as custom properties (so the inspector
    can read them back), then the animations and hover states for people who have not asked
    for reduced motion. Must match `motionCss` in static/canvas-bridge.js."""
    moving = {sel: props for sel, props in styles.items() if any(p in MOTION for p in props)}
    if not moving:
        return ""
    marks, rules, used = [], [], []
    for selector, props in moving.items():
        enter = props.get("motion-enter", "none")
        hover = props.get("motion-hover", "none")
        speed = props.get("motion-speed", "normal")
        ms = SPEED_MS[speed]
        marks.append(f"{selector} {{ --pm-motion-enter: {enter}; --pm-motion-hover: {hover}; "
                     f"--pm-motion-speed: {speed}; }}")
        if enter != "none":
            rules.append(f"  {selector} {{ animation: pm-motion-{enter} {ms}ms {MOTION_EASE} backwards !important; }}")
            if enter not in used:
                used.append(enter)
        if hover != "none":
            rules.append(f"  {selector} {{ transition: transform {ms}ms {MOTION_EASE}, "
                         f"opacity {ms}ms {MOTION_EASE} !important; }}")
            rules.append(f"  {selector}:hover {{ {HOVER_TO[hover]} !important; }}")
    frames = [f"  @keyframes pm-motion-{kind} {{ from {{ {ENTER_FROM[kind]} }} }}" for kind in used]
    return "\n".join([*marks, "@media (prefers-reduced-motion: no-preference) {", *frames, *rules, "}"]) + "\n"


def render_css(styles: dict) -> str:
    lines = ["/* Direct edits made in the studio (Edit mode). Written by the app from",
             "   data/<project>/style-edits.json; do not edit by hand. */", ""]
    for selector, props in styles.items():
        plain = {p: v for p, v in props.items() if p not in MOTION}
        if not plain:
            continue
        lines.append(f"{selector} {{")
        lines.extend(f"  {prop}: {value} !important;" for prop, value in plain.items())
        lines.append("}")
    return "\n".join(lines) + "\n" + motion_css(styles)


def link_stylesheet(page: Path, css: Path) -> None:
    """Make sure the page loads its edits stylesheet, after its own styles."""
    content = page.read_text()
    if "data-studio-edits" in content:
        return
    href = Path(os.path.relpath(css, page.parent)).as_posix()
    tag = f'<link rel="stylesheet" href="{href}" data-studio-edits>'
    i = content.lower().find("</head>")
    content = content[:i] + tag + "\n" + content[i:] if i >= 0 else tag + "\n" + content
    page.write_text(content)


def page_file(folder: Path, page: str) -> Path:
    """The design's HTML page `page`, which must exist inside the folder."""
    root = folder.resolve()
    path = (root / page).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() not in {".html", ".htm"} or not path.is_file():
        raise EditError(f"No such page: {page[:60]}")
    return path


def save(folder: Path, entry: str, data_dir: Path, styles: dict, texts: list[dict]) -> dict:
    """Apply one batch of edits. `styles` is {page: {selector: {prop: value}}}.
    Returns {"placed": [...], "unplaced": [...], "styles": n, "files": [css files]}."""
    styles = {page: validate_styles(by_selector) for page, by_selector in styles.items() if by_selector}
    pages = {page: page_file(folder, page) for page in styles}
    placed, unplaced = [], []
    for t in texts:
        where = apply_text(folder, t["before"], t["after"])
        (placed if where else unplaced).append({**t, "file": where})
    files = []
    if styles:
        store = data_dir / "style-edits.json"
        merged = _load(store, entry)
        for page, by_selector in styles.items():
            for selector, props in by_selector.items():
                merged.setdefault(page, {}).setdefault(selector, {}).update(props)
            css = folder / css_name(page, entry)
            css.write_text(render_css(merged[page]))
            link_stylesheet(pages[page], css)
            files.append(css.name)
        store.write_text(json.dumps(merged, indent=2))
    count = sum(len(p) for by_selector in styles.values() for p in by_selector.values())
    deleted = [{"page": page, "selector": sel} for page, by_selector in styles.items()
               for sel, props in by_selector.items() if props.get("display") == "none"]
    return {"placed": placed, "unplaced": unplaced, "styles": count, "files": files, "deleted": deleted}


def drop_deletes(folder: Path, entry: str, data_dir: Path, deletes: list[dict]) -> None:
    """After the agent's turn that removed deleted elements from the source: drop their
    display: none rules. Left in place, a rule keyed by nth-of-type would hide the next
    sibling once the element is gone."""
    store = data_dir / "style-edits.json"
    if not deletes or not store.exists():
        return
    merged = _load(store, entry)
    touched = set()
    for d in deletes:
        props = merged.get(d["page"], {}).get(d["selector"])
        if props and props.pop("display", None) is not None:
            touched.add(d["page"])
            if not props:
                del merged[d["page"]][d["selector"]]
    store.write_text(json.dumps(merged, indent=2))
    for page in touched:
        (folder / css_name(page, entry)).write_text(render_css(merged[page]))
