"""Agent engines.

An engine runs one agent turn in a project folder and yields normalized events:
  {"type": "text", "text": str}
  {"type": "tool", "id": str, "name": str, "summary": str}
  {"type": "tool_result", "id": str, "is_error": bool}
  {"type": "done", "is_error": bool, "cost_usd": float | None, "session_id": str,
   "tokens"?: {"input", "output", "cache_read", "cache_write"}}
  {"type": "error", "message": str}

ClaudeCodeEngine drives the `claude` CLI headless, so it uses the logged-in
Claude Code subscription instead of an API key. A local model ("ollama:<name>")
runs through the same CLI pointed at Ollama's Anthropic-compatible API.
"""

import asyncio
import json
import os
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

from app import ollama_proxy

REPO_ROOT = Path(__file__).resolve().parent.parent
PROMPT_FILE = Path(__file__).parent / "prompts" / "system.md"
# The technique library designs may read (read-only) and copy from; {library} in the prompt.
LIBRARY_DIR = REPO_ROOT / "creative-library"
TOOLS = "Read,Write,Edit,Glob,Grep"
MCP_PREFIX = "mcp__pm__"
WRITE_TOOLS = {"Write", "Edit"}
VERIFY_TOOL = MCP_PREFIX + "verify"
ASK_TOOL = MCP_PREFIX + "ask_questions"
PLAN_TOOL = MCP_PREFIX + "propose_plan"
VERIFY_NUDGE = ("(Note from the app: you changed files after your last verify call. "
                "Call verify now and fix anything it reports before you finish.)")
RULES_NUDGE = ("(Note from the app: design-guide's rules found problems in the pages you changed. "
               "Fix each one, call verify, then finish. A finding that is right to leave as it is: "
               "say why in your reply; only the user can dismiss a rule.)")
EMPTY_NUDGE = ("(Note from the app: your last reply was empty. Do the work now with your "
               "tools, then reply briefly.)")


@dataclass
class TurnOptions:
    """Per-turn settings the server chooses by project.

    mcp_env: extra environment for the preview MCP server, e.g. PM_COMMENTS_FILE.
    system_prompt: prompt text; None means app/prompts/system.md.
    read_only_dirs: absolute folders the agent may read but never write (design system sources).
    model: None for the engine's default Claude model, or "ollama:<name>" for a local model.
    connectors: extra MCP servers the user connected (app/connectors.py), {name: config}.
    """
    mcp_env: dict = field(default_factory=dict)
    system_prompt: str | None = None
    read_only_dirs: list[Path] = field(default_factory=list)
    model: str | None = None
    connectors: dict = field(default_factory=dict)


# Claude models a project can switch between (the engine's default is used when meta.model
# is None). Switching among these keeps the conversation; see server.set_model.
CLAUDE_MODELS = {"claude-opus-5-5": "Opus 5.5", "claude-fable-5-1": "Fable 5.1",
                 "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-4-5-20251001": "Haiku 4.5"}
DEFAULT_MODEL = "claude-opus-5-5"

OLLAMA_URL = os.environ.get("PM_OLLAMA_URL", "http://localhost:11434")
LOCAL_PREFIX = "ollama:"


def design_prompt() -> str:
    """The design agent's system prompt, with the technique library's path filled in."""
    return PROMPT_FILE.read_text().replace("{library}", str(LIBRARY_DIR))


def is_local(model: str | None) -> bool:
    return bool(model) and model.startswith(LOCAL_PREFIX)


def provider_env(model: str) -> dict:
    """Environment for the claude CLI. Local models go through Ollama's Anthropic-compatible
    Messages API, so the same harness, tools and MCP server work unchanged."""
    if not is_local(model):
        return {}
    name = model.removeprefix(LOCAL_PREFIX)
    return {
        # Through ollama_proxy, which switches model thinking off (see that module).
        "ANTHROPIC_BASE_URL": ollama_proxy.start(OLLAMA_URL),
        "ANTHROPIC_AUTH_TOKEN": "ollama",
        "ANTHROPIC_API_KEY": "",
        # Claude Code makes small background calls with its "haiku" model; keep those local too.
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": name,
    }


