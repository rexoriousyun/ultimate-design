import asyncio
import json
import time

from app import engine, projects
from app.turns import Turn
from tests.conftest import done, pause, say, tool
from tests.test_server import new_project, sse_events


def test_follow_replays_then_streams_until_finished():
    async def scenario():
        turn = Turn()
        await turn.publish({"n": 1})
        seen = []

        async def reader(start):
            return [e["n"] async for e in turn.follow(start)]
        early = asyncio.create_task(reader(0))
        late = asyncio.create_task(reader(1))
        await asyncio.sleep(0)
        await turn.publish({"n": 2})
        await turn.publish({"n": 3})
        await turn.finish()
        return await early, await late
    assert asyncio.run(scenario()) == ([1, 2, 3], [2, 3])


import httpx


def first_event(base, slug, message="go"):
    """Send a message, read its first event, then disconnect like a closed tab."""
    with httpx.stream("POST", f"{base}/api/projects/{slug}/chat", json={"message": message},
                      timeout=10) as res:
        for line in res.iter_lines():
            if line.startswith("data: "):
                return json.loads(line[6:])


def project(base, slug):
    return httpx.get(f"{base}/api/projects/{slug}").json()


def wait_until_idle(base, slug, timeout=5):
    deadline = time.time() + timeout
    while project(base, slug)["running"]:
        assert time.time() < deadline, "turn never finished"
        time.sleep(0.05)


def new(base, name="p"):
    return httpx.post(f"{base}/api/projects", json={"name": name}).json()["slug"]


def test_turn_keeps_running_after_the_tab_disconnects(live_server, fake_engine):
    fake_engine([({"index.html": "v1"}, [say("Starting."), pause(0.4), tool(engine.VERIFY_TOOL),
                                         say("Built."), done()])])
    slug = new(live_server)
    assert first_event(live_server, slug)["text"] == "Starting."  # the tab closes here
    assert project(live_server, slug)["running"] is True

    wait_until_idle(live_server, slug)
    assert [e["type"] for e in projects.read_chat(slug)] == ["user", "text", "tool", "text", "done"]
    assert [v["message"] for v in projects.list_versions(slug)] == ["go"]


def test_reconnect_follows_from_where_the_page_left_off(live_server, fake_engine):
    fake_engine([({}, [say("one"), pause(0.4), say("two"), done()])])
    slug = new(live_server)
    first_event(live_server, slug)
    state = project(live_server, slug)
    assert state["running"] and state["turn_events"] == 1
    assert [e.get("text") for e in state["chat"]] == ["go", "one"]

    res = httpx.get(f"{live_server}/api/projects/{slug}/turn?since={state['turn_events']}", timeout=10)
    rest = [json.loads(l[6:]) for l in res.text.splitlines() if l.startswith("data: ")]
    assert [e["type"] for e in rest] == ["text", "done"] and rest[0]["text"] == "two"


def test_follow_with_no_running_turn_ends_immediately(client):
    slug = new_project(client)
    assert sse_events(client.get(f"/api/projects/{slug}/turn")) == []


def test_busy_blocks_second_message_and_edits(live_server, fake_engine):
    fake_engine([({}, [say("a"), pause(0.4), done()])])
    slug = new(live_server)
    first_event(live_server, slug)
    assert httpx.post(f"{live_server}/api/projects/{slug}/chat", json={"message": "again"}).status_code == 409
    assert httpx.delete(f"{live_server}/api/projects/{slug}").status_code == 409
    wait_until_idle(live_server, slug)


def test_stop_prevents_a_pending_nudge_run(live_server, fake_engine):
    eng = fake_engine([({"index.html": "x"}, [tool("Write"), pause(0.4), done()]), ({}, [say(), done()])])
    slug = new(live_server)
    first_event(live_server, slug)
    assert httpx.post(f"{live_server}/api/projects/{slug}/stop").json()["stopped"] is True
    wait_until_idle(live_server, slug)
    assert len(eng.prompts) == 1  # the verify nudge run never started
    assert projects.list_versions(slug)[0]["message"] == "go"  # work so far is kept
