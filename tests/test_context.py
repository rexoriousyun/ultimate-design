"""What the agent is told besides the message: the studio context (page, width, Edit-mode
selection) and the reference folders a design is connected to."""

from pathlib import Path

from app import projects
from app.server import Selected, ViewContext, describe_view, turn_options
from tests.conftest import done, say
from tests.test_server import new_project
from tests.test_sources import fake_github  # noqa: F401 (fixture)


def test_describe_view():
    assert describe_view(None) is None
    assert describe_view(ViewContext()) is None
    assert describe_view(ViewContext(page="index.html", width=1440)) is None  # the default view adds nothing
    line = describe_view(ViewContext(page="pricing.html", width=390, selected=Selected(
        selector="main > a:nth-of-type(2)", tag="a", text="Start  free\ntrial", count=3)))
    assert line == ('(Studio context: The user is looking at pricing.html at 390px (mobile). In Edit mode '
                    'they have selected <a> "Start free trial" (`main > a:nth-of-type(2)`), with 2 more '
                    'element(s); "this" most likely means that element.)')
    # User-side text can't break out of its quotes or code span, and paths stay inside the project.
    odd = describe_view(ViewContext(page="../secret.html", width=1440, selected=Selected(
        selector="a`b", tag="p", text="x`y")))
    assert "secret" not in odd and "`a'b`" in odd and '"x\'y"' in odd
    assert odd.startswith("(Studio context: In Edit mode")


def test_context_reaches_the_prompt_and_the_log(client, fake_engine):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    slug = new_project(client)
    context = {"page": "index.html", "width": 1440,
               "selected": {"selector": "#buy", "tag": "button", "text": "Buy", "count": 1}}
    client.post(f"/api/projects/{slug}/chat", json={"message": "make this bigger", "context": context})
    prompt = eng.prompts[0]["prompt"]
    assert prompt.index("(Studio context:") < prompt.index("make this bigger")
    assert "<button> \"Buy\" (`#buy`)" in prompt
    assert projects.read_chat(slug)[0]["context"]["selected"]["selector"] == "#buy"
    client.post(f"/api/projects/{slug}/chat", json={"message": "plain"})
    assert eng.prompts[1]["prompt"] == "plain"


def test_local_reference_is_read_only_and_restated_every_turn(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    repo = tmp_path / "app-repo"
    repo.mkdir()
    slug = new_project(client)
    meta = client.post(f"/api/projects/{slug}/references", json={"source": str(repo)}).json()
    assert meta["references"] == [{"source": str(repo), "dir": str(repo.resolve())}]
    for _ in range(2):
        client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert all(f"read-only: {repo.resolve()}." in p["prompt"] for p in eng.prompts)
    assert repo.resolve() in turn_options(projects.get(slug)).read_only_dirs

    # Validation: once only, existing absolute paths only, designs only.
    assert client.post(f"/api/projects/{slug}/references", json={"source": str(repo)}).status_code == 400
    assert client.post(f"/api/projects/{slug}/references", json={"source": "relative"}).status_code == 400
    ds = projects.create("DS", projects.DESIGN_SYSTEM, str(repo))["slug"]
    assert client.post(f"/api/projects/{ds}/references", json={"source": str(repo)}).status_code == 400

    # Disconnecting leaves a local folder alone.
    meta = client.delete(f"/api/projects/{slug}/references", params={"source": str(repo)}).json()
    assert meta["references"] == [] and repo.is_dir()
    assert client.delete(f"/api/projects/{slug}/references", params={"source": str(repo)}).status_code == 404


def test_github_reference_is_cloned_copied_on_duplicate_and_deleted_on_disconnect(client, fake_github):
    slug = new_project(client)
    url = "https://github.com/acme/ui/tree/main/src"
    meta = client.post(f"/api/projects/{slug}/references", json={"source": url}).json()
    folder = meta["references"][0]["dir"]
    assert folder.endswith("/src") and "references" in folder
    assert "--brand" in (Path(folder) / "theme.css").read_text()
    from app.server import describe_references
    assert f"{folder} (github {url})" in describe_references(projects.get(slug))

    copy = projects.duplicate(slug)
    copied = copy["references"][0]["dir"]
    assert copied != folder and copy["slug"] in copied and (Path(copied) / "theme.css").exists()

    client.delete(f"/api/projects/{slug}/references", params={"source": url})
    assert not Path(folder).exists()
    assert Path(copied).exists()  # the copy keeps its own