def accepts_images(model: str | None) -> bool:
    """Claude models take screenshots. A local model must report Ollama's "vision"
    capability; a text-only one rejects the whole request if a tool result has an image."""
    if not is_local(model):
        return True
    body = json.dumps({"model": model.removeprefix(LOCAL_PREFIX)}).encode()
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/show", body, timeout=5) as res:
            return "vision" in json.load(res).get("capabilities", [])
    except (OSError, ValueError):
        return False


def local_models() -> list[str]:
    """Models Ollama has pulled, as "ollama:<name>". Empty if Ollama is not running."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2) as res:
            return [LOCAL_PREFIX + m["name"] for m in json.load(res)["models"]]
    except (OSError, ValueError, KeyError):
        return []


def mcp_config(cwd: Path, extra_env: dict | None = None, connectors: dict | None = None) -> str:
    """Config for the preview MCP server (app/preview_mcp.py), run with this venv's Python,
    plus the project's connectors."""
    env = {"PYTHONPATH": str(REPO_ROOT), "PM_PROJECT_DIR": str(cwd), **(extra_env or {})}
    return json.dumps({"mcpServers": {**(connectors or {}), "pm": {
        "command": sys.executable,
        "args": ["-m", "app.preview_mcp"],
        "env": env,
    }}})


def needs_verification(events: list[dict]) -> bool:
    """True if the turn wrote files and did not call verify after the last write.
    Markdown (README.md, HANDOFF.md) does not render in the canvas, so it doesn't count."""
    pending = False
    for event in events:
        if (event["type"] == "tool" and event["name"] in WRITE_TOOLS
                and not event["summary"].lower().endswith(".md")):
            pending = True
        elif event["type"] == "tool" and event["name"] == VERIFY_TOOL:
            pending = False
    return pending


def written_pages(events: list[dict], entry: str) -> list[str]:
    """The HTML pages a turn wrote, in order; the entry page when it wrote only CSS or JS."""
    pages, other = [], False
    for event in events:
        if event["type"] == "tool" and event["name"] in WRITE_TOOLS:
            path = event["summary"].removeprefix(event["name"] + " ")
            if path.lower().endswith(".html"):
                if path not in pages:
                    pages.append(path)
            elif not path.lower().endswith(".md"):
                other = True
    return pages or ([entry] if other else [])


def is_empty_turn(events: list[dict]) -> bool:
    """True if the turn completed without error but produced no text and no tool call.
    Small local models do this when they reason internally and Ollama strips the reasoning."""
    if not events or events[-1]["type"] != "done" or events[-1]["is_error"]:
        return False
    return not any(e["type"] in ("text", "tool") for e in events)


def summarize_tool(name: str, tool_input: dict, cwd: Path) -> str:
    name = name.removeprefix(MCP_PREFIX)
    # Glob and Grep take a folder as "path"; their pattern says more.
    path = tool_input.get("file_path") or ("pattern" not in tool_input and tool_input.get("path"))
    if path:
        try:
            path = str(Path(path).relative_to(cwd))
        except ValueError:
            pass
        return f"{name} {path}"
    if "pattern" in tool_input:
        return f"{name} {tool_input['pattern']}"
    return name


