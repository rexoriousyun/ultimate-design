"""Render a project folder in headless Chromium: screenshots, console problems, JS eval.

The folder is served over a local HTTP server (not file://) so fetch() and relative
URLs behave the same as in the studio canvas.
"""

import functools
import json
import re
import threading
import urllib.parse
from dataclasses import dataclass, field
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import Browser, Page, async_playwright

from app import board, palette, rulebook

CONTRAST_JS = (Path(__file__).parent / "contrast.js").read_text()
CONFORMANCE_JS = (Path(__file__).parent / "conformance.js").read_text()
HIERARCHY_JS = (Path(__file__).parent / "hierarchy.js").read_text()
TARGET_SIZE_JS = (Path(__file__).parent / "target_size.js").read_text()
MAX_CONFORMANCE_ITEMS = 8
MAX_HIERARCHY_ITEMS = 8
CHECKED_ASSETS = (".css", ".js")
MAX_CONTRAST_GROUPS = 10
DESKTOP = (1440, 900)
MOBILE = (390, 844)
SETTLE_MS = 400


def css_hex(rgb: str) -> str:
    """rgb(1, 2, 3) -> #010203; rgba(..., a) keeps its alpha as a percentage."""
    nums = [float(n) for n in re.findall(r"[\d.]+", rgb)]
    if len(nums) < 3:
        return rgb
    out = "#" + "".join(f"{round(n):02x}" for n in nums[:3])
    return f"{out} at {round(nums[3] * 100)}%" if len(nums) > 3 and nums[3] < 1 else out


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # stdout/stderr must stay clean for the MCP stdio transport
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve_folder(folder: Path) -> ThreadingHTTPServer:
    handler = functools.partial(_QuietHandler, directory=str(folder))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@dataclass
class Problems:
    console_errors: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)
    low_contrast: list[str] = field(default_factory=list)
    unloaded_files: list[str] = field(default_factory=list)
    # board.json problems (app/board.py): the board view would be wrong or incomplete.
    board: list[str] = field(default_factory=list)
    # Colours and fonts not from the attached design system. A failure: a deliberate one
    # (a contrast fix, a token the system lacks) is declared as a --ds-override-* property.
    off_system: list[str] = field(default_factory=list)
    # Colours not from the page's Wada palette (<meta name="palette">), or a palette meta
    # that names no combination. Exceptions are declared as --palette-override-*.
    off_palette: list[str] = field(default_factory=list)
    # Where the rendered page disagrees with its declared order of importance (hierarchy.js).
    hierarchy: list[str] = field(default_factory=list)
    # design-guide rulebook findings (app/rulebook.py), each naming its rule id. `rules` block
    # a clean verify; `rule_notes` are reported only (proposed or still-observed rules, and
    # rules the export withheld for this project).
    rules: list[str] = field(default_factory=list)
    rule_notes: list[str] = field(default_factory=list)

    def empty(self) -> bool:
        return not (self.console_errors or self.page_errors or self.failed_requests
                    or self.low_contrast or self.unloaded_files or self.off_system
                    or self.off_palette or self.hierarchy or self.board or self.rules)

    def report(self) -> str:
        lines = []
        if self.empty():
            lines.append("No console errors, uncaught exceptions, failed requests, low-contrast "
                         "text, unloaded CSS/JS files, values outside the design system or palette, or "
                         "hierarchy problems.")
        for title, items in (("Uncaught exceptions", self.page_errors),
                             ("Console errors", self.console_errors),
                             ("Failed requests", self.failed_requests),
                             ("Low-contrast text (WCAG 4.5:1, 3:1 for large text)", self.low_contrast),
                             ("CSS/JS files in the project that this page does not load",
                              self.unloaded_files),
                             ("Board (board.json)", self.board),
                             ("Not from the design system (use its tokens; for a deliberate "
                              "exception such as a contrast fix, declare it as a custom property "
                              "named --ds-override-<name> and use that)", self.off_system),
                             ("Not from the page's Wada palette (use its colours; for a deliberate "
                              "extra such as a text ink that passes contrast, declare it as a custom "
                              "property named --palette-override-<name> and use that)", self.off_palette),
                             ("Hierarchy (data-priority 1 is the most important; each priority must "
                              "stand out clearly more than the next; change the styling, not the "
                              "marks, unless the declared order itself was wrong)", self.hierarchy),
                             ("Design rules from design-guide's rulebook (fix these)", self.rules),
                             ("Also reported, not blocking", self.rule_notes)):
            if items:
                lines.append(f"{title}:")
                lines.extend(f"- {item}" for item in dict.fromkeys(items))
        return "\n".join(lines)


