import asyncio
import hashlib
import json
import re
from contextlib import asynccontextmanager
import mimetypes
import time
import urllib.parse
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import (attachments, board, comments, compare, connectors, decisions, edits, export, palette, projects,
                 rulebook, sources, techniques, thumbnails, tweaks, workspace)
from app.engine import (ASK_TOOL, CLAUDE_MODELS, EMPTY_NUDGE, LIBRARY_DIR, RULES_NUDGE, VERIFY_NUDGE, ClaudeCodeEngine,
                        TurnOptions, accepts_images, is_empty_turn, is_local, local_models, needs_verification,
                        written_pages)
from app.preview import DESKTOP, Previewer, capture_page, serve_folder
from app.turns import Turn

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
EXTRACT_PROMPT = Path(__file__).resolve().parent / "prompts" / "extract.md"

@asynccontextmanager
async def lifespan(app):
    projects.seed_builtin()
    yield
    await thumbnails.close()


app = FastAPI(title="Ultimate Design", lifespan=lifespan)
engine = ClaudeCodeEngine()
turns: dict[str, Turn] = {}  # running turns by project slug


def busy(slug: str) -> bool:
    """A turn is running. Between an agent run and its nudge run no process exists, so
    the Turn is the source of truth; the engine check covers anything started outside it."""
    return slug in turns or engine.is_running(slug)


class NewProject(BaseModel):
    name: str
    kind: str = projects.DESIGN
    source: str | None = None
    model: str | None = None
    # A design system for a new design. Left out: the default design system, if one is set.
    design_system: str | None = None


class DesignSystemChoice(BaseModel):
    design_system: str | None


class Selected(BaseModel):
    selector: str
    tag: str
    text: str = ""
    count: int = 1


class ViewContext(BaseModel):
    """What the user sees when sending: the page on the canvas, its width, and the element
    selected in Edit mode, so the agent can resolve "this" and "here". On the board,
    `view` is "board" and `page` is the selected frame's page, if any."""
    view: str = "page"
    page: str = ""
    width: int | None = None
    selected: Selected | None = None


class Answer(BaseModel):
    """One answered ask_questions question, as the studio's form had it."""
    question: str
    options: list[str] = []
    chose: list[str] = []  # the options ticked
    other: str = ""        # the free-text field, in the user's words
    topic: str | None = None
    rule: str | None = None


class ChatMessage(BaseModel):
    message: str
    context: ViewContext | None = None
    # Which open comments go with this message; None sends them all (the default).
    comment_ids: list[str] | None = None
    answers: list[Answer] | None = None  # set when the message answers the agent's questions
    plan: list[str] | None = None  # set when the message approves the agent's plan (its steps, as edited)


class PlanFirst(BaseModel):
    on: bool


PLAN_NOTE = ("(Plan first is on: before you write or edit any file, call `propose_plan` with a "
             "one-line summary and three to eight concrete steps, then end your turn. If this "
             "message only asks a question, answer it instead.)")


class Reference(BaseModel):
    source: str


class ModelChoice(BaseModel):
    model: str | None  # None: the default Claude model


class Branch(BaseModel):
    sha: str
    name: str | None = None


class Connector(BaseModel):
    config: dict


class ConnectorChoice(BaseModel):
    names: list[str]


class Restore(BaseModel):
    sha: str


class DecisionWhy(BaseModel):
    ids: list[str]
    why: str


class Approval(BaseModel):
    why: str = ""  # the user's words, optional


class ProposalAnswer(BaseModel):
    why: str = ""       # The user's reason, in their words; required to confirm
    rule_id: str = ""   # a new rule's id, title and category (from the rulebook's categories)
    title: str = ""
    category: str = ""


class Dismissal(BaseModel):
    rule: str
    page: str = ""
    why: str = ""


class NewComment(BaseModel):
    selector: str
    tag: str
    element_text: str = ""
    note: str
    page: str = ""  # the page the element is on; "" means the entry page


class KeepTweaks(BaseModel):
    values: dict
    page: str = ""  # the page whose tweaks block to update; "" means the entry page


class Capture(BaseModel):
    url: str


class Sketch(BaseModel):
    page: str
    width: int
    height: int
    scroll_y: int = 0
    overlay: str  # data:image/png;base64,... of the strokes, the canvas's size


class TextEdit(BaseModel):
    selector: str
    before: str
    after: str
    page: str = ""  # the page it was edited on; "" means the entry page


class DirectEdits(BaseModel):
    styles: dict[str, dict[str, dict[str, str]]] = {}  # {page: {selector: {prop: value}}}
    texts: list[TextEdit] = []
    # The computed value each style property had before Edit mode first changed it, in the
    # same shape as `styles`; for the decision log's `from`.
    before: dict[str, dict[str, dict[str, str]]] = {}


# The canvas iframe is sandboxed without same-origin, so it needs CORS to fetch its own files.
FILE_HEADERS = {"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"}
def asset_url(name: str) -> str:
    """/static/<name>?v=<hash of its content>: a changed file gets a new URL, so a browser never
    pairs a new page with an old stylesheet or script it kept (found 2026-10-08: after the
    redesign the user's browser showed the new markup with the old CSS)."""
    digest = hashlib.sha1((STATIC_DIR / name).read_bytes()).hexdigest()[:10]
    return f"/static/{name}?v={digest}"


def bridge_tag() -> str:
    return f'<script src="{asset_url("canvas-bridge.js")}"></script>'


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def with_bridge(content: bytes) -> bytes:
    """Add the canvas bridge script just before </body> (or at the end)."""
    html = content.decode("utf-8", errors="replace")
    i = html.lower().rfind("</body>")
    tag = bridge_tag()
    html = html[:i] + tag + html[i:] if i >= 0 else html + tag
    return html.encode()


def design_response(content: bytes, path: str, bridge: bool = False) -> Response:
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if bridge and media_type == "text/html":
        content = with_bridge(content)
    return Response(content, media_type=media_type, headers=FILE_HEADERS)


def is_page(path: str) -> bool:
    return path.lower().endswith((".html", ".htm"))


