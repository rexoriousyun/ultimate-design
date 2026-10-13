"""Comparing two versions of a design: a full-page screenshot of one page at one width from
each version, and the regions where the two differ, outlined in the studio's Compare view.

Screenshots are cached as data/<slug>/compare/<sha>-<page>-<width>.png and comparisons as
.json beside them: a version never changes. Rendering and comparing share the thumbnails'
Chromium and lock. The comparison runs in that browser (a canvas per screenshot), so the app
needs no image library: the page is split into CELL-pixel cells, a cell is changed when any
pixel differs by more than THRESHOLD in a channel, and changed cells close to each other are
merged into boxes.
"""

import base64
import json
import re
import tempfile
from pathlib import Path

from app import projects, thumbnails
from app.preview import Previewer

CELL = 12
THRESHOLD = 24  # anti-aliasing stays under this; a real change of colour or text does not
NEAR = 2  # cells: changes this close together are one box
MAX_BOXES = 40

DIFF_JS = """async ([a, b, cell, threshold, near, maxBoxes]) => {
  const load = (src) => new Promise((ok, fail) => {
    const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const pixels = (img) => {
    const ctx = new OffscreenCanvas(w, h).getContext("2d");
    ctx.drawImage(img, 0, 0);  // past the shorter page stays transparent: changed
    return ctx.getImageData(0, 0, w, h).data;
  };
  const pa = pixels(ia), pb = pixels(ib);
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const changed = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < w; x++) {
      const c = row + Math.floor(x / cell);
      if (changed[c]) { x = (Math.floor(x / cell) + 1) * cell - 1; continue; }
      const i = (y * w + x) * 4;
      if (Math.abs(pa[i] - pb[i]) > threshold || Math.abs(pa[i + 1] - pb[i + 1]) > threshold
          || Math.abs(pa[i + 2] - pb[i + 2]) > threshold || Math.abs(pa[i + 3] - pb[i + 3]) > threshold) changed[c] = 1;
    }
  }
  const seen = new Uint8Array(cols * rows), boxes = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0, cells = 0;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const c = stack.pop(), cx = c % cols, cy = Math.floor(c / cols);
      cells++; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (changed[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    boxes.push({ x: x0 * cell, y: y0 * cell, w: Math.min(w, (x1 + 1) * cell) - x0 * cell,
                 h: Math.min(h, (y1 + 1) * cell) - y0 * cell, cells });
  }
  boxes.sort((p, q) => q.cells - p.cells);
  const kept = boxes.slice(0, maxBoxes).sort((p, q) => p.y - q.y || p.x - q.x)
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
  return { width: w, heights: [ia.height, ib.height], boxes: kept };
}"""


def _stem(page: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", page).strip("-")


def _cache(slug: str, name: str) -> Path:
    return projects.DATA_DIR / slug / "compare" / name


async def shot(slug: str, sha: str, page: str, width: int) -> bytes | None:
    """The whole of `page` at `width` as it was at version `sha`; None if that version has no
    such page."""
    if projects.file_at_version(slug, sha, page) is None:
        return None
    cached = _cache(slug, f"{sha}-{_stem(page)}-{width}.png")
    if cached.exists():
        return cached.read_bytes()
    with tempfile.TemporaryDirectory() as folder:
        projects.export_version(slug, sha, Path(folder))
        async with thumbnails._lock:
            previewer = Previewer(Path(folder), await thumbnails._shared_browser())
            try:
                png = await previewer.full_page(page, width)
            finally:
                await previewer.close()
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(png)
    return png


async def compare(slug: str, a: str, b: str, page: str, width: int) -> dict:
    """What changed on `page` from version `a` to version `b`: {"a", "b", "page", "width",
    "files" (changed files with lines added and removed), "missing" ("a" or "b" when the page
    is not in that version), "size" ({"width", "heights"}) and "boxes" (changed regions in
    page pixels)}."""
    result = {"a": a, "b": b, "page": page, "width": width, "files": projects.diff_versions(slug, a, b),
              "missing": None, "size": None, "boxes": []}
    cached = _cache(slug, f"{a}-{b}-{_stem(page)}-{width}.json")
    if cached.exists():
        return {**result, **json.loads(cached.read_text())}
    shots = [await shot(slug, a, page, width), await shot(slug, b, page, width)]
    if None in shots:
        result["missing"] = "a" if shots[0] is None else "b"
        return result
    urls = ["data:image/png;base64," + base64.b64encode(png).decode() for png in shots]
    async with thumbnails._lock:
        browser = await thumbnails._shared_browser()
        tab = await browser.new_page()
        try:
            found = await tab.evaluate(DIFF_JS, [*urls, CELL, THRESHOLD, NEAR, MAX_BOXES])
        finally:
            await tab.close()
    measured = {"size": {"width": found["width"], "heights": found["heights"]}, "boxes": found["boxes"]}
    cached.write_text(json.dumps(measured))
    return {**result, **measured}
