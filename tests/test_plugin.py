"""The Claude Code plugin (plugin/, .claude-plugin/marketplace.json; docs/claude-code.md) and the
studio approval it waits for. The MCP server itself is tested in test_claude_code_mcp.py."""

import asyncio
import json
import os
import re
from pathlib import Path

from mcp import ClientSession, StdioServerParameters, stdio_client

from app import projects
from tests.conftest import done, pause, say

ROOT = Path(__file__).parent.parent
PLUGIN = ROOT / "plugin"


def test_the_marketplace_lists_the_plugin_and_the_plugin_names_itself():
    market = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text())
    [entry] = market["plugins"]
    assert entry["name"] == "ultimate-design" and entry["source"] == "./plugin"
    manifest = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
    assert manifest["name"] == "ultimate-design" and re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"])


def test_the_plugins_mcp_server_is_the_launcher_and_the_launcher_serves_the_repos_tools():
    servers = json.loads((PLUGIN / ".mcp.json").read_text())["mcpServers"]
    assert servers == {"ultimate-design": {"command": "${CLAUDE_PLUGIN_ROOT}/bin/ultimate-design-mcp"}}
    launcher = PLUGIN / "bin" / "ultimate-design-mcp"
    assert os.access(launcher, os.X_OK)
    params = StdioServerParameters(command=str(launcher), args=[],
                                   env={**os.environ, "ULTIMATE_DESIGN_DIR": str(ROOT), "PM_AUTOSTART": "0"})

    async def tools():
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return sorted(t.name for t in (await session.list_tools()).tools)
    assert "wait_for_approval" in asyncio.run(tools())


def test_the_skill_names_every_tool_and_the_approval_rule():
    skill = (PLUGIN / "skills" / "ultimate-design" / "SKILL.md").read_text()
    front = skill.split("---")[1]
    assert re.search(r"^name: ultimate-design$", front, re.M) and re.search(r"^description: .{40,}", front, re.M)
    source = (ROOT / "app" / "claude_code_mcp.py").read_text()
    tools = re.findall(r"@server\.tool\(\)\nasync def (\w+)", source)
    assert tools and [t for t in tools if f"`{t}" not in skill] == []
    assert "Approve for build" in skill


def test_approve_marks_the_current_version(client, fake_engine):
    slug = client.post("/api/projects", json={"name": "p"}).json()["slug"]
    assert client.post(f"/api/projects/{slug}/approve", json={}).status_code == 400  # nothing yet
    fake_engine([({"index.html": "<h1>v1</h1>"}, [say(), done()])])
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    approved = client.post(f"/api/projects/{slug}/approve", json={"why": "  ship it "}).json()
    assert approved["sha"] == projects.latest_version(slug) and approved["why"] == "ship it"
    assert client.get(f"/api/projects/{slug}").json()["approved"] == approved
    assert client.post("/api/projects/nope/approve", json={}).status_code == 404


def test_approve_waits_for_a_running_turn(live_server, fake_engine):
    import urllib.error
    import urllib.request
    fake_engine([({"index.html": "<h1>v1</h1>"}, [say(), done()]), ({}, [pause(2), say(), done()])])
    slug = projects.create("Busy")["slug"]

    def post(path, body):
        req = urllib.request.Request(f"{live_server}{path}", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        return urllib.request.urlopen(req)
    post(f"/api/projects/{slug}/chat", {"message": "one"}).read()
    post(f"/api/projects/{slug}/chat", {"message": "two"})  # left running
    try:
        post(f"/api/projects/{slug}/approve", {})
        raise AssertionError("approved during a turn")
    except urllib.error.HTTPError as err:
        assert err.code == 409