def turn_options(meta: dict) -> TurnOptions:
    """The project's model; design systems also get the extraction prompt and read-only
    access to their source."""
    data = projects.data_dir(meta["slug"])
    options = TurnOptions(mcp_env={"PM_COMMENTS_FILE": str(projects.comments_path(meta["slug"])),
                                   # log_decision: where to write, and what the user wrote this turn
                                   "PM_DECISIONS_FILE": str(decisions.path(data)),
                                   "PM_CHAT_FILE": str(data / "chat.jsonl"),
                                   "PM_PROJECT_SLUG": meta["slug"],
                                   "PM_DECISION_CONTEXT": json.dumps(decision_context(meta)),
                                   # verify: design-guide's rulebook, exported as the turn starts
                                   "PM_RULEBOOK_FILE": str(rulebook.path(data))},
                          model=meta["model"], connectors=connectors.for_project(meta))
    if not accepts_images(meta["model"]):
        options.mcp_env["PM_NO_IMAGES"] = "1"
    if meta["kind"] == projects.DESIGN:  # a specimen page has no hierarchy of its own
        options.mcp_env["PM_HIERARCHY"] = "1"
        options.read_only_dirs.append(LIBRARY_DIR)
        if workspace.guides():  # the workspace's written guides, named in each message (workspace.guides_note)
            options.read_only_dirs.append(workspace.DIR / workspace.GUIDES)
    for ref in meta["references"]:
        folder = Path(ref["dir"])
        options.read_only_dirs.append(folder if folder.is_dir() else folder.parent)
    if attachments.folder(projects.data_dir(meta["slug"])).is_dir():
        options.read_only_dirs.append(attachments.folder(projects.data_dir(meta["slug"])))
    if meta["kind"] == projects.DESIGN_SYSTEM:
        options.system_prompt = EXTRACT_PROMPT.read_text().replace("{source}", describe_source(meta))
        if meta["source_dir"] or meta["source"]:
            source = Path(meta["source_dir"] or meta["source"])
            options.read_only_dirs.insert(0, source if source.is_dir() else source.parent)
    return options


def decision_context(meta: dict, page: str | None = None) -> dict:
    """What was true when the user decided (docs/decision-log.schema.json, `context`)."""
    path = projects.resolve_file(meta["slug"], page or meta["entry"])
    html = path.read_text(errors="replace") if path and path.is_file() else ""
    return {"kind": meta["kind"], "design_system": meta["design_system"],
            "palette": palette.meta_content(html), "version": projects.latest_version(meta["slug"]),
            "rulebook": (current_rulebook(meta) or {}).get("version")}


def current_rulebook(meta: dict) -> dict | None:
    """The rulebook exported at the start of the project's last turn, or None."""
    return rulebook.load(rulebook.path(projects.data_dir(meta["slug"])))


TOKEN_MEASURES = ("token-only", "design-system", "palette")  # the rules about which value is allowed


def rule_for_property(meta: dict, prop: str, page: str | None = None) -> str | None:
    """The rule an Edit-mode change of `prop` touches, from the project's own rulebook (gate
    section 3). It is the project-scoped export, so rules withheld for this project are not in it:
    with design-system/ its one token rule is design-system-conformance, without one
    no-raw-design-values, and a palette page also has palette-conformance. Floor rules are left
    out: choosing a colour is a taste decision even though contrast also reads colour, and a
    floor-marked record would drop out of the pass. When several rules read the property:
    1. on a page with <meta name="palette">, palette-conformance;
    2. for a colour, background, border or font family, a token rule over hierarchy (a colour edit
       chooses which colour, not its rank; hierarchy keeps font-size and font-weight);
    3. a confirmed rule over a proposed one, then the lowest id, so the export's order never
       decides (agreed with design-guide, 2026-10-08)."""
    book = current_rulebook(meta) or {}
    matches = [r for r in book.get("rules", [])
               if r.get("layer") != "floor" and any(prop == p or prop.startswith(p + "-")
                                                    for p in r["check"].get("properties", []))]
    path = projects.resolve_file(meta["slug"], page or meta["entry"])
    on_palette = bool(path and path.is_file() and palette.meta_content(path.read_text(errors="replace")))
    about_value = prop.startswith(("color", "background", "border")) or prop == "font-family"
    matches.sort(key=lambda r: (
        not (on_palette and r["check"].get("measure") == "palette"),
        not (about_value and r["check"].get("measure") in TOKEN_MEASURES),
        r.get("status") != "confirmed", r["id"]))
    return matches[0]["id"] if matches else None


def log_answers(meta: dict, answers: list[Answer]) -> None:
    """A pick for each answered question that offered options (section 9). The free-text
    field is the reason when options were also ticked, and the choice when none were."""
    file = decisions.path(projects.data_dir(meta["slug"]))
    context = decision_context(meta)
    for a in answers:
        other = a.other.strip()
        if not a.options or not (a.chose or other):
            continue  # nothing to choose between, or no preference: silence is not a pick
        chose = [c for c in a.chose if c in a.options]
        if chose:
            over, why = [o for o in a.options if o not in chose], other or None
            picked = chose[0] if len(chose) == 1 else chose
        else:
            picked, over, why = other, list(a.options), None
        decisions.append(file, project=meta["slug"], kind="pick",
                         topic=a.topic if a.topic in decisions.TOPICS else "other",
                         subject={"page": None, "question": a.question}, chose=picked, over=over,
                         why=why, why_source="answer", rule=a.rule, context=context)


def describe_source(meta: dict) -> str:
    """The extraction prompt's source line: a local path, or where a remote one was fetched."""
    where = meta["source_dir"]
    if not meta["source"]:
        return "the files attached to the user's messages (logos, documents, screenshots, code)"
    match sources.kind(meta["source"]):
        case "github":
            return f"the GitHub repository {meta['source']}, cloned read-only at {where}"
        case "figma":
            return (f"the Figma file {meta['source']}, exported read-only to {where}: "
                    "figma-summary.json (colours, text styles and radii by use count), "
                    "figma-file.json (the full document) and frames/*.png (renders of its frames)")
        case _:
            return meta["source"]


WIDTH_NAMES = {1440: "desktop", 834: "tablet", 390: "mobile"}


def _clean(text: str, limit: int) -> str:
    """User-side text going into the prompt: one line, no backticks, capped."""
    return " ".join(text.replace("`", "'").split())[:limit]


def describe_view(context: ViewContext | None, entry: str = "index.html") -> str | None:
    """One line telling the agent what the user is looking at, or None if nothing useful.
    The page and width are mentioned only when they differ from the entry page at desktop
    width, so an ordinary message carries no extra line."""
    if context is None:
        return None
    page = context.page if context.page and ".." not in context.page and not context.page.startswith("/") else ""
    parts = []
    if context.view == "board":
        frame = (f' They selected the frame for {_clean(page, 200)}'
                 f'{f" at {context.width}px" if context.width else ""}; "this" most likely means that frame.'
                 if page else "")
        return f"(Studio context: The user is on the board, seeing all frames side by side.{frame})"
    if (page and page != entry) or (context.width and context.width != 1440):
        where = _clean(page, 200) or "the page"
        width = f" at {context.width}px ({WIDTH_NAMES.get(context.width, 'custom')})" if context.width else ""
        parts.append(f"The user is looking at {where}{width}.")
    if context.selected:
        sel = context.selected
        text = f' "{_clean(sel.text, 80)}"' if sel.text.strip() else ""
        others = f", with {sel.count - 1} more element(s)" if sel.count > 1 else ""
        parts.append(f"In Edit mode they have selected <{_clean(sel.tag, 20)}>{text} "
                     f"(`{_clean(sel.selector, 300)}`){others}; \"this\" most likely means that element.")
    return f"(Studio context: {' '.join(parts)})" if parts else None