def normalize(raw: dict, cwd: Path) -> list[dict]:
    """Map one stream-json line from the CLI to zero or more events."""
    kind = raw.get("type")
    if kind == "assistant":
        events = []
        for block in raw["message"]["content"]:
            if block["type"] == "text" and block["text"].strip():
                events.append({"type": "text", "text": block["text"]})
            elif block["type"] == "tool_use":
                event = {"type": "tool", "id": block["id"], "name": block["name"],
                         "summary": summarize_tool(block["name"], block["input"], cwd)}
                if block["name"] == ASK_TOOL:
                    # The server shows them once the tool accepts them (see server.run_turn).
                    event["questions"] = block["input"].get("questions", [])
                elif block["name"] == PLAN_TOOL:
                    event["plan"] = {"summary": block["input"].get("summary", ""),
                                     "steps": block["input"].get("steps", [])}
                events.append(event)
        return events
    if kind == "user" and isinstance(raw["message"]["content"], list):
        return [{"type": "tool_result", "id": b["tool_use_id"], "is_error": bool(b.get("is_error"))}
                for b in raw["message"]["content"] if b.get("type") == "tool_result"]
    if kind == "result":
        event = {"type": "done", "is_error": bool(raw.get("is_error")),
                 "cost_usd": raw.get("total_cost_usd"), "session_id": raw.get("session_id")}
        usage = raw.get("usage") or {}
        if usage:
            event["tokens"] = {"input": usage.get("input_tokens", 0), "output": usage.get("output_tokens", 0),
                               "cache_read": usage.get("cache_read_input_tokens", 0),
                               "cache_write": usage.get("cache_creation_input_tokens", 0)}
        return [event]
    return []


class ClaudeCodeEngine:
    def __init__(self, model: str | None = None, effort: str | None = None):
        self.model = model or os.environ.get("PM_MODEL", DEFAULT_MODEL)
        self.effort = effort or os.environ.get("PM_EFFORT", "high")
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._stopped: set[str] = set()

    def command(self, cwd: Path, session_id: str, resume: bool,
                options: TurnOptions | None = None) -> list[str]:
        options = options or TurnOptions()
        cmd = [
            "claude", "-p",
            "--output-format", "stream-json", "--verbose",
            "--system-prompt", options.system_prompt or design_prompt(),
            "--tools", TOOLS,
            "--mcp-config", mcp_config(cwd, options.mcp_env, options.connectors),
            "--allowedTools", ",".join(["mcp__pm", *(f"mcp__{name}" for name in options.connectors)]),
            # Keep the user's own Claude Code setup (CLAUDE.md, hooks, plugins, MCP) out.
            "--setting-sources", "", "--strict-mcp-config", "--no-chrome",
            "--permission-mode", "acceptEdits", "--permission-prompts", "none",
            "--model", (options.model or self.model).removeprefix(LOCAL_PREFIX),
            "--effort", self.effort,
            "--resume" if resume else "--session-id", session_id,
        ]
        if options.read_only_dirs:
            # --add-dir grants read and write; the deny rules take write back.
            # A leading "//" makes a permission rule path absolute.
            deny = [f"{tool}(/{d}/**)" for d in options.read_only_dirs for tool in WRITE_TOOLS]
            for d in options.read_only_dirs:
                cmd += ["--add-dir", str(d)]
            cmd += ["--settings", json.dumps({"permissions": {"deny": sorted(deny)}})]
        return cmd

    async def run(self, key: str, cwd: Path, prompt: str, session_id: str, resume: bool,
                  options: TurnOptions | None = None) -> AsyncIterator[dict]:
        options = options or TurnOptions()
        proc = await asyncio.create_subprocess_exec(
            *self.command(cwd, session_id, resume, options), cwd=cwd,
            env={**os.environ, **provider_env(options.model or self.model)},
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024)
        self._procs[key] = proc
        proc.stdin.write(prompt.encode())
        proc.stdin.close()
        finished = False
        try:
            async for line in proc.stdout:
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for event in normalize(raw, cwd):
                    finished |= event["type"] == "done"
                    yield event
            code = await proc.wait()
            if not finished:
                err = (await proc.stderr.read()).decode().strip()
                yield {"type": "error",
                       "message": "Stopped." if key in self._stopped
                       else (err or f"claude exited with code {code}")}
        finally:
            self._procs.pop(key, None)
            self._stopped.discard(key)
            if proc.returncode is None:
                proc.terminate()

    def is_running(self, key: str) -> bool:
        return key in self._procs

    def stop(self, key: str) -> bool:
        proc = self._procs.get(key)
        if proc is None:
            return False
        self._stopped.add(key)
        proc.terminate()
        return True
