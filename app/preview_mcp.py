"""MCP server that gives the design agent eyes on its own work.

Claude Code starts it per turn (see engine.py) with the project folder as the working
directory. Tools appear to the agent as mcp__pm__<name>. Keep docs/agent.md and the
system prompt in sync when changing a tool (tests/test_docs.py checks).
"""

import json
import os
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel

from app import comments, decisions, rulebook
from app.preview import DESKTOP, MOBILE, Previewer

server = MCPServer("pm")
_previewer: Previewer | None = None

# Set by the server for models that cannot read images (a text-only local model rejects the
# whole request if a tool result contains one). Screenshots are replaced by measurements.
TEXT_ONLY = os.environ.get("PM_NO_IMAGES") == "1"
NO_IMAGES_NOTE = ("Screenshots are off because this model cannot read images. "
                  "Check layout with eval_js instead.")
LAYOUT_JS = ("({horizontalOverflow: document.documentElement.scrollWidth > innerWidth, "
             "scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, "
             "pageHeight: document.documentElement.scrollHeight})")


def previewer() -> Previewer:
    global _previewer
    if _previewer is None:
        rules, dismissed = None, set()
        if os.environ.get("PM_RULEBOOK_FILE"):  # the studio's turns: design-guide is the rule book
            rules = rulebook.load(Path(os.environ["PM_RULEBOOK_FILE"])) or {
                "error": "no rulebook was exported for this turn"}
            log = os.environ.get("PM_DECISIONS_FILE")
            dismissed = rulebook.dismissed(Path(log) if log else None)
        _previewer = Previewer(Path(os.environ.get("PM_PROJECT_DIR", os.getcwd())),
                               hierarchy=os.environ.get("PM_HIERARCHY") == "1", rules=rules,
                               dismissed=dismissed)
    return _previewer


@server.tool()
async def verify(path: str = "index.html") -> list:
    """Check the design the way the user will see it. Call this after your last file change
    in a turn, fix anything it reports, and call it again until it is clean.

    Returns screenshots at desktop (1440px) and mobile (390px) width plus any console
    errors, uncaught exceptions, failed requests, findings of design-guide's rules that
    can be measured in the page (contrast, target size, reflow), each named by its rule
    id, project CSS/JS
    files the page does not load, values outside an attached design system or the page's
    Wada palette (<meta name="palette" content="wada:NNN">), and places
    where the page's measured prominence disagrees with its data-priority order."""
    result = []
    for label, size in (("Desktop", DESKTOP), ("Mobile", MOBILE)):
        png, problems = await previewer().screenshot(path, size)
        result.append(f"{label} {size[0]}px: {problems.report()}")
        if TEXT_ONLY:
            if (previewer().folder / path).is_file():
                result.append(f"{label} layout: {await previewer().evaluate(path, LAYOUT_JS, size)}")
        else:
            result.append(Image(data=png, format="png"))
    if TEXT_ONLY:
        result.append(NO_IMAGES_NOTE)
    return result


@server.tool()
async def screenshot(path: str = "index.html", width: int = 1440, height: int = 900,
                     full_page: bool = False) -> list:
    """Screenshot one page at a given viewport size. Use full_page only when you need to
    see content below the fold; it costs more."""
    png, problems = await previewer().screenshot(path, (width, height), full_page)
    if TEXT_ONLY:
        return [problems.report(), NO_IMAGES_NOTE]
    return [problems.report(), Image(data=png, format="png")]


@server.tool()
async def eval_js(expression: str, path: str = "index.html", width: int = 1440) -> str:
    """Load a page and evaluate a JavaScript expression in it, returning the result as
    JSON. Useful for checking layout numbers, e.g.
    "document.documentElement.scrollWidth > innerWidth" to detect horizontal overflow."""
    return await previewer().evaluate(path, expression, (width, 900))


class Question(BaseModel):
    text: str
    options: list[str] = []
    multiple: bool = False  # more than one option may be picked
    # For the decision log: the visual dimension the question decides (decisions.TOPICS), and
    # the design-guide rule it is a contested call of, if any (then options are its alternative ids).
    topic: str | None = None
    rule: str | None = None


MAX_QUESTIONS = 5
MAX_OPTIONS = 6