def describe_references(meta: dict) -> str | None:
    """The reference folders the user connected, restated every turn so a new session knows them."""
    if not meta["references"]:
        return None
    items = []
    for ref in meta["references"]:
        kind = sources.kind(ref["source"])
        items.append(ref["dir"] if kind == "path" else f"{ref['dir']} ({kind} {ref['source']})")
    return ("(Reference material the user connected, read-only: " + "; ".join(items)
            + ". Read what bears on this request before designing, and build from it.)")


def build_prompt(message: str, note: str | None, open_comments: list[dict],
                 files: list[dict] | None = None, images_ok: bool = True,
                 view: str | None = None, references: str | None = None) -> str:
    """What the agent receives: app notes, reference folders, what the user is looking at,
    the user's message, open comments, attachments."""
    parts = [note] if note else []
    parts += [line for line in (references, view) if line]
    parts.append(message or ("Please address the open comments." if open_comments
                             else "Please use the attached files."))
    if open_comments:
        parts.append(comments.prompt_block(open_comments))
    if files:
        parts.append(attachments.prompt_block(files, images_ok))
    return "\n\n".join(parts)


def usage_total(chat: list[dict]) -> dict:
    """The project's running totals from its finished turns: API-equivalent cost and tokens.
    Turns of a local model are left out: the CLI prices them as if they were Claude."""
    total = {"turns": 0, "cost_usd": 0.0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    for event in chat:
        if event.get("type") != "done" or event.get("local"):
            continue
        total["turns"] += 1
        total["cost_usd"] += event.get("cost_usd") or 0
        for key, value in (event.get("tokens") or {}).items():
            total[key] = total.get(key, 0) + value
    return total


def _require(slug: str) -> dict:
    if not projects.exists(slug):
        raise HTTPException(404, "No such project")
    return projects.get(slug)


def _require_writable(slug: str) -> dict:
    """A built-in design system changes in the workspace folder, never in the studio."""
    meta = _require(slug)
    if meta["builtin"]:
        raise HTTPException(403, f"{meta['name']} is built in: change design-systems/{meta['builtin']}/ "
                                 "in the workspace, or duplicate it to change it here")
    return meta


@app.get("/")
def index():
    """The studio page, its stylesheets and scripts versioned by content (`asset_url`), and the
    page itself never cached, so a change always reaches the browser."""
    html = (STATIC_DIR / "index.html").read_text()
    html = re.sub(r'"/static/([\w.-]+\.(?:css|js))"', lambda m: f'"{asset_url(m.group(1))}"', html)
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/api/techniques")
def list_techniques():
    """The technique library's web recipes, for the studio's Techniques browser and Library."""
    return techniques.all_techniques()


@app.get("/library/demo/{technique_id}")
def technique_demo(technique_id: str):
    """One recipe's own demo, live, for the technique detail view."""
    page = techniques.demo_html(technique_id)
    if page is None:
        raise HTTPException(404, "No such technique")
    return Response(page, media_type="text/html")


@app.get("/api/palettes/wada")
def wada_palettes():
    """Sanzo Wada's 348 colour combinations by number, each a list of {name, hex}."""
    return palette.all_combinations()


@app.get("/api/models")
def list_models():
    """The default Claude model, the Claude models a project can switch to, and any local
    Ollama models."""
    return {"default": engine.model, "claude": CLAUDE_MODELS, "local": local_models()}


def valid_model(model: str | None) -> bool:
    return model is None or model in CLAUDE_MODELS or model in local_models()


@app.get("/api/projects")
def list_projects():
    """All projects, newest first; `version` is the latest version's sha, which the Home
    page uses to cache-bust thumbnails: "live" for a project with a page but no versions
    (made before version history), null when there is no page (also when versions exist
    without one, e.g. a new design whose only version attached the default system)."""
    def version(m: dict) -> str | None:
        if not (projects.design_dir(m["slug"]) / m["entry"]).is_file():
            return None
        return projects.latest_version(m["slug"]) or "live"
    return [{**m, "version": version(m), **card_state(m)} for m in projects.list_all()]


def card_state(m: dict) -> dict:
    """What a Home card shows besides the name: the entry page's Wada palette, and the findings
    of design-guide's last check (`{count, blocking}`, null when it never ran)."""
    entry = projects.design_dir(m["slug"]) / m["entry"]
    html = entry.read_text(errors="replace") if entry.is_file() else ""
    last = next((e for e in reversed(projects.read_chat(m["slug"])) if e.get("type") == "findings"), None)
    findings = None if last is None else {
        "count": len(last["findings"]), "blocking": sum(1 for f in last["findings"] if f.get("blocking"))}
    return {"palette": palette.meta_content(html), "findings": findings}


@app.get("/api/projects/{slug}/thumbnail")
async def project_thumbnail(slug: str):
    """A small PNG of the latest version's entry page, for the Home card."""
    _require(slug)
    png = await thumbnails.thumbnail(slug, cache=not busy(slug))
    if png is None:
        raise HTTPException(404, "No design yet")
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/projects/{slug}/versions/{sha}/thumbnail")
async def version_thumbnail(slug: str, sha: str):
    """A small PNG of one version's entry page, for the studio's History."""
    _require(slug)
    if sha not in {v["sha"] for v in projects.list_versions(slug)}:
        raise HTTPException(404, "No such version")
    png = await thumbnails.version_thumbnail(slug, sha)
    if png is None:
        raise HTTPException(404, "No page in that version")
    return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=31536000, immutable"})


def _version(slug: str, sha: str) -> None:
    if sha not in {v["sha"] for v in projects.list_versions(slug)}:
        raise HTTPException(404, "No such version")


def _compare_args(page: str, width: int) -> None:
    if ".." in page.split("/") or page.startswith("/") or not page.endswith((".html", ".htm")):
        raise HTTPException(400, "Not a page")
    if not 320 <= width <= 2560:
        raise HTTPException(400, "Width out of range")


@app.get("/api/projects/{slug}/versions/{sha}/shot")
async def version_shot(slug: str, sha: str, page: str = "index.html", width: int = 1440):
    """One page of one version, whole, at one width: a side of the Compare view."""
    _require(slug)
    _version(slug, sha)
    _compare_args(page, width)
    png = await compare.shot(slug, sha, page, width)
    if png is None:
        raise HTTPException(404, "No such page in that version")
    return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=31536000, immutable"})


@app.get("/api/projects/{slug}/compare")
async def compare_versions(slug: str, a: str, b: str, page: str = "index.html", width: int = 1440):
    """What changed on a page from version a to version b (app/compare.py)."""
    _require(slug)
    _version(slug, a)
    _version(slug, b)
    _compare_args(page, width)
    return await compare.compare(slug, a, b, page, width)


@app.post("/api/projects")
def create_project(body: NewProject):
    if not valid_model(body.model):
        raise HTTPException(400, "Unknown model; choose a Claude model or a model Ollama has pulled")
    if body.kind == projects.DESIGN:
        ds = (body.design_system if "design_system" in body.model_fields_set
              else projects.settings()["default_design_system"])
        if ds is not None and (not projects.exists(ds) or projects.get(ds)["kind"] != projects.DESIGN_SYSTEM):
            raise HTTPException(400, "No such design system")
        meta = projects.create(body.name, model=body.model)
        if ds:
            projects.set_design_system(meta["slug"], ds)
            meta = projects.get(meta["slug"])
        return meta
    if body.kind != projects.DESIGN_SYSTEM:
        raise HTTPException(400, "Unknown kind")
    raw = (body.source or "").strip()
    if not raw:  # built from files the user attaches to the first message
        return projects.create(body.name, projects.DESIGN_SYSTEM, None, body.model)
    if sources.kind(raw) != "path":
        meta = projects.create(body.name, projects.DESIGN_SYSTEM, raw, body.model)
        try:
            folder = sources.fetch(raw, projects.fetched_source_dir(meta["slug"]))
        except sources.SourceError as err:
            projects.delete(meta["slug"])
            raise HTTPException(400, str(err))
        return projects.touch(meta["slug"], source_dir=str(folder))
    source = Path(raw).expanduser()
    if not raw or not source.is_absolute() or not source.exists():
        raise HTTPException(400, "Source must be an existing absolute path, a GitHub URL or a Figma URL "
                                 "(or leave it empty and attach files)")
    return projects.create(body.name, projects.DESIGN_SYSTEM, str(source.resolve()), body.model)


@app.post("/api/projects/{slug}/source/refresh")
def refresh_source(slug: str):
    """Fetch a GitHub or Figma source again, e.g. before re-extracting after changes."""
    meta = _require(slug)
    if meta["kind"] != projects.DESIGN_SYSTEM or sources.kind(meta["source"] or "") == "path":
        raise HTTPException(400, "Only GitHub and Figma sources can be refreshed")
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    try:
        folder = sources.fetch(meta["source"], projects.fetched_source_dir(slug))
    except sources.SourceError as err:
        raise HTTPException(400, str(err))
    projects.add_note(slug, "the source was fetched again; it may have changed since you last read it.")
    return projects.touch(slug, source_dir=str(folder))


@app.get("/api/projects/{slug}")
def get_project(slug: str):
    meta = _require(slug)
    # Count the running turn's events before reading the chat log: an event that lands in
    # between is then shown twice at worst, never skipped, when the page reattaches.
    turn_events = len(turns[slug].events) if slug in turns else 0
    chat = projects.read_chat(slug)
    return {**meta, "chat": chat, "usage": usage_total(chat), "files": projects.list_files(slug),
            "folder": str(projects.design_dir(slug).resolve()),
            "versions": projects.list_versions(slug), "running": busy(slug),
            "turn_events": turn_events,
            "comments": comments.open_comments(projects.comments_path(slug)),
            "attachments": attachments.pending(projects.data_dir(slug))}


@app.post("/api/projects/{slug}/duplicate")
def duplicate_project(slug: str):
    _require(slug)
    return projects.duplicate(slug)


@app.post("/api/projects/{slug}/branch")
def branch_project(slug: str, body: Branch):
    """A new project from the files of one version, to try another direction without
    losing this one."""
    meta = _require(slug)
    try:
        return projects.duplicate(slug, body.sha, (body.name or "").strip() or f"{meta['name']} (branch)")
    except KeyError:
        raise HTTPException(404, "No such version")


@app.post("/api/projects/{slug}/references")
def add_reference(slug: str, body: Reference):
    """Connect reference material to a design, read-only: an absolute local path (e.g. the
    product's codebase), a GitHub URL (cloned) or a Figma URL (exported)."""
    meta = _require(slug)
    if meta["kind"] != projects.DESIGN:
        raise HTTPException(400, "Only designs take reference folders")
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    raw = body.source.strip()
    if any(r["source"] == raw for r in meta["references"]):
        raise HTTPException(400, "Already connected")
    if sources.kind(raw) == "path":
        path = Path(raw).expanduser()
        if not path.is_absolute() or not path.exists():
            raise HTTPException(400, "Give an existing absolute path, a GitHub URL or a Figma URL")
        folder = path.resolve()
    else:
        try:
            folder = sources.fetch(raw, projects.reference_dir(slug, raw))
        except sources.SourceError as err:
            raise HTTPException(400, str(err))
    return projects.touch(slug, references=[*meta["references"], {"source": raw, "dir": str(folder)}])


@app.delete("/api/projects/{slug}/references")
def remove_reference(slug: str, source: str):
    meta = _require(slug)
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    if not any(r["source"] == source for r in meta["references"]):
        raise HTTPException(404, "No such reference")
    projects.drop_reference(slug, source)
    return projects.get(slug)


@app.put("/api/projects/{slug}/model")
def set_model(slug: str, body: ModelChoice):
    """Switch the project's model from the next message. Between Claude models the
    conversation continues; to or from a local model it can't (a different API), so the
    next turn starts a new session and the agent is told."""
    meta = _require(slug)
    if not valid_model(body.model):
        raise HTTPException(400, "Unknown model")
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    if body.model == meta["model"]:
        return meta
    if is_local(body.model) != is_local(meta["model"]) and meta["session_id"]:
        meta = projects.touch(slug, model=body.model, session_id=None)
        projects.add_note(slug, "the model was switched, so this is a new conversation: you don't "
                                "have the earlier chat. Read the project's files before changing anything.")
        return projects.get(slug)
    return projects.touch(slug, model=body.model)


@app.put("/api/projects/{slug}/plan-first")
def set_plan_first(slug: str, body: PlanFirst):
    """Ask the agent for a plan to approve before it builds, from the next message."""
    _require(slug)
    return projects.touch(slug, plan_first=body.on)


@app.put("/api/projects/{slug}/connectors")
def choose_connectors(slug: str, body: ConnectorChoice):
    """Turn connectors on for a project; they apply from its next turn."""
    _require(slug)
    known = connectors.load()
    unknown = [n for n in body.names if n not in known]
    if unknown:
        raise HTTPException(404, f"No such connector: {', '.join(unknown)}")
    return projects.touch(slug, connectors=list(dict.fromkeys(body.names)))


@app.get("/api/settings")
def get_settings():
    return projects.settings()


@app.get("/api/workspace")
def get_workspace():
    """The workspace in use (app/workspace.py): its name, its rule book and its guides."""
    current = workspace.settings()
    return {"name": current["name"], "rules": current["rules"],
            "guides": [p.relative_to(workspace.DIR / workspace.GUIDES).as_posix() for p in workspace.guides()]}


def _require_design_guide() -> None:
    if workspace.rules() != "design-guide":
        raise HTTPException(404, "Rule proposals come from design-guide; this workspace's rules are built in")


@app.put("/api/settings/default-design-system")
def set_default_design_system(body: DesignSystemChoice):
    """The design system every new design starts with (None: no default)."""
    try:
        return projects.set_default_design_system(body.design_system)
    except KeyError:
        raise HTTPException(404, "No such design system")


@app.get("/api/connectors")
def list_connectors():
    return [{"name": name, "target": connectors.describe(config)}
            for name, config in connectors.load().items()]


@app.put("/api/connectors/{name}")
def put_connector(name: str, body: Connector):
    try:
        return connectors.put(name, body.config)
    except connectors.ConnectorError as err:
        raise HTTPException(400, str(err))


@app.delete("/api/connectors/{name}")
def delete_connector(name: str):
    if not connectors.remove(name):
        raise HTTPException(404, "No such connector")
    return {"ok": True}


@app.delete("/api/projects/{slug}")
def delete_project(slug: str):
    _require_writable(slug)
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    projects.delete(slug)
    return {"ok": True}


@app.post("/api/projects/{slug}/chat")
async def chat(slug: str, body: ChatMessage):
    meta = _require_writable(slug)
    message = body.message.strip()
    open_comments = comments.open_comments(projects.comments_path(slug))
    if body.comment_ids is not None:  # the others stay open for a later message
        open_comments = [c for c in open_comments if c["id"] in body.comment_ids]
    files = attachments.pending(projects.data_dir(slug))
    if not message and not open_comments and not files:
        raise HTTPException(400, "Empty message")
    if busy(slug):
        raise HTTPException(409, "A turn is already running")

    files = attachments.mark_sent(projects.data_dir(slug))
    projects.append_chat(slug, {"type": "user", "text": message, "comments": open_comments,
                                "attachments": [{k: f[k] for k in ("id", "name", "kind", "source")}
                                                for f in files],
                                "context": body.context.model_dump() if body.context else None})
    # A new chat turn: Edit-mode changes from here on coalesce among themselves (section 13).
    projects.touch(slug, decisions_mark=len(decisions.read(decisions.path(projects.data_dir(slug)))))
    if body.answers:
        log_answers(meta, body.answers)
    projects.sync_design_system(slug)
    meta = projects.get(slug)  # the sync may have queued a note
    # Deletes announced in this turn's note; their rules are dropped once the turn completes.
    deletes = meta["pending_deletes"] if meta["pending_note"] else []
    prompt = build_prompt(message, meta["pending_note"], open_comments, files,
                          accepts_images(meta["model"]), describe_view(body.context, meta["entry"]),
                          describe_references(meta))
    if meta["pending_note"]:
        projects.touch(slug, pending_note=None)
    if meta["plan_first"] and not body.plan:
        prompt = PLAN_NOTE + "\n\n" + prompt

    turn = turns[slug] = Turn()
    turn.task = asyncio.create_task(run_turn(slug, turn, meta, message, prompt, turn_options(meta), deletes))
    return follow_response(turn, 0)


async def run_turn(slug: str, turn: Turn, meta: dict, message: str, prompt: str,
                   options: TurnOptions, deletes: list[dict] | None = None) -> None:
    """One user message: the agent run plus at most one nudge run of each kind, then a
    version. Runs in the background so a closed tab doesn't stop it."""

    async def emit(event: dict, log: bool = True) -> None:
        if log:
            projects.append_chat(slug, event)
        await turn.publish(event)

    session_id = meta["session_id"] or str(uuid.uuid4())
    resume = meta["session_id"] is not None
    prompts, nudged, empty_nudged, ruled, committed = [prompt], False, False, False, False
    written = []
    try:
        # design-guide is the rule book: exported fresh for every turn (docs/gate-rulebook.md §1).
        book = await rulebook.export(projects.design_dir(slug), rulebook.path(projects.data_dir(slug)),
                                     projects.data_dir(slug))
        prompts[0] = rulebook.settled(book) + (workspace.guides_note() if meta["kind"] == projects.DESIGN else "") \
            + prompts[0]
        while prompts and not turn.stopped:
            events = []
            asked = {}  # ask_questions calls by tool id, shown once the tool accepts them
            planned = {}  # propose_plan calls by tool id, likewise
            async for event in engine.run(slug, projects.design_dir(slug), prompts.pop(0),
                                          session_id, resume, options):
                events.append(event)
                if event["type"] == "tool" and "questions" in event:
                    asked[event["id"]] = event.pop("questions")
                elif event["type"] == "tool" and "plan" in event:
                    planned[event["id"]] = event.pop("plan")
                elif event["type"] == "tool_result" and event["id"] in planned:
                    plan = planned.pop(event["id"])
                    if not event["is_error"]:
                        await emit(event)
                        await emit({"type": "plan", **plan})
                        continue
                elif event["type"] == "tool_result" and event["id"] in asked:
                    questions = asked.pop(event["id"])
                    if not event["is_error"]:
                        await emit(event)
                        await emit({"type": "questions", "questions": questions})
                        continue
                if event["type"] == "done":
                    # Only a completed turn guarantees the CLI saved the session.
                    session_id, resume = event["session_id"], True
                    projects.touch(slug, session_id=session_id)
                    if is_local(options.model):  # priced as if Claude; kept out of totals
                        event["local"] = True
                await emit(event)
            completed = events and events[-1]["type"] == "done" and not events[-1]["is_error"]
            # At most one nudge of each kind per user message, so a stuck agent can't loop.
            if not empty_nudged and is_empty_turn(events):
                empty_nudged = True
                await emit({"type": "note", "text": "The agent's reply was empty. Asking it to continue."})
                prompts.append(EMPTY_NUDGE)
            elif completed and not nudged and needs_verification(events):
                nudged = True
                await emit({"type": "note", "text": "The agent didn't check its changes. Asking it to verify."})
                prompts.append(VERIFY_NUDGE)
            written += [p for p in written_pages(events, meta["entry"]) if p not in written]
            if completed and not prompts and not ruled and written and not turn.stopped:
                # Once per message, after the agent's last write: design-guide's gate (§4).
                ruled = True
                findings = await rules_pass(meta, written)
                if findings is not None:
                    await emit(findings)
                    blocking = [f for f in findings["findings"] if f.get("blocking")]
                    if blocking:
                        await emit({"type": "note", "text": "design-guide's rules found problems. Asking the agent to fix them."})
                        prompts.append(RULES_NUDGE + "\n" + "\n".join(
                            f"- {f['page']}: {f['rule']}: {f['title']}. {'; '.join(f['reasons'][:3])}"
                            + (f" Fix: {f['fix']}" if f.get("fix") else "") for f in blocking))
        if deletes and not turn.stopped:
            edits.drop_deletes(projects.design_dir(slug), meta["entry"], projects.data_dir(slug), deletes)
            done_now = {(d["page"], d["selector"]) for d in deletes}
            projects.touch(slug, pending_deletes=[d for d in projects.get(slug)["pending_deletes"]
                                                  if (d["page"], d["selector"]) not in done_now])
        committed = True
        sha = projects.commit_version(slug, message or "Addressed comments")
        if sha:
            await emit({"type": "version", "sha": sha}, log=False)
    finally:
        if not committed:  # stopped or crashed: keep whatever was written
            projects.commit_version(slug, message or "Addressed comments")
        projects.touch(slug)
        await turn.finish()
        if turns.get(slug) is turn:
            del turns[slug]


MAX_GATE_PAGES = 3


async def rules_pass(meta: dict, pages: list[str]) -> dict | None:
    """design-guide's gate on the pages a turn wrote: a `findings` event, or None when there is
    no usable rulebook (verify reports that itself) or the rulebook is the built-in one, whose
    measures `verify` already ran."""
    book = current_rulebook(meta)
    if not book or "error" in book or book.get("source") == "builtin":
        return None
    folder = projects.design_dir(meta["slug"])
    skip = rulebook.dismissed(decisions.path(projects.data_dir(meta["slug"])))
    server = serve_folder(folder)
    found, errors = [], []
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}/"
        for page in pages[:MAX_GATE_PAGES]:
            if not (folder / page).is_file():
                continue
            result = await rulebook.gate(base + urllib.parse.quote(page), folder)
            if "error" in result:
                errors.append(f"{page}: {result['error']}")
            else:
                found += rulebook.gate_findings(result, book, page, skip)
    finally:
        server.shutdown()
    return {"type": "findings", "rulebook": book.get("version"), "pages": pages[:MAX_GATE_PAGES],
            "findings": found, "errors": errors, "exceptions": rulebook.declared_exceptions(folder)}


