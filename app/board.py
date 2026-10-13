"""The board: a project's pages shown side by side as frames (Claude Design's artboards).

The design agent describes it in `board.json` at the top of the design folder:

    {"rows": ["Screens", "Directions"],
     "frames": [{"page": "index.html", "title": "Home", "width": 1440, "row": 0},
                {"page": "directions/a.html", "title": "A · Warm editorial", "row": 1}]}

A frame can be a sheet of paper instead of a screen: `"paper": "letter"|"a4"`, optional
`"landscape": true`, and `"print": "page"` (one designed page: a poster, a one-pager; the
default) or `"flow"` (a document that paginates onto the paper when exported). Its width
and height then come from the paper at 96 px/in.

Frames are laid out automatically: rows top to bottom, frames left to right in order, so
nobody computes coordinates. A page may appear more than once (say at 1440 and 390). Pages
the file doesn't list still show, at the end of the first row, and without a board.json
every page shows in one row. Problems (bad JSON, a missing page) are returned for the
studio to show and for verify to report, never raised.
"""

import json
from pathlib import Path

BOARD_FILE = "board.json"
WIDTHS = {390: 844, 834: 1112, 1440: 900}  # frame width -> preview height
PAPERS = {"letter": (816, 1056), "a4": (794, 1123)}  # CSS px at 96 px/in, portrait
DEFAULT_WIDTH = 1440
MAX_FRAMES = 24


def pages(folder: Path) -> list[str]:
    """The design's HTML pages, not the attached design system's files."""
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*.htm*")
                  if p.is_file() and p.suffix.lower() in {".html", ".htm"}
                  and "design-system" not in p.relative_to(folder).parts)


def load(folder: Path, entry: str = "index.html") -> dict:
    """{"rows": [titles], "frames": [{page, title, width, height, row}], "problems": [..]}."""
    available = pages(folder)
    ordered = ([entry] if entry in available else []) + [p for p in available if p != entry]
    path = folder / BOARD_FILE
    problems, rows, frames = [], [], []
    spec = {}
    if path.is_file():
        try:
            spec = json.loads(path.read_text())
            if not isinstance(spec, dict):
                raise ValueError("the top level must be an object")
        except ValueError as err:
            problems.append(f"{BOARD_FILE} is not valid: {err}")
            spec = {}
    raw_rows = spec.get("rows", [])
    rows = [str(r) for r in raw_rows] if isinstance(raw_rows, list) else []
    raw_frames = spec.get("frames", [])
    if not isinstance(raw_frames, list):
        problems.append(f'{BOARD_FILE}: "frames" must be a list')
        raw_frames = []
    for i, f in enumerate(raw_frames):
        if not isinstance(f, dict) or not isinstance(f.get("page"), str):
            problems.append(f"{BOARD_FILE}: frame {i + 1} needs a \"page\"")
            continue
        page = f["page"]
        if page not in available:
            problems.append(f"{BOARD_FILE}: frame {i + 1} names {page}, which does not exist")
            continue
        row = f.get("row", 0)
        row = row if isinstance(row, int) and 0 <= row < 20 else 0
        title = str(f.get("title") or Path(page).stem)[:80]
        frame = {"page": page, "title": title, "row": row, "paper": None, "print": None}
        if "paper" in f:
            if f["paper"] not in PAPERS:
                problems.append(f"{BOARD_FILE}: frame {i + 1} paper {f['paper']} is not letter or a4")
                continue
            width, height = PAPERS[f["paper"]]
            if f.get("landscape"):
                width, height = height, width
            mode = f.get("print", "page")
            if mode not in ("page", "flow") or (mode == "flow" and f.get("landscape")):
                problems.append(f"{BOARD_FILE}: frame {i + 1} print must be \"page\" or \"flow\" (flow is portrait only)")
                mode = "page"
            frame.update(width=width, height=height, paper=f["paper"], print=mode,
                         landscape=bool(f.get("landscape")))
        else:
            width = f.get("width", DEFAULT_WIDTH)
            if width not in WIDTHS:
                problems.append(f"{BOARD_FILE}: frame {i + 1} width {width} is not one of 390, 834, 1440")
                width = DEFAULT_WIDTH
            frame.update(width=width, height=WIDTHS[width])
        frames.append(frame)
    listed = {f["page"] for f in frames}
    for page in ordered:
        if page not in listed:
            frames.append({"page": page, "title": Path(page).stem if page != entry else "Home",
                           "width": DEFAULT_WIDTH, "height": WIDTHS[DEFAULT_WIDTH], "row": 0,
                           "paper": None, "print": None})
    if len(frames) > MAX_FRAMES:
        problems.append(f"{len(frames)} frames; the board shows the first {MAX_FRAMES}")
        frames = frames[:MAX_FRAMES]
    used = max((f["row"] for f in frames), default=0) + 1
    rows = (rows + [""] * used)[:used]
    return {"rows": rows, "frames": frames, "problems": problems}


def print_frame(folder: Path, page: str, entry: str = "index.html") -> dict | None:
    """The first paper frame showing `page`, if the board prints it."""
    return next((f for f in load(folder, entry)["frames"] if f["page"] == page and f["paper"]), None)
