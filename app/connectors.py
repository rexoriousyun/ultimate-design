"""Connectors: MCP servers the user adds so the design agent can read context from other
tools (docs, tickets, data), like Claude Design's connectors.

Stored in data/connectors.json in Claude Code's own format ({"mcpServers": {name: config}}),
so an entry can be pasted from a .mcp.json file. Each project turns on the ones it wants
(meta "connectors"); engine.py adds those to the agent's MCP config and allows their tools.
"""

import json
import re

from app import projects

NAME = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
RESERVED = {"pm"}  # the preview MCP server


class ConnectorError(Exception):
    """Shown to the user."""


def _path():
    return projects.DATA_DIR / "connectors.json"


def load() -> dict:
    path = _path()
    return json.loads(path.read_text()).get("mcpServers", {}) if path.exists() else {}


def _save(servers: dict) -> None:
    projects.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps({"mcpServers": servers}, indent=2))


def describe(config: dict) -> str:
    return config.get("url") or " ".join([config.get("command", ""), *config.get("args", [])]).strip()


def put(name: str, config: dict) -> dict:
    """Add or replace a connector. `config` is one Claude Code MCP server entry: a local
    command ({"command", "args", "env"}) or a remote server ({"type": "http"|"sse", "url"})."""
    if not NAME.match(name) or name in RESERVED:
        raise ConnectorError("Use letters, digits, - and _ for the name (not \"pm\")")
    if not isinstance(config, dict) or not (isinstance(config.get("command"), str)
                                            or isinstance(config.get("url"), str)):
        raise ConnectorError('The config needs a "command" (a local server) or a "url" (a remote one)')
    servers = load()
    servers[name] = config
    _save(servers)
    return {"name": name, "target": describe(config)}


def remove(name: str) -> bool:
    servers = load()
    if servers.pop(name, None) is None:
        return False
    _save(servers)
    return True


def for_project(meta: dict) -> dict:
    """The project's turned-on connectors that still exist, as {name: config}."""
    servers = load()
    return {name: servers[name] for name in meta["connectors"] if name in servers}