def follow_response(turn: Turn, start: int) -> StreamingResponse:
    async def stream():
        async for event in turn.follow(start):
            yield sse(event)
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/projects/{slug}/turn")
def follow_turn(slug: str, since: int = 0):
    """Reattach to the running turn from event `since` (a reloaded tab). Ends at once if
    no turn is running."""
    _require(slug)
    turn = turns.get(slug)
    if turn is None:
        return StreamingResponse(iter(()), media_type="text/event-stream")
    return follow_response(turn, since)


@app.post("/api/projects/{slug}/link")
def link(slug: str):
    """Called by the Claude Code MCP server (app/claude_code_mcp.py) on every project it
    touches, so the studio can show that a terminal session is working on it."""
    _require(slug)
    projects.mark_linked(slug)
    return {"ok": True}


@app.post("/api/projects/{slug}/stop")
def stop(slug: str):
    _require(slug)
    if slug in turns:
        turns[slug].stopped = True
    return {"stopped": engine.stop(slug) or slug in turns}


@app.get("/api/projects/{slug}/board")
def get_board(slug: str):
    """The board: the design's pages as frames in rows (app/board.py)."""
    meta = _require(slug)
    return board.load(projects.design_dir(slug), meta["entry"])


@app.get("/api/projects/{slug}/versions")
def list_versions(slug: str):
    _require(slug)
    return projects.list_versions(slug)


