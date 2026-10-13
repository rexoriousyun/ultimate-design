"""MCP server that links Claude Code sessions to Ultimate Design (the Claude Design
"/design" and "/design-sync" idea): create and change designs from the terminal, read
their files for implementation, and build a design system from the codebase you're in.

It talks to the running app over HTTP (PM_URL, default http://127.0.0.1:8765), so
everything it does shows up in the studio and the other way round, and starts the app when
it isn't running (PM_AUTOSTART=0 turns that off). It ships as the Claude Code plugin in
plugin/ (docs/claude-code.md). The user confirms a design in the studio, not in the terminal:
"Approve for build" there is what wait_for_approval and get_handoff look for.

Tools block while a turn runs (up to `wait_seconds`); a turn keeps running on the server
after that, and wait_for_turn picks it up. See docs/claude-code.md.
"""

import asyncio
import json
import os
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app import workspace

BASE = os.environ.get("PM_URL", "http://127.0.0.1:8765").rstrip("/")
REPO = Path(__file__).resolve().parent.parent
DEFAULT_WAIT = 600
START_WAIT = 30
APPROVAL_POLL = 2

server = MCPServer("ultimate-design")


class AppError(ToolError):
    """A failure Claude Code should see the reason for. (mcp 2.x shows only "Error
    executing tool <name>" for other exceptions.)"""


_started = False


def _start_app() -> bool:
    """Start the studio in the background (once per MCP process) and wait until it answers.
    Only for a local PM_URL; PM_APP_CMD replaces the command (tests)."""
    global _started
    url = urllib.parse.urlparse(BASE)
    if _started or os.environ.get("PM_AUTOSTART") == "0" or url.hostname not in ("127.0.0.1", "localhost"):
        return False
    _started = True
    cmd = shlex.split(os.environ.get("PM_APP_CMD", "")) or [
        "uv", "run", "--directory", str(REPO), "uvicorn", "app.server:app", "--port", str(url.port or 80)]
    log = Path(os.environ.get("PM_APP_LOG", workspace.DIR / "data" / "studio.log"))
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as out:
        subprocess.Popen(cmd, cwd=REPO, stdout=out, stderr=out, stdin=subprocess.DEVNULL,
                         start_new_session=True)  # outlives this MCP process, like the studio should
    deadline = time.time() + START_WAIT
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BASE + "/api/projects", timeout=2).close()
            return True
        except OSError:
            time.sleep(0.5)
    return False


