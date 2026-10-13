"""Element comments, stored as a JSON list in data/<slug>/comments.json.

Two processes write this file: the web server (user adds or deletes) and the preview MCP
server (agent resolves). Every read-modify-write holds an exclusive flock.
"""

import fcntl
import json
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        items = json.loads(path.read_text()) if path.exists() else []
        yield items
        path.write_text(json.dumps(items, indent=2))


def list_all(path: Path) -> list[dict]:
    with _locked(path) as items:
        return list(items)


def open_comments(path: Path) -> list[dict]:
    return [c for c in list_all(path) if c["status"] == "open"]


def add(path: Path, selector: str, tag: str, element_text: str, note: str, page: str = "") -> dict:
    """`page`: the HTML page the element is on; "" for the entry page."""
    comment = {"id": uuid.uuid4().hex[:6], "selector": selector, "tag": tag, "page": page,
               "element_text": element_text[:120], "note": note.strip(),
               "status": "open", "created": time.time(), "resolution": None}
    with _locked(path) as items:
        items.append(comment)
    return comment


def resolve(path: Path, comment_id: str, resolution: str) -> dict | None:
    with _locked(path) as items:
        for comment in items:
            if comment["id"] == comment_id:
                comment.update(status="resolved", resolution=resolution.strip())
                return dict(comment)
    return None


def delete(path: Path, comment_id: str) -> bool:
    with _locked(path) as items:
        before = len(items)
        items[:] = [c for c in items if c["id"] != comment_id]
        return len(items) < before


def prompt_block(comments: list[dict]) -> str:
    """How open comments are shown to the agent, appended to the user's message."""
    lines = ["Open comments the user pinned to elements of the design. Address each one, then "
             "call resolve_comment with its comment_id and a one-line summary of what you changed:"]
    for c in comments:
        text = f' "{c["element_text"]}"' if c["element_text"] else ""
        page = f' in {c["page"]}' if c.get("page") else ""
        lines.append(f'- [{c["id"]}] on `{c["selector"]}`{page} (<{c["tag"]}>{text}): {c["note"]}')
    return "\n".join(lines)