@app.post("/api/projects/{slug}/restore")
def restore(slug: str, body: Restore):
    _require_writable(slug)
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    meta = projects.get(slug)
    context = decision_context(meta)
    after = [v["sha"] for v in projects.list_versions(slug)]
    after = after[after.index(body.sha) + 1:] if body.sha in after else []
    try:
        sha = projects.restore_version(slug, body.sha)
    except KeyError:
        raise HTTPException(404, "No such version")
    ids = []
    if after:  # one reject per restore, over the versions restored away (section 9)
        ids.append(decisions.append(decisions.path(projects.data_dir(slug)), project=slug, kind="reject",
                                    topic="other", subject={"page": None}, chose=body.sha, over=after,
                                    context=context)["id"])
    return {"sha": sha, "decisions": ids}


@app.get("/api/projects/{slug}/decisions")
def list_decisions(slug: str):
    """The project's decision log (data/<slug>/decisions.jsonl), oldest first."""
    _require(slug)
    return decisions.read(decisions.path(projects.data_dir(slug)))


@app.post("/api/projects/{slug}/approve")
def approve(slug: str, body: Approval):
    """The user approves the current version for building in a codebase. The confirmation stays in
    the studio: a terminal session (the Claude Code plugin) waits for this before it implements."""
    meta = _require_writable(slug)
    if busy(slug):
        raise HTTPException(409, "Wait for the running turn to finish")
    sha = projects.latest_version(slug)
    if sha is None:
        raise HTTPException(400, "Nothing to approve yet")
    approved = {"sha": sha, "at": time.time(), "why": body.why.strip() or None}
    projects.touch(slug, approved=approved)
    return approved