def describe(item: dict) -> str:
    """One measured element for the report: what it is and why it scores what it does."""
    parts = []
    if item["text"]:
        t = item["text"]
        parts.append(f"{t['size']}px/{t['weight']}, contrast {t['contrast']}:1")
    else:
        parts.append(f"{item['area']} box")
    if item["fillRatio"]:
        parts.append(f"filled {item['fillRatio']}:1")
    if item["outline"]:
        parts.append("outlined")
    if item["belowFold"]:
        parts.append("below the fold")
    return f"\"{item['label']}\" ({', '.join(parts)}; prominence {item['score']})"


def hierarchy_problems(result: dict) -> list[str]:
    if result["missing"]:
        return ["No data-priority marks. Mark the few elements that carry this page's message "
                "and main action: data-priority=\"1\" for the most important, then \"2\", \"3\"."]
    items = [f"Not a priority: {bad} (use a whole number from 1)" for bad in result["invalid"]]
    for v in result["violations"]:
        items.append(f"priority {v['low_priority']} {describe(v['low'])} stands out as much as "
                     f"priority {v['high_priority']} {describe(v['high'])}")
    for u in result["unmarked"]:
        items.append(f"unmarked {describe(u['item'])} stands out as much as priority 1 "
                     f"{describe(u['first'])}")
    if len(items) > MAX_HIERARCHY_ITEMS:
        items = items[:MAX_HIERARCHY_ITEMS] + [f"... and {len(items) - MAX_HIERARCHY_ITEMS} more"]
    return items


