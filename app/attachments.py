"""Files attached to chat messages: uploads (images, PDFs, Office documents, text) and
captured web pages. Stored in data/<slug>/attachments/, which the agent may read but not
write. An attachment is pending until the next message is sent, then it belongs to that
message (like comments). Word, PowerPoint and Excel files get a .txt next to them, since
the agent's Read tool handles images, PDFs and text but not Office formats.
"""

import json
import re
import time
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAX_BYTES = 20 * 1024 * 1024
IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
OFFICE = {".docx", ".pptx", ".xlsx"}
TEXT = {".txt", ".md", ".csv", ".json", ".html", ".css", ".js", ".svg", ".xml", ".yaml", ".yml"}
ALLOWED = IMAGE | OFFICE | TEXT | {".pdf"}


class AttachmentError(Exception):
    """Shown to the user."""


def folder(data_dir: Path) -> Path:
    return data_dir / "attachments"


def _index(data_dir: Path) -> Path:
    return data_dir / "attachments.json"


def list_all(data_dir: Path) -> list[dict]:
    path = _index(data_dir)
    return json.loads(path.read_text()) if path.exists() else []


def pending(data_dir: Path) -> list[dict]:
    return [a for a in list_all(data_dir) if a["status"] == "pending"]


def _save_index(data_dir: Path, items: list[dict]) -> None:
    _index(data_dir).write_text(json.dumps(items, indent=2))


def kind_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in IMAGE:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext in OFFICE:
        return "document"
    return "text"


def add(data_dir: Path, name: str, content: bytes, source: str | None = None) -> dict:
    """Store an upload. `source` is the URL for a captured page."""
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        raise AttachmentError(f"{ext or 'That file type'} is not supported. Use images, PDFs, "
                              "Word, PowerPoint, Excel or text files.")
    if len(content) > MAX_BYTES:
        raise AttachmentError("Files must be 20 MB or smaller.")
    safe = re.sub(r"[^\w.-]+", "-", Path(name).name).strip("-") or f"file{ext}"
    item_id = uuid.uuid4().hex[:8]
    target = folder(data_dir) / f"{item_id}-{safe}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    item = {"id": item_id, "name": Path(name).name, "path": str(target), "kind": kind_of(name),
            "size": len(content), "source": source, "status": "pending", "created": time.time(),
            "text_path": None}
    if ext in OFFICE:
        text = office_text(target)
        if text:
            text_path = target.with_suffix(target.suffix + ".txt")
            text_path.write_text(text)
            item["text_path"] = str(text_path)
    items = list_all(data_dir)
    items.append(item)
    _save_index(data_dir, items)
    return item


def remove(data_dir: Path, item_id: str) -> bool:
    """Delete a pending attachment (sent ones stay: the agent's history refers to them)."""
    items = list_all(data_dir)
    for item in items:
        if item["id"] == item_id and item["status"] == "pending":
            for key in ("path", "text_path"):
                if item[key]:
                    Path(item[key]).unlink(missing_ok=True)
            _save_index(data_dir, [i for i in items if i is not item])
            return True
    return False


def mark_sent(data_dir: Path) -> list[dict]:
    """Pending attachments become part of the message being sent; returns them."""
    items = list_all(data_dir)
    sent = []
    for item in items:
        if item["status"] == "pending":
            item["status"] = "sent"
            sent.append(item)
    _save_index(data_dir, items)
    return sent


def get(data_dir: Path, item_id: str) -> dict | None:
    return next((i for i in list_all(data_dir) if i["id"] == item_id), None)


def prompt_block(items: list[dict], images_ok: bool) -> str:
    """How attachments are listed for the agent, after the user's message."""
    lines = ["Attached files (read them with the Read tool; they are read-only):"]
    for item in items:
        where = item["text_path"] or item["path"]
        what = {"image": "image", "pdf": "PDF", "document": "document, as extracted text",
                "text": "text"}[item["kind"]]
        if item["source"]:
            what += f", captured from {item['source']}"
        if item["kind"] == "image" and not images_ok:
            what += "; this model cannot view images, so rely on the user's description"
        lines.append(f"- {where} ({item['name']}: {what})")
    return "\n".join(lines)


# ---------- Office text extraction (no dependencies) ----------

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def office_text(path: Path) -> str:
    """Plain text of a .docx, .pptx or .xlsx: paragraphs, slide text, or sheet rows."""
    try:
        with zipfile.ZipFile(path) as z:
            ext = path.suffix.lower()
            if ext == ".docx":
                return _docx(z)
            if ext == ".pptx":
                return _pptx(z)
            if ext == ".xlsx":
                return _xlsx(z)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        return ""
    return ""


def _docx(z: zipfile.ZipFile) -> str:
    root = ElementTree.fromstring(z.read("word/document.xml"))
    return "\n".join("".join(t.text or "" for t in p.iter(f"{W}t")) for p in root.iter(f"{W}p")).strip()


def _pptx(z: zipfile.ZipFile) -> str:
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                    key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
    parts = []
    for n, name in enumerate(slides, 1):
        root = ElementTree.fromstring(z.read(name))
        lines = ["".join(t.text or "" for t in p.iter(f"{A}t")) for p in root.iter(f"{A}p")]
        parts.append(f"--- Slide {n} ---\n" + "\n".join(line for line in lines if line.strip()))
    return "\n\n".join(parts).strip()


def _xlsx(z: zipfile.ZipFile) -> str:
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ElementTree.fromstring(z.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iter(f"{S}t")) for si in root.iter(f"{S}si")]
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    parts = []
    for name in sheets:
        root = ElementTree.fromstring(z.read(name))
        rows = []
        for row in root.iter(f"{S}row"):
            cells = []
            for c in row.iter(f"{S}c"):
                v = c.find(f"{S}v")
                inline = c.find(f"{S}is")
                if c.get("t") == "s" and v is not None:
                    cells.append(shared[int(v.text)])
                elif inline is not None:
                    cells.append("".join(t.text or "" for t in inline.iter(f"{S}t")))
                elif v is not None:
                    cells.append(v.text or "")
            rows.append("\t".join(cells))
        parts.append(f"--- {name.rsplit('/', 1)[1].removesuffix('.xml')} ---\n" + "\n".join(rows))
    return "\n\n".join(parts).strip()