@app.get("/api/proposals")
async def list_proposals():
    """Rules design-guide proposes from the user's decisions across projects (docs/gate-rulebook.md §15)."""
    _require_design_guide()
    result = await rulebook.proposals(projects.DATA_DIR)
    if "error" in result:
        raise HTTPException(502, result["error"])
    return result


@app.post("/api/proposals/{proposal_id}/{action}")
async def answer_proposal(proposal_id: str, action: str, body: ProposalAnswer):
    """The user confirms (their reason required, in their words) or rejects a proposal. design-guide writes
    the rule; its refusal comes back as a 400 with its reason."""
    _require_design_guide()
    if action not in ("confirm", "reject"):
        raise HTTPException(404, "No such action")
    if action == "confirm" and not body.why.strip():
        raise HTTPException(400, "Confirming a rule needs your reason, in your words")
    ok, text = await rulebook.answer(action, proposal_id, projects.DATA_DIR, body.why, body.rule_id,
                                     body.title, body.category)
    if not ok:
        raise HTTPException(400, text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"ok": True}


@app.post("/api/projects/{slug}/findings/dismiss")
def dismiss_finding(slug: str, body: Dismissal):
    """The user dismisses a rule's findings for this project (§12): an override with `dismissed`.
    Floor rules cannot be dismissed."""
    meta = _require_writable(slug)
    rules = {r["id"]: r for r in (current_rulebook(meta) or {}).get("rules", [])}
    if body.rule not in rules:
        raise HTTPException(404, "No such rule in this project's rulebook")
    if rules[body.rule].get("layer") == "floor":
        raise HTTPException(400, "Accessibility-floor rules cannot be dismissed")
    why = body.why.strip() or None
    return decisions.append(decisions.path(projects.data_dir(slug)), project=slug, kind="override",
                            topic="other", subject={"page": body.page or meta["entry"]}, chose="dismissed",
                            rule=body.rule, dismissed=True, why=why, why_source="studio" if why else None,
                            context=decision_context(meta, body.page or None), **{"from": None})


