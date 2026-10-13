"""Exports of a project folder: one self-contained HTML file, a ZIP, and (via
app/preview.py) PNG and PDF renders."""

import base64
import io
import mimetypes
import re
import zipfile
from pathlib import Path

REMOTE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.I)  # http:, data:, //cdn, #anchor
LINK_CSS = re.compile(r"<link\b[^>]*>", re.I)
SCRIPT_SRC = re.compile(r"<script\b([^>]*)\bsrc=[\"']([^\"']+)[\"']([^>]*)>\s*</script>", re.I)
SRC_ATTR = re.compile(r"(<(?:img|source|video|audio)\b[^>]*\bsrc=)([\"'])([^\"']+)\2", re.I)
CSS_URL = re.compile(r"url\(\s*([\"']?)([^\"')]+)\1\s*\)", re.I)
HREF = re.compile(r"\bhref=[\"']([^\"']+)[\"']", re.I)


def _local(root: Path, base: Path, ref: str) -> Path | None:
    """A reference resolved to a file inside the project, or None if remote or missing."""
    if REMOTE.match(ref):
        return None
    path = (base / ref.split("?")[0].split("#")[0]).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        return None
    return path


def _data_uri(path: Path) -> str:
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _inline_css_urls(root: Path, css: str, base: Path) -> str:
    def repl(m):
        path = _local(root, base, m.group(2))
        return f'url("{_data_uri(path)}")' if path else m.group(0)
    return CSS_URL.sub(repl, css)


def inline_html(root: Path, entry: str) -> str:
    """The entry page with local stylesheets, scripts, images and CSS url()s inlined, so it
    works as a single file. Remote URLs are left alone."""
    page = root / entry
    base = page.parent
    html = page.read_text()

    def link(m):
        tag = m.group(0)
        href = HREF.search(tag)
        if "stylesheet" not in tag.lower() or not href:
            return tag
        path = _local(root, base, href.group(1))
        if not path:
            return tag
        return f"<style>\n{_inline_css_urls(root, path.read_text(), path.parent)}\n</style>"

    def script(m):
        path = _local(root, base, m.group(2))
        if not path:
            return m.group(0)
        # "</script" inside the code would end the element early.
        code = path.read_text().replace("</script", "<\\/script")
        return f"<script{m.group(1)}{m.group(3)}>\n{code}\n</script>"

    def src(m):
        path = _local(root, base, m.group(3))
        return f"{m.group(1)}{m.group(2)}{_data_uri(path)}{m.group(2)}" if path else m.group(0)

    html = LINK_CSS.sub(link, html)
    html = SCRIPT_SRC.sub(script, html)
    html = SRC_ATTR.sub(src, html)
    return _inline_css_urls(root, html, base)  # inline <style> blocks and style attributes


def zip_folder(root: Path, prefix: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                z.write(path, f"{prefix}/{path.relative_to(root)}")
    return buffer.getvalue()