@server.tool()
async def ask_questions(questions: list[Question]) -> str:
    """Ask the user a few questions before building, when the brief leaves the design's
    structure open (who it is for, the main action, what matters most, what content to
    show). The studio shows them as a short form. Give options where the answer is a
    choice; the user can always write their own. After calling this, end your turn
    without writing files: the answers arrive as the next message."""
    if not 1 <= len(questions) <= MAX_QUESTIONS:
        raise ToolError(f"Ask between 1 and {MAX_QUESTIONS} questions.")
    for q in questions:
        if not q.text.strip():
            raise ToolError("Every question needs text.")
        if len(q.options) > MAX_OPTIONS or any(not o.strip() for o in q.options):
            raise ToolError(f"Give at most {MAX_OPTIONS} non-empty options per question.")
    return ("The questions are shown to the user. End your turn now without writing files; "
            "their answers arrive as the next message.")


MAX_STEPS = 10


@server.tool()
async def propose_plan(summary: str, steps: list[str]) -> str:
    """Show the user your plan before you build, when the studio asks for a plan first.
    `summary` is one line on what you will make; `steps` are three to eight concrete steps
    (what you will build or change, in order). The user approves it as it is or edited, or
    tells you what to change. After calling this, end your turn without writing files: the
    approved plan arrives as the next message."""
    if not summary.strip():
        raise ToolError("Give the plan a one-line summary.")
    if not 1 <= len(steps) <= MAX_STEPS or any(not s.strip() for s in steps):
        raise ToolError(f"Give between 1 and {MAX_STEPS} non-empty steps.")
    return ("The plan is shown to the user. End your turn now without writing files; "
            "the approved plan, or what to change, arrives as the next message.")


@server.tool()
async def resolve_comment(comment_id: str, summary: str) -> str:
    """Mark a user's element comment as resolved once you have addressed it. `summary` is
    one line on what you changed, shown to the user."""
    path = os.environ.get("PM_COMMENTS_FILE")
    if not path:
        return "Comments are not available in this session."
    if comments.resolve(Path(path), comment_id, summary) is None:
        return f"No comment with id {comment_id}."
    return f"Resolved comment {comment_id}."


def _last_user_message(chat_file: Path) -> str:
    """What the user wrote in this turn's message (the chat log's last user event)."""
    if not chat_file.is_file():
        return ""
    for line in reversed(chat_file.read_text().splitlines()):
        if line.strip():
            event = json.loads(line)
            if event.get("type") == "user":
                return event.get("text") or ""
    return ""


@server.tool()
async def log_decision(kind: Literal["pick", "reject"], topic: str, chose: str = "",
                       over: list[str] = [], quote: str = "", page: str = "", rule: str = "") -> str:
    """Record a design decision the user made in their message: they picked one of the
    alternatives you showed (a direction on the board, an option section, a variant), or
    turned one down. Call it once per decision, in the turn their message makes it.

    `chose` is the alternative picked and `over` the ones not picked, as the user saw them
    (labels or page names); for a rejection, `over` is what they turned down and `chose` is
    empty. `topic` is one of: color, type, layout, spacing, density, shape, motion, imagery,
    copy, component, hierarchy, direction, other. `quote` is the user's reason copied exactly
    from their message, or empty: never write a reason for them, and anything not found word
    for word in their message is dropped. Don't log your own choices, answers to
    ask_questions, or edits the user made in the studio: those are logged already."""
    path, chat = os.environ.get("PM_DECISIONS_FILE"), os.environ.get("PM_CHAT_FILE")
    if not path or not chat:
        return "The decision log is not available in this session."
    if topic not in decisions.TOPICS:
        raise ToolError(f"topic must be one of: {', '.join(decisions.TOPICS)}.")
    if kind == "pick" and not chose.strip():
        raise ToolError("A pick needs `chose`.")
    if kind == "reject" and not over:
        raise ToolError("A rejection needs `over`: what the user turned down.")
    why = decisions.quote_or_none(quote, _last_user_message(Path(chat)))
    record = decisions.append(Path(path), project=os.environ.get("PM_PROJECT_SLUG", ""), kind=kind,
                              topic=topic, subject={"page": page or None},
                              chose=chose.strip() or "none", over=over, why=why,
                              why_source="chat" if why else None, rule=rule or None,
                              context=json.loads(os.environ.get("PM_DECISION_CONTEXT", "{}")))
    if why:
        kept = "with the user's reason"
    elif quote.strip():
        kept = "without a reason (the quote was not in their message word for word)"
    else:
        kept = "without a reason"
    return f"Logged {kind} {record['id']} {kept}."


if __name__ == "__main__":
    server.run("stdio")