def _request(method: str, path: str, body: dict | None = None, timeout: float = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        try:
            detail = json.load(err).get("detail", err.reason)
        except ValueError:
            detail = err.reason
        raise AppError(f"{method} {path}: {detail}") from err
    except OSError as err:
        if not isinstance(err, TimeoutError) and _start_app():
            return _request(method, path, body, timeout)
        raise AppError(f"Ultimate Design is not reachable at {BASE}. Start it with "
                       f"`uv run uvicorn app.server:app --port 8765` in {REPO}.") from err


def _json(method: str, path: str, body: dict | None = None):
    with _request(method, path, body) as res:
        return json.load(res)


def _link(slug: str) -> None:
    """Tell the studio that Claude Code is working on this project."""
    _json("POST", f"/api/projects/{slug}/link")


def _studio_url(slug: str) -> str:
    return f"{BASE}/#/p/{slug}"


def _resolve(project: str) -> dict:
    """A project by slug or (case-insensitive) name."""
    projects = _json("GET", "/api/projects")
    for p in projects:
        if project in (p["slug"],) or project.lower() == p["name"].lower():
            return p
    names = ", ".join(p["name"] for p in projects) or "none yet"
    raise AppError(f"No project called {project!r}. Projects: {names}")


def _follow(res, deadline: float) -> dict:
    """Read a turn's event stream until it ends or the deadline passes."""
    texts, steps, notes, errors, questions = [], [], [], [], []
    version, done = None, None
    for raw in res:
        line = raw.decode().strip()
        if line.startswith("data: "):
            event = json.loads(line[6:])
            kind = event["type"]
            if kind == "text":
                texts.append(event["text"])
            elif kind == "tool":
                steps.append(event["summary"])
            elif kind == "note":
                notes.append(event["text"])
            elif kind == "error":
                errors.append(event["message"])
            elif kind == "version":
                version = event["sha"]
            elif kind == "questions":
                questions = event["questions"]
            elif kind == "done":
                done = event
        if time.time() > deadline:
            return {"finished": False, "texts": texts, "steps": steps}
    return {"finished": True, "texts": texts, "steps": steps, "notes": notes, "errors": errors,
            "questions": questions,
            "version": version, "failed": bool(done and done["is_error"]) or bool(errors and not done)}


def _folder(slug: str) -> Path:
    """The design's folder, as the app reports it (never assumed from this repo's layout)."""
    return Path(_json("GET", f"/api/projects/{slug}")["folder"])


def _turn_report(slug: str, result: dict) -> str:
    if not result["finished"]:
        return (f"The turn is still running in Ultimate Design ({len(result['steps'])} steps so far). "
                f"Call wait_for_turn with project={slug!r} to keep following it, or open "
                f"{_studio_url(slug)}.")
    lines = [("The turn failed." if result["failed"] else "Done.")
             + f" {len(result['steps'])} steps" + (f", new version {result['version'][:8]}" if result["version"] else "")
             + f". Studio: {_studio_url(slug)}"]
    if result["errors"]:
        lines.append("Errors: " + "; ".join(result["errors"]))
    if result["texts"]:
        lines.append("Agent's reply:\n" + result["texts"][-1])
    if result["questions"]:
        asked = [f"{i}. {q['text']}" + (f" (options: {', '.join(q['options'])})" if q.get("options") else "")
                 for i, q in enumerate(result["questions"], 1)]
        lines.append("The design agent asked before building. Answer with send_message (or say "
                     "\"just build it\"):\n" + "\n".join(asked))
    lines.append(f"Design files: {_folder(slug)}")
    return "\n\n".join(lines)


def _approval(p: dict) -> str:
    """Whether the user approved the design's current version for building, in the studio."""
    latest = p["versions"][-1]["sha"] if p["versions"] else None
    a = p.get("approved")
    if a and a["sha"] == latest:
        return ("Approved for build by the user in the studio (current version "
                f"{latest[:8]}{', their reason: ' + repr(a['why']) if a.get('why') else ''}).")
    if a:
        return (f"NOT APPROVED: the user approved version {a['sha'][:8]}, but the design changed since. "
                f"Ask them to review it and press \"Approve for build\" at {_studio_url(p['slug'])}, "
                "or call wait_for_approval.")
    return ("NOT APPROVED: the user has not approved this design yet. They review it and press "
            f"\"Approve for build\" in the studio at {_studio_url(p['slug'])}. Don't implement it "
            "before that: call wait_for_approval.")


def _send(slug: str, message: str, wait_seconds: int) -> str:
    deadline = time.time() + wait_seconds
    with _request("POST", f"/api/projects/{slug}/chat", {"message": message},
                  timeout=wait_seconds + 60) as res:
        return _turn_report(slug, _follow(res, deadline))


@server.tool()
async def list_designs() -> str:
    """List Ultimate Design projects: designs and design systems, newest first."""
    projects = await asyncio.to_thread(_json, "GET", "/api/projects")
    if not projects:
        return "No projects yet."
    return "\n".join(
        f"- {p['name']} (slug {p['slug']}, {p['kind']}, "
        f"{'Claude (default model)' if not p['model'] else ('local model ' + p['model']) if p['model'].startswith('ollama:') else p['model']}"
        f"{', design system ' + p['design_system'] if p.get('design_system') else ''}) "
        f"{_studio_url(p['slug'])}" for p in projects)


@server.tool()
async def create_design(name: str, prompt: str = "", design_system: str = "",
                        wait_seconds: int = DEFAULT_WAIT) -> str:
    """Create a design project. With `prompt`, the design agent builds it right away and
    this waits for the result. `design_system`: a design-system project's name or slug to
    build with (create one with sync_design_system); left empty, the design gets the
    default design system if the user set one."""
    def run():
        meta = _json("POST", "/api/projects", {"name": name})
        _link(meta["slug"])
        if design_system:
            ds = _resolve(design_system)
            _json("PUT", f"/api/projects/{meta['slug']}/design-system", {"design_system": ds["slug"]})
        if not prompt:
            return f"Created {meta['name']} (slug {meta['slug']}): {_studio_url(meta['slug'])}"
        return f"Created {meta['name']} (slug {meta['slug']}).\n\n" + _send(meta["slug"], prompt, wait_seconds)
    return await asyncio.to_thread(run)


@server.tool()
async def send_message(project: str, message: str, wait_seconds: int = DEFAULT_WAIT) -> str:
    """Ask the design agent for a change to a project (name or slug), as if typed in the
    studio chat, and wait for the result."""
    def run():
        slug = _resolve(project)["slug"]
        _link(slug)
        return _send(slug, message, wait_seconds)
    return await asyncio.to_thread(run)


@server.tool()
async def wait_for_turn(project: str, wait_seconds: int = DEFAULT_WAIT) -> str:
    """Keep following a turn that was still running when send_message returned."""
    def run():
        p = _json("GET", f"/api/projects/{_resolve(project)['slug']}")
        if not p["running"]:
            texts = [e["text"] for e in p["chat"] if e["type"] == "text"]
            return "No turn is running. Last reply:\n" + (texts[-1] if texts else "(none)")
        with _request("GET", f"/api/projects/{p['slug']}/turn?since={p['turn_events']}",
                      timeout=wait_seconds + 60) as res:
            return _turn_report(p["slug"], _follow(res, time.time() + wait_seconds))
    return await asyncio.to_thread(run)


@server.tool()
async def get_design(project: str) -> list:
    """A project's design files (absolute paths you can read directly), its latest
    version, and a thumbnail of how it looks."""
    def run():
        p = _json("GET", f"/api/projects/{_resolve(project)['slug']}")
        _link(p["slug"])
        folder = Path(p["folder"])
        versions = p["versions"]
        text = "\n".join([
            f"{p['name']} ({p['kind']}), entry page {folder / p['entry']}",
            f"Studio: {_studio_url(p['slug'])}",
            f"Versions: {len(versions)}" + (f", latest: {versions[-1]['message']}" if versions else ""),
            "Files:", *[f"- {folder / f}" for f in p["files"]]])
        try:
            with _request("GET", f"/api/projects/{p['slug']}/thumbnail") as res:
                return [text, Image(data=res.read(), format="png")]
        except AppError:
            return [text]
    return await asyncio.to_thread(run)


@server.tool()
async def get_handoff(project: str, write_notes: bool = False, wait_seconds: int = DEFAULT_WAIT) -> str:
    """Everything needed to implement a design in this codebase: HANDOFF.md (the agent's
    notes on screens, tokens, components and interactions) and the design's file paths.
    `write_notes`: ask the design agent to write or refresh HANDOFF.md first."""
    def run():
        slug = _resolve(project)["slug"]
        _link(slug)
        report = ""
        if write_notes:
            report = _send(slug, "Write handoff notes in HANDOFF.md.", wait_seconds) + "\n\n"
        p = _json("GET", f"/api/projects/{slug}")
        folder = Path(p["folder"])
        handoff = folder / "HANDOFF.md"
        notes = handoff.read_text() if handoff.exists() else "(No HANDOFF.md yet: call again with write_notes=true.)"
        files = sorted(str(f) for f in folder.rglob("*") if f.is_file())
        return report + _approval(p) + f"\n\nDesign folder: {folder}\nFiles:\n" \
            + "\n".join(f"- {f}" for f in files) + f"\n\nHANDOFF.md:\n{notes}"
    return await asyncio.to_thread(run)


@server.tool()
async def wait_for_approval(project: str, wait_seconds: int = DEFAULT_WAIT) -> str:
    """Wait until the user approves the design's current version in the studio ("Approve for
    build" on its version bar). The user confirms a design there, not in the terminal: call
    this after a design is built and before implementing it, and tell the user the studio link
    while you wait. Returns their approval (with their reason, if they gave one) or, at
    `wait_seconds`, that it is still waiting."""
    def run():
        slug = _resolve(project)["slug"]
        _link(slug)
        deadline = time.time() + wait_seconds
        while True:
            p = _json("GET", f"/api/projects/{slug}")
            status = _approval(p)
            if not status.startswith("NOT APPROVED") or time.time() >= deadline:
                break
            time.sleep(APPROVAL_POLL)
        if status.startswith("NOT APPROVED"):
            return f"Still waiting after {wait_seconds}s. {status}"
        return status + f"\nDesign files: {p['folder']}. Next: get_handoff(project={slug!r})."
    return await asyncio.to_thread(run)


@server.tool()
async def sync_design_system(source: str, name: str = "", wait_seconds: int = DEFAULT_WAIT) -> str:
    """Build a design system from a codebase (like /design-sync): `source` is an absolute
    folder or file path (e.g. the repo you are in), a GitHub URL or a Figma URL. The
    extraction agent reads it without changing it and writes tokens.css, README.md and a
    specimen page. Designs can then use it via create_design or use_design_system."""
    def run():
        label = name or Path(source.rstrip("/")).name or "Design system"
        meta = _json("POST", "/api/projects", {"name": label, "kind": "design-system", "source": source})
        _link(meta["slug"])
        report = _send(meta["slug"], "Extract the design system from the source.", wait_seconds)
        readme = _folder(meta["slug"]) / "README.md"
        return report + (f"\n\nREADME.md:\n{readme.read_text()}" if readme.exists() else "")
    return await asyncio.to_thread(run)


@server.tool()
async def use_design_system(project: str, design_system: str) -> str:
    """Attach a design system to a design (both by name or slug). The design agent applies
    it on the project's next message."""
    def run():
        slug = _resolve(project)["slug"]
        ds = _resolve(design_system)
        _link(slug)
        _json("PUT", f"/api/projects/{slug}/design-system", {"design_system": ds["slug"]})
        return (f"{ds['name']} is attached to {slug}. Send a message (e.g. \"Restyle the design with "
                "the design system.\") to apply it.")
    return await asyncio.to_thread(run)


if __name__ == "__main__":
    server.run("stdio")
