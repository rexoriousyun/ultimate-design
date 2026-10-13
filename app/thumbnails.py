"""Home-screen thumbnails: a small PNG of each project's entry page at its latest version.

Cached as data/<slug>/thumb-<sha>.png, so a thumbnail is rendered once per version and a
new version makes a new one (older files are removed). Rendering shares one Chromium and
runs one at a time, so a Home page full of new projects doesn't start dozens of browsers.
"""

import asyncio
import tempfile
from pathlib import Path

from playwright.async_api import Browser, async_playwright

from app import projects
from app.preview import Previewer

SCALE = 0.3  # 1440x900 -> 432x270, enough for a card up to ~430 CSS px wide

_lock = asyncio.Lock()
_playwright = None
_browser: Browser | None = None


async def _shared_browser() -> Browser:
    global _playwright, _browser
    if _browser is None or not _browser.is_connected():
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch()
    return _browser


def cache_path(slug: str, sha: str) -> Path:
    return projects.DATA_DIR / slug / f"thumb-{sha}.png"


async def thumbnail(slug: str, cache: bool = True) -> bytes | None:
    """PNG bytes for the project's latest version, or None if it has no design yet.
    The page is rendered from the live files, so while a turn is changing them the
    caller passes cache=False and the half-built page is not stored."""
    sha = projects.latest_version(slug)
    entry = projects.get(slug)["entry"]
    if sha is None:
        # Projects from before version history (milestone 1) have files but no versions:
        # render the live page, uncached.
        if not (projects.design_dir(slug) / entry).is_file():
            return None
        return await _render(slug, entry)
    if projects.file_at_version(slug, sha, entry) is None:
        return None
    cached = cache_path(slug, sha)
    if cached.exists():
        return cached.read_bytes()
    png = await _render(slug, entry)
    if cache:
        for old in cached.parent.glob("thumb-*.png"):
            old.unlink()
        cached.write_bytes(png)
    return png


def version_cache_path(slug: str, sha: str) -> Path:
    return projects.DATA_DIR / slug / "versions" / f"{sha}.png"


async def version_thumbnail(slug: str, sha: str) -> bytes | None:
    """PNG bytes of one version's entry page, for the studio's History (one per version, kept:
    a version never changes). None when that version has no entry page."""
    entry = projects.get(slug)["entry"]
    if projects.file_at_version(slug, sha, entry) is None:
        return None
    cached = version_cache_path(slug, sha)
    if cached.exists():
        return cached.read_bytes()
    with tempfile.TemporaryDirectory() as folder:
        projects.export_version(slug, sha, Path(folder))
        async with _lock:
            previewer = Previewer(Path(folder), await _shared_browser())
            try:
                png = await previewer.thumbnail(entry, SCALE)
            finally:
                await previewer.close()
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(png)
    return png


async def _render(slug: str, entry: str) -> bytes:
    async with _lock:
        previewer = Previewer(projects.design_dir(slug), await _shared_browser())
        try:
            return await previewer.thumbnail(entry, SCALE)
        finally:
            await previewer.close()


async def close() -> None:
    """Called on app shutdown. Also resets the lock, which binds to one event loop."""
    global _playwright, _browser, _lock
    if _browser is not None:
        await _browser.close()
        await _playwright.stop()
        _browser = _playwright = None
    _lock = asyncio.Lock()
