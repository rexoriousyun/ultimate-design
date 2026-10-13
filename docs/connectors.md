# Connectors

Connectors give the design agent read access to other tools (documents, tickets, data)
through MCP servers, like Claude Design's connectors. The agent normally runs with only
its own preview server (`--strict-mcp-config`); a connector is added only to the projects
that turn it on.

## Add one

On Home, open **Connectors**, give a name and paste one server entry in Claude Code's
`.mcp.json` format:

```json
{"type": "http", "url": "https://mcp.linear.app/mcp"}
```

```json
{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/notes"], "env": {}}
```

A local server needs `command`; a remote one needs `url` (`type` `http` or `sse`). The name
uses letters, digits, `-` and `_`, and `pm` is reserved. Entries are stored in
`data/connectors.json` as `{"mcpServers": {name: config}}`, which you can also edit by hand.

Remote servers that need OAuth authenticate the way headless Claude Code does; a server
that needs an interactive login may not work until you have logged in to it once with
`claude` in a terminal.

## Use one

In the studio, open **Connectors** in the chat header and tick the ones this project may
use. They apply from the next message. The agent's tools from a connector are named
`mcp__<name>__<tool>` and are pre-approved (`--allowedTools mcp__<name>`). The system
prompt tells the agent to use them for context and not to change anything in them unless
asked.

## Code

- `app/connectors.py` — load, validate, save, and the per-project selection.
- `app/engine.py` — `TurnOptions.connectors` goes into `--mcp-config` and `--allowedTools`.
- Routes: `GET /api/connectors`, `PUT`/`DELETE /api/connectors/{name}`,
  `PUT /api/projects/{slug}/connectors` (see `docs/architecture.md`).
