"""Remote design-system sources: a GitHub repository or a Figma file, fetched into
data/<slug>/source/ so the extraction agent can read them like a local folder.

- GitHub (https://github.com/<owner>/<repo>[/tree/<branch>[/<path>]]): a shallow clone,
  using this machine's git credentials, so private repos work when git can reach them.
- Figma (https://www.figma.com/design/<key>/... or /file/<key>/...): needs FIGMA_TOKEN.
  Writes figma-file.json (the document), figma-summary.json (fill colours and text styles
  by use count) and frames/*.png (the first frames of each page), for the agent to read.
"""

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

GITHUB = re.compile(r"^https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/tree/([^/]+)(/.*)?)?/?$")
FIGMA = re.compile(r"^https://(?:www\.)?figma\.com/(?:file|design)/([A-Za-z0-9]+)")
FIGMA_API = "https://api.figma.com"
MAX_FRAMES = 12


class SourceError(Exception):
    """A source that can't be fetched; the message is shown to the user."""


def kind(source: str) -> str:
    if GITHUB.match(source):
        return "github"
    if FIGMA.match(source):
        return "figma"
    return "path"


def github_clone_url(owner: str, repo: str) -> str:
    return f"https://github.com/{owner}/{repo}.git"


def fetch(source: str, dest: Path) -> Path:
    """Fetch a GitHub or Figma source into `dest` (replacing it). Returns the folder the
    agent should read: the clone, a subfolder of it, or the Figma export."""
    shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if m := GITHUB.match(source):
        return _clone(m, dest)
    if m := FIGMA.match(source):
        return _figma(m.group(1), dest)
    raise SourceError("Not a GitHub or Figma URL")


def _clone(m: re.Match, dest: Path) -> Path:
    owner, repo, branch, subpath = m.groups()
    cmd = ["git", "clone", "--depth", "1", "--quiet"]
    if branch:
        cmd += ["--branch", branch]
    cmd += [github_clone_url(owner, repo), str(dest)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300,
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    if result.returncode != 0:
        raise SourceError(f"Could not clone {owner}/{repo}: {result.stderr.strip()[-300:]}")
    folder = (dest / subpath.strip("/")) if subpath else dest
    if not folder.resolve().is_relative_to(dest.resolve()) or not folder.is_dir():
        raise SourceError(f"{subpath} is not a folder in {owner}/{repo}")
    return folder


def _figma_get(path: str, token: str) -> dict:
    request = urllib.request.Request(FIGMA_API + path, headers={"X-Figma-Token": token})
    try:
        with urllib.request.urlopen(request, timeout=120) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        raise SourceError(f"Figma API error {err.code} for {path.split('?')[0]}") from err
    except OSError as err:
        raise SourceError(f"Could not reach the Figma API: {err}") from err


def _figma(key: str, dest: Path) -> Path:
    token = os.environ.get("FIGMA_TOKEN")
    if not token:
        raise SourceError("Set FIGMA_TOKEN (a Figma personal access token) to use Figma files")
    document = _figma_get(f"/v1/files/{key}", token)
    dest.mkdir(parents=True)
    (dest / "figma-file.json").write_text(json.dumps(document, indent=1))
    (dest / "figma-summary.json").write_text(json.dumps(summarize(document), indent=2))

    frames = [(page["name"], child) for page in document.get("document", {}).get("children", [])
              for child in page.get("children", []) if child.get("type") in ("FRAME", "COMPONENT_SET")]
    frames = frames[:MAX_FRAMES]
    if frames:
        ids = ",".join(frame["id"] for _, frame in frames)
        urls = _figma_get(f"/v1/images/{key}?ids={urllib.parse.quote(ids)}&format=png&scale=1",
                          token).get("images", {})
        (dest / "frames").mkdir()
        for n, (page, frame) in enumerate(frames, 1):
            url = urls.get(frame["id"])
            if not url:
                continue
            name = re.sub(r"[^\w.-]+", "-", f"{n:02d}-{page}-{frame['name']}")[:80]
            with urllib.request.urlopen(url, timeout=120) as res:
                (dest / "frames" / f"{name}.png").write_bytes(res.read())
    return dest


def summarize(document: dict) -> dict:
    """What a design system needs from a Figma file, counted by use: solid fill colours,
    text styles (family, size, weight, line height) and corner radii, plus named styles."""
    colors, texts, radii = Counter(), Counter(), Counter()

    def walk(node):
        for fill in node.get("fills", []) or []:
            if fill.get("type") == "SOLID" and fill.get("visible", True):
                c = fill["color"]
                alpha = c.get("a", 1) * fill.get("opacity", 1)
                hexa = "#" + "".join(f"{round(c[k] * 255):02x}" for k in "rgb")
                colors[hexa if alpha >= 1 else f"{hexa} at {round(alpha * 100)}%"] += 1
        if node.get("type") == "TEXT" and (style := node.get("style")):
            line = style.get("lineHeightPx")
            texts[f"{style.get('fontFamily')} {style.get('fontSize')}px "
                  f"weight {style.get('fontWeight')}" + (f" / {round(line)}px" if line else "")] += 1
        if isinstance(node.get("cornerRadius"), (int, float)):
            radii[f"{node['cornerRadius']}px"] += 1
        for child in node.get("children", []) or []:
            walk(child)

    walk(document.get("document", {}))
    return {
        "name": document.get("name"),
        "named_styles": {sid: {"name": s.get("name"), "type": s.get("styleType")}
                         for sid, s in (document.get("styles") or {}).items()},
        "colors": dict(colors.most_common(40)),
        "text_styles": dict(texts.most_common(30)),
        "radii": dict(radii.most_common(12)),
    }