@app.post("/api/projects/{slug}/decisions/why")
def decision_why(slug: str, body: DecisionWhy):
    """The user's reason, in their words, for decisions just logged (the studio's "why?" field)."""
    _require(slug)
    if not body.why.strip():
        raise HTTPException(400, "Empty reason")
    return decisions.add_why(decisions.path(projects.data_dir(slug)), body.ids, body.why)


@app.get("/api/projects/{slug}/comments")
def list_comments(slug: str):
    """Open comments only; resolved ones stay in the file for history."""
    _require(slug)
    return comments.open_comments(projects.comments_path(slug))


@app.post("/api/projects/{slug}/comments")
def add_comment(slug: str, body: NewComment):
    _require(slug)
    if not body.note.strip():
        raise HTTPException(400, "Empty comment")
    return comments.add(projects.comments_path(slug), body.selector, body.tag,
                        body.element_text, body.note, body.page)


@app.delete("/api/projects/{slug}/comments/{comment_id}")
def delete_comment(slug: str, comment_id: str):
    _require(slug)
    if not comments.delete(projects.comments_path(slug), comment_id):
        raise HTTPException(404, "No such comment")
    return {"ok": True}


@app.post("/api/projects/{slug}/attachments")
async def upload_attachment(slug: str, name: str, request: Request):
    """Attach a file to the next message. The body is the file's bytes; ?name= its name."""
    _require(slug)
    try:
        return attachments.add(projects.data_dir(slug), name, await request.body())
    except attachments.AttachmentError as err:
        raise HTTPException(400, str(err))


@app.post("/api/projects/{slug}/attachments/capture")
async def capture_attachment(slug: str, body: Capture):
    """Attach a web page: a full-page screenshot plus its visible text."""
    _require(slug)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Enter a full http:// or https:// address")
    try:
        png, text, title = await capture_page(url)
    except Exception as err:  # navigation errors come in many Playwright types
        raise HTTPException(400, f"Could not capture {url}: {str(err).splitlines()[0]}")
    host = urllib.parse.urlparse(url).hostname or "page"
    data = projects.data_dir(slug)
    shot = attachments.add(data, f"{host}.png", png, source=url)
    page_text = attachments.add(data, f"{host}.txt", f"{title}\n{url}\n\n{text}".encode(), source=url)
    return [shot, page_text]


@app.post("/api/projects/{slug}/attachments/sketch")
async def sketch_attachment(slug: str, body: Sketch):
    """Attach a drawing: the page as the canvas showed it, with the user's strokes on top."""
    import base64
    _require(slug)
    if projects.resolve_file(slug, body.page) is None:
        raise HTTPException(404, "No such page")
    prefix = "data:image/png;base64,"
    if not body.overlay.startswith(prefix):
        raise HTTPException(400, "The drawing must be a PNG")
    try:
        overlay = base64.b64decode(body.overlay[len(prefix):], validate=True)
    except ValueError:
        raise HTTPException(400, "The drawing is not valid base64")
    width, height = max(320, min(body.width, 2560)), max(200, min(body.height, 4000))
    previewer = Previewer(projects.design_dir(slug))
    try:
        png = await previewer.sketch(body.page, (width, height), max(0, body.scroll_y), overlay)
    finally:
        await previewer.close()
    data = projects.data_dir(slug)
    count = sum(1 for a in attachments.pending(data) if a["name"].startswith("sketch"))
    return attachments.add(data, f"sketch-{count + 1}.png", png)


@app.get("/api/projects/{slug}/attachments/{item_id}")
def attachment_file(slug: str, item_id: str):
    _require(slug)
    item = attachments.get(projects.data_dir(slug), item_id)
    if item is None:
        raise HTTPException(404, "No such attachment")
    return FileResponse(item["path"], filename=item["name"])


@app.delete("/api/projects/{slug}/attachments/{item_id}")
def delete_attachment(slug: str, item_id: str):
    _require(slug)
    if not attachments.remove(projects.data_dir(slug), item_id):
        raise HTTPException(404, "No such pending attachment")
    return {"ok": True}


@app.post("/api/projects/{slug}/edits")
def save_edits(slug: str, body: DirectEdits):
    """Save Edit-mode changes as a new version (no model turn). Text that can't be placed
    unambiguously comes back as `unplaced` for the studio to hand to the agent."""
    meta = _require_writable(slug)
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    context = decision_context(meta)
    try:
        result = edits.save(projects.design_dir(slug), meta["entry"], projects.data_dir(slug),
                            body.styles, [t.model_dump(exclude={"page"}) for t in body.texts])
    except edits.EditError as err:
        raise HTTPException(400, str(err))
    result["decisions"] = log_edits(meta, body, context)
    if result["placed"] or result["styles"]:
        changes = [f'text "{t["before"][:40]}" -> "{t["after"][:40]}" in {t["file"]}'
                   for t in result["placed"]]
        if result["styles"]:
            changes.append(f"{result['styles']} style value(s) in {', '.join(result['files'])}")
        if result["deleted"]:
            changes.append("deleted (hidden with display: none for now) " + ", ".join(
                f"`{d['selector']}` in {d['page']}" for d in result["deleted"]))
        projects.add_note(slug, "the user edited the design directly: " + "; ".join(changes)
                          + ". Read the files again before editing. Keep the studio-edits*.css files "
                          "and their links; if you restructure a page so a selector in its file "
                          "stops matching, move that rule into your own CSS."
                          + (" Remove each deleted element from the source and drop its "
                             "display: none rule." if result["deleted"] else ""))
        if result["deleted"]:
            projects.touch(slug, pending_deletes=[*meta["pending_deletes"], *result["deleted"]])
        result["sha"] = projects.commit_version(slug, "Direct edits")
    return result