class Previewer:
    def __init__(self, folder: Path, browser: Browser | None = None, hierarchy: bool = False,
                 rules: dict | None = None, dismissed: set[str] = frozenset()):
        """`browser`: a shared Chromium to borrow (not closed by close()); else one is
        launched on first use and owned. `hierarchy`: also check pages against their
        declared data-priority order (design projects). `rules`: design-guide's exported
        rulebook (app/rulebook.py), whose in-page measures replace the built-in contrast
        check; {"error": ...} fails every check; None keeps the built-in check (previews and
        thumbnails). `dismissed`: rule ids the user dismissed for this project."""
        self.folder = folder
        self.hierarchy = hierarchy
        self.rules = rules
        self.dismissed = set(dismissed)
        self._server = serve_folder(folder)
        self._playwright = None
        self._browser: Browser | None = browser
        self._owns_browser = browser is None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/"

    async def _browser_ready(self) -> Browser:
        if self._browser is None:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch()
        return self._browser

    async def _open(self, path: str, size: tuple[int, int],
                    scale: float = 1) -> tuple[Page, Problems]:
        browser = await self._browser_ready()
        page = await browser.new_page(viewport={"width": size[0], "height": size[1]},
                                      device_scale_factor=scale)
        problems = Problems()
        page.requested = set()  # URLs the page asked for, for the unloaded-files check
        page.on("request", lambda r: page.requested.add(r.url.split("?")[0].split("#")[0]))
        page.on("console", lambda m: m.type == "error" and problems.console_errors.append(m.text))
        page.on("pageerror", lambda e: problems.page_errors.append(str(e)))
        page.on("requestfailed", lambda r: problems.failed_requests.append(f"{r.url} ({r.failure})"))
        page.on("response", lambda r: r.status >= 400
                and problems.failed_requests.append(f"{r.url} (HTTP {r.status})"))
        if not (self.folder / path).is_file():
            problems.failed_requests.append(f"{path} does not exist in the project")
            return page, problems
        await page.goto(self.base_url + path, wait_until="load")
        await page.wait_for_timeout(SETTLE_MS)
        return page, problems

    async def screenshot(self, path: str, size: tuple[int, int],
                         full_page: bool = False) -> tuple[bytes, Problems]:
        page, problems = await self._open(path, size)
        try:
            if (self.folder / path).is_file():
                await self._check_page(page, problems, path, size[0])
            return await page.screenshot(full_page=full_page), problems
        finally:
            await page.close()

    def _ruled(self, measure: str) -> tuple[bool, str]:
        """For a check of ultimate-design's that design-guide names as a rule (its `design-system`,
        `palette` and `hierarchy` measures, whose one implementation is here): whether the user dismissed it for
        this project, and the "<rule id>: " prefix its findings carry. Without that rule in the
        rulebook (none configured, or withheld for this project), no prefix and never dismissed."""
        for r in (self.rules or {}).get("rules", []):
            if r["check"].get("measure") == measure:
                return r["id"] in self.dismissed, f"{r['id']}: "
        return False, ""

    async def _check_palette(self, page: Page, problems: Problems) -> None:
        dismissed, prefix = self._ruled("palette")
        if dismissed:
            return
        content = await page.evaluate("document.querySelector('meta[name=palette]')?.content ?? null")
        if content is None:
            return
        n = palette.parse(content)
        colours = palette.combination(n) if n else None
        if colours is None:
            problems.off_palette.append(f'{prefix}<meta name="palette" content="{content}"> names no Wada '
                                        "combination; use wada:001 to wada:348 (palettes/wada/combinations.md)")
            return
        # evaluate() passes one argument; the check takes the palette as its second.
        result = await page.evaluate(f"(hexes) => ({CONFORMANCE_JS})('', hexes)", [c["hex"] for c in colours])
        for c in result["colors"][:MAX_CONFORMANCE_ITEMS]:
            problems.off_palette.append(f"{prefix}colour {css_hex(c['value'])}: {c['count']} element(s), "
                                        f"e.g. \"{c['example']}\"; the page's palette is {palette.label(n)}")

    async def _check_rules(self, page: Page, problems: Problems, path: str, width: int) -> None:
        """The rulebook's in-page measures at this viewport (docs/gate-rulebook.md section 3)."""
        if "error" in self.rules:
            problems.rules.append(f"Rulebook unavailable: {self.rules['error']}. The design cannot be "
                                  "checked against design-guide's rules until this is fixed; tell the user.")
            return
        for rule in rulebook.in_page(self.rules):
            check = rule["check"]
            if rule["id"] in self.dismissed:
                continue
            target = problems.rules if rulebook.blocking(rule) else problems.rule_notes
            if check["measure"] == "reflow":
                if width == DESKTOP[0]:  # once per verify, at its own width
                    target.extend(await self._reflow(path, rule))
                continue
            if width not in check.get("viewports", [DESKTOP[0], MOBILE[0]]):
                continue
            if check["measure"] == "contrast":
                groups = await page.evaluate(CONTRAST_JS, check.get("params", {}))
                target.extend(rulebook.finding_line(rule, f"{g['pair']}: {g['ratio']}:1, needs {g['needed']}:1 "
                                                          f"({g['count']} element(s), e.g. \"{g['example']}\")")
                              for g in groups[:MAX_CONTRAST_GROUPS])
            elif check["measure"] == "target-size":
                small = await page.evaluate(TARGET_SIZE_JS, check.get("params", {}))
                target.extend(rulebook.finding_line(rule, f"\"{t['label']}\" is {t['width']}x{t['height']}px")
                              for t in small[:MAX_CONFORMANCE_ITEMS])
        if width == DESKTOP[0]:
            problems.rule_notes.extend(f"{w['id']} was not checked for this project: {w['reason']}"
                                       for w in self.rules.get("withheld", []))

    async def _reflow(self, path: str, rule: dict) -> list[str]:
        width = rule["check"].get("params", {}).get("width", 320)
        page, _ = await self._open(path, (width, MOBILE[1]))
        try:
            wide = await page.evaluate("document.documentElement.scrollWidth")
        finally:
            await page.close()
        if wide <= width + 1:
            return []
        return [rulebook.finding_line(rule, f"At {width}px the page is {wide}px wide and scrolls sideways")]

    async def _check_page(self, page: Page, problems: Problems, path: str = "", width: int = DESKTOP[0]) -> None:
        """Checks beyond errors: text contrast (or, with a rulebook, its in-page measures), and
        project CSS/JS the page never loads (a page that forgot to link its stylesheet looks
        broken but raises no error)."""
        if self.rules is not None:
            await self._check_rules(page, problems, path, width)
        else:
            groups = await page.evaluate(CONTRAST_JS)
            for g in groups[:MAX_CONTRAST_GROUPS]:
                problems.low_contrast.append(
                    f"{g['pair']}: {g['ratio']}:1, needs {g['needed']}:1 "
                    f"({g['count']} element(s), e.g. \"{g['example']}\")")
            if len(groups) > MAX_CONTRAST_GROUPS:
                problems.low_contrast.append(f"... and {len(groups) - MAX_CONTRAST_GROUPS} more colour pairs")
        if (self.folder / "design-system").is_dir():
            dismissed, prefix = self._ruled("design-system")
            library = self.folder / "design-system" / "components" / "components.css"
            result = None if dismissed else \
                await page.evaluate(CONFORMANCE_JS, library.read_text() if library.is_file() else "")
            if result:
                for c in result["colors"][:MAX_CONFORMANCE_ITEMS]:
                    problems.off_system.append(
                        f"{prefix}colour {css_hex(c['value'])}: {c['count']} element(s), e.g. \"{c['example']}\"")
                for f in result["fonts"][:MAX_CONFORMANCE_ITEMS]:
                    problems.off_system.append(
                        f"{prefix}font \"{f['value']}\": {f['count']} element(s), e.g. \"{f['example']}\"")
                for i in result["imitations"][:MAX_CONFORMANCE_ITEMS]:
                    problems.off_system.append(
                        f"{prefix}{i['key']} ({i['count']} element(s), e.g. \"{i['example']}\") looks like the system's "
                        f"ds-{i['name']} but isn't it: use the ds-{i['name']} markup from design-system/README.md "
                        f"(keep your own class for layout only)")
        else:  # without a design system, a page may name a Wada palette
            await self._check_palette(page, problems)
        if self.hierarchy:
            dismissed, prefix = self._ruled("hierarchy")  # design-guide's hierarchy-matches-priority
            if not dismissed:
                problems.hierarchy.extend(prefix + line for line in
                                          hierarchy_problems(await page.evaluate(HIERARCHY_JS)))
        if (self.folder / board.BOARD_FILE).is_file():
            problems.board.extend(board.load(self.folder)["problems"])
            # A designed print page is cut at its edge in the PDF: nothing may run past it.
            frame = board.print_frame(self.folder, path)
            if frame and frame["print"] == "page":
                height = await page.evaluate("document.documentElement.scrollHeight")
                if height > frame["height"] + 1:
                    problems.board.append(
                        f"{path} is a {frame['paper']} page ({frame['width']}x{frame['height']}px) but its "
                        f"content is {height}px tall; everything past {frame['height']}px is cut from the PDF")
        for asset in sorted(self.folder.rglob("*")):
            # A design system's component library is optional per page, so not reported.
            if "components" in asset.parts and "design-system" in asset.parts:
                continue
            if asset.suffix in CHECKED_ASSETS and asset.is_file():
                rel = asset.relative_to(self.folder).as_posix()
                if self.base_url + urllib.parse.quote(rel) not in page.requested:
                    problems.unloaded_files.append(rel)

    async def thumbnail(self, path: str, scale: float) -> bytes:
        """A small PNG of the page's first screen at desktop width: the viewport stays
        1440 wide so the layout is the desktop one, and the scale factor shrinks the pixels."""
        page, _ = await self._open(path, DESKTOP, scale)
        try:
            return await page.screenshot()
        finally:
            await page.close()

    async def full_page(self, path: str, width: int) -> bytes:
        """The whole page at one width, for comparing two versions (app/compare.py)."""
        page, _ = await self._open(path, (width, DESKTOP[1]))
        try:
            return await page.screenshot(full_page=True)
        finally:
            await page.close()

    async def pdf(self, path: str, width: int = DESKTOP[0]) -> bytes:
        """The page as one long PDF page at screen styling, so it looks like the canvas."""
        page, _ = await self._open(path, (width, DESKTOP[1]))
        try:
            await page.emulate_media(media="screen")
            height = await page.evaluate("document.documentElement.scrollHeight")
            return await page.pdf(width=f"{width}px", height=f"{height + 1}px",
                                  print_background=True)
        finally:
            await page.close()

    async def sketch(self, path: str, size: tuple[int, int], scroll_y: int, overlay_png: bytes) -> bytes:
        """What the user saw on the canvas with their drawing on top: the page at the
        canvas's size and scroll position, the strokes (a transparent PNG of the same area)
        laid over the viewport by the browser, then a viewport screenshot."""
        import base64
        page, _ = await self._open(path, size)
        try:
            await page.evaluate("y => window.scrollTo(0, y)", scroll_y)
            await page.evaluate("""src => new Promise((done) => {
                const img = document.createElement("img");
                img.onload = img.onerror = done;
                img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none";
                img.src = src;
                document.documentElement.append(img);
            })""", "data:image/png;base64," + base64.b64encode(overlay_png).decode())
            return await page.screenshot()
        finally:
            await page.close()

    async def pdf_frame(self, frame: dict) -> bytes:
        """One board frame as PDF: a designed page (or a screen) is one PDF page at the
        frame's size; a flow document paginates onto its paper with 0.75in margins, using
        print styles, so CSS page breaks work."""
        page, _ = await self._open(frame["page"], (frame["width"], frame["height"]))
        try:
            if frame["print"] == "flow":
                await page.emulate_media(media="print")
                return await page.pdf(format="Letter" if frame["paper"] == "letter" else "A4",
                                      margin={side: "0.75in" for side in ("top", "right", "bottom", "left")},
                                      print_background=True)
            await page.emulate_media(media="screen")
            return await page.pdf(width=f"{frame['width']}px", height=f"{frame['height']}px",
                                  print_background=True, page_ranges="1")
        finally:
            await page.close()

    async def evaluate(self, path: str, expression: str, size: tuple[int, int] = DESKTOP) -> str:
        page, problems = await self._open(path, size)
        try:
            value = await page.evaluate(expression)
            return json.dumps(value, indent=2, default=str)
        finally:
            await page.close()

    async def close(self) -> None:
        if self._browser and self._owns_browser:
            await self._browser.close()
            await self._playwright.stop()
        self._server.shutdown()


CAPTURE_MAX_HEIGHT = 8000
CAPTURE_MAX_TEXT = 100_000


async def capture_page(url: str) -> tuple[bytes, str, str]:
    """Screenshot (full page at 1440 wide, cut at 8000 px) and visible text of a web page,
    for attaching a reference site to a chat message. Returns (png, text, title)."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page(viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
            await page.goto(url, wait_until="load", timeout=30_000)
            await page.wait_for_timeout(800)
            height = await page.evaluate("document.documentElement.scrollHeight")
            png = await page.screenshot(full_page=True, clip={
                "x": 0, "y": 0, "width": DESKTOP[0], "height": min(height, CAPTURE_MAX_HEIGHT)})
            text = (await page.evaluate("document.body ? document.body.innerText : ''"))[:CAPTURE_MAX_TEXT]
            return png, text, await page.title()
        finally:
            await browser.close()