def log_edits(meta: dict, body: DirectEdits, context: dict) -> list[str]:
    """An override per changed style property and per text edit, coalesced per chat turn."""
    file, mark, slug = decisions.path(projects.data_dir(meta["slug"])), meta["decisions_mark"], meta["slug"]
    ids = []
    for page, rules in body.styles.items():
        for selector, props in rules.items():
            for prop, value in props.items():
                before = body.before.get(page, {}).get(selector, {}).get(prop)
                r = decisions.override(file, mark, project=slug, context=context, page=page,
                                       selector=selector, prop=prop, before=before, after=value,
                                       rule=rule_for_property(meta, prop, page))
                if r:
                    ids.append(r["id"])
    for t in body.texts:
        r = decisions.override(file, mark, project=slug, context=context, page=t.page or meta["entry"],
                               selector=t.selector, prop="text", before=t.before, after=t.after, topic="copy")
        if r:
            ids.append(r["id"])
    return ids


@app.post("/api/projects/{slug}/tweaks")
def keep_tweaks(slug: str, body: KeepTweaks):
    """Save the Tweaks panel's values as the design's new defaults."""
    meta = _require_writable(slug)
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    page = body.page or meta["entry"]
    path = projects.resolve_file(slug, page)
    old = {t.get("name"): t for t in (tweaks.read(path.read_text()) or [])} if path and path.is_file() else {}
    context = decision_context(meta, page)
    try:
        sha = projects.keep_tweaks(slug, body.values, body.page or None)
    except (ValueError, FileNotFoundError):
        raise HTTPException(400, "The design has no tweaks block")
    ids = []
    for name, value in body.values.items():
        if name not in old:
            continue
        r = decisions.override(decisions.path(projects.data_dir(slug)), meta["decisions_mark"], project=slug,
                               context=context, page=page, selector=None, prop=name,
                               before=str(old[name].get("value")), after=str(value),
                               topic="color" if old[name].get("type") == "color" else "other")
        if r:
            ids.append(r["id"])
    return {"sha": sha, "decisions": ids}


@app.put("/api/projects/{slug}/design-system")
def choose_design_system(slug: str, body: DesignSystemChoice):
    meta = _require(slug)
    if meta["kind"] != projects.DESIGN:
        raise HTTPException(400, "Only designs can use a design system")
    if busy(slug):
        raise HTTPException(409, "Stop the running turn first")
    before = meta["design_system"]
    try:
        sha = projects.set_design_system(slug, body.design_system)
    except KeyError:
        raise HTTPException(404, "No such design system")
    ids = []
    if body.design_system != before:  # a pick among the systems the studio offered
        others = [p["slug"] for p in projects.list_all()
                  if p["kind"] == projects.DESIGN_SYSTEM and p["slug"] != body.design_system]
        meta = projects.get(slug)
        ids.append(decisions.append(decisions.path(projects.data_dir(slug)), project=slug, kind="pick",
                                    topic="direction", subject={"page": None},
                                    chose=body.design_system or "none", over=others,
                                    context=decision_context(meta))["id"])
    return {"sha": sha, "decisions": ids}


EXPORT_TYPES = {"html": "text/html", "png": "image/png", "pdf": "application/pdf",
                "zip": "application/zip", "frames": "application/pdf"}


def merge_pdfs(parts: list[bytes]) -> bytes:
    import io

    from pypdf import PdfWriter
    writer = PdfWriter()
    for part in parts:
        writer.append(io.BytesIO(part))
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@app.get("/api/projects/{slug}/export/{fmt}")
async def export_project(slug: str, fmt: str, page: str | None = None):
    """Download the design: one HTML file, a full-page PNG or a PDF of a page (`?page=`, the
    entry page by default), every board frame as one PDF (`frames`), or a ZIP. A page the
    board prints on paper exports as that paper: one designed page, or a paginated document."""
    meta = _require(slug)
    if fmt not in EXPORT_TYPES:
        raise HTTPException(404, "Unknown export format")
    root, entry = projects.design_dir(slug), meta["entry"]
    target = page or entry
    if page is not None and projects.resolve_file(slug, page) is None:
        raise HTTPException(404, "No such page")
    name = f"{slug}.{fmt}" if fmt != "frames" else f"{slug}-board.pdf"
    if fmt == "zip":
        content = export.zip_folder(root, slug)
    elif not (root / target).is_file():
        raise HTTPException(404, "Nothing to export yet")
    elif fmt == "html":
        content = export.inline_html(root, target).encode()
    else:
        previewer = Previewer(root)
        try:
            if fmt == "png":
                content, _ = await previewer.screenshot(target, DESKTOP, full_page=True)
            elif fmt == "frames":
                frames = board.load(root, entry)["frames"]
                content = merge_pdfs([await previewer.pdf_frame(f) for f in frames])
            elif frame := board.print_frame(root, target, entry):
                content = await previewer.pdf_frame(frame)
            else:
                content = await previewer.pdf(target)
        finally:
            await previewer.close()
    return Response(content, media_type=EXPORT_TYPES[fmt], headers={
        "Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/p/{slug}/{path:path}")
def project_file(slug: str, path: str):
    """A live design file, as served to "Open in new tab"."""
    _require(slug)
    path = path or "index.html"
    file = projects.resolve_file(slug, path)
    if file is None:
        raise HTTPException(404, "No such file")
    return design_response(file.read_bytes(), path)


@app.get("/v/{slug}/{sha}/{path:path}")
def version_file(slug: str, sha: str, path: str):
    """A file as it was at a past version."""
    _require(slug)
    path = path or "index.html"
    content = projects.file_at_version(slug, sha, path)
    if content is None:
        raise HTTPException(404, "No such file at that version")
    return design_response(content, path)


# The studio canvas. Every HTML page under these prefixes gets static/canvas-bridge.js, so
# comments, Edit mode and Tweaks keep working when a link in the design opens another
# page. A page that doesn't exist (deleted, or not in that version) redirects to the entry.
@app.get("/canvas/{slug}/{path:path}")
def canvas_file(slug: str, path: str):
    meta = _require(slug)
    path = path or meta["entry"]
    file = projects.resolve_file(slug, path)
    if file is None:
        if is_page(path) and path != meta["entry"]:
            return RedirectResponse(f"/canvas/{slug}/{meta['entry']}")
        raise HTTPException(404, "No such file")
    return design_response(file.read_bytes(), path, bridge=True)


@app.get("/canvas-version/{slug}/{sha}/{path:path}")
def canvas_version_file(slug: str, sha: str, path: str):
    meta = _require(slug)
    path = path or meta["entry"]
    content = projects.file_at_version(slug, sha, path)
    if content is None:
        if is_page(path) and path != meta["entry"]:
            return RedirectResponse(f"/canvas-version/{slug}/{sha}/{meta['entry']}")
        raise HTTPException(404, "No such file at that version")
    return design_response(content, path, bridge=True)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
# The technique library's gallery, which reads the built-in systems from ../design-systems/.
app.mount("/creative-library", StaticFiles(directory=LIBRARY_DIR, html=True, check_dir=False), name="library")
app.mount("/design-systems", StaticFiles(directory=projects.BUILTIN_DIR, check_dir=False), name="design-systems")
