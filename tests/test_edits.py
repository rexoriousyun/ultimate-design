"""Direct canvas edits: text placed in source files, styles in a studio-edits*.css per page."""

import pytest

from app import edits, projects
from tests.conftest import done, say
from tests.test_server import new_project

PAGE = "<html><head><title>t</title></head><body><h1>Plans &amp; pricing</h1><p>Start free</p></body></html>"


def site(tmp_path):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "index.html").write_text(PAGE)
    (tmp_path / "app.js").write_text("const label = 'Buy now';")
    return tmp_path


def test_text_is_placed_only_when_unique(tmp_path):
    folder = site(tmp_path)
    assert edits.apply_text(folder, "Start free", "Try it free") == "index.html"
    assert "Try it free" in (folder / "index.html").read_text()
    assert edits.apply_text(folder, "Plans & pricing", "Plans <3") == "index.html"  # escaped form
    assert "Plans &lt;3" in (folder / "index.html").read_text()
    assert edits.apply_text(folder, "Buy now", "Get it") == "app.js"
    assert edits.apply_text(folder, "Missing words", "x") is None
    (folder / "other.html").write_text("<p>Try it free</p>")
    assert edits.apply_text(folder, "Try it free", "y") is None  # in two files: ambiguous
    assert edits.apply_text(folder, "same", "same") is None


def test_design_system_files_are_never_edited(tmp_path):
    folder = site(tmp_path)
    (folder / "design-system").mkdir()
    (folder / "design-system" / "README.html").write_text("<p>Only here</p>")
    assert edits.apply_text(folder, "Only here", "x") is None


def test_styles_validated():
    with pytest.raises(edits.EditError, match="Unsupported style"):
        edits.validate_styles({"h1": {"color": "red"}})  # named colours: no, only hex or a token
    with pytest.raises(edits.EditError, match="Unsupported style"):
        edits.validate_styles({"h1": {"background-color": "var(--x); color: red"}})
    with pytest.raises(edits.EditError, match="Unsupported style"):
        edits.validate_styles({"h1": {"translate": "10px"}})
    with pytest.raises(edits.EditError, match="Unsupported style"):
        edits.validate_styles({"h1": {"order": "1; x: y"}})
    with pytest.raises(edits.EditError, match="Unsupported style"):
        edits.validate_styles({"h1": {"width": "10px; background:red"}})
    with pytest.raises(edits.EditError, match="selector"):
        edits.validate_styles({"h1 { color: red } p": {"width": "1px"}})
    with pytest.raises(edits.EditError, match="selector"):
        edits.validate_styles({"h1 /* x */": {"width": "1px"}})
    assert edits.validate_styles({"main > div:nth-of-type(2) > h1": {"width": "auto", "text-align": "center",
                                                                     "margin-top": "-8px"}})
    assert edits.validate_styles({"h1": {"color": "#1c1b19", "background-color": "var(--color-surface)",
                                         "translate": "-12px 4.5px", "order": "3"}})


def test_save_merges_styles_links_css_once(tmp_path):
    folder, data = site(tmp_path / "d"), tmp_path / "data"
    data.mkdir()
    edits.save(folder, "index.html", data, {"index.html": {"h1": {"font-size": "40px"}}}, [])
    edits.save(folder, "index.html", data, {"index.html": {"h1": {"margin-top": "8px"}, "p": {"width": "200px"}}}, [])
    css = (folder / edits.CSS_FILE).read_text()
    assert "h1 {\n  font-size: 40px !important;\n  margin-top: 8px !important;\n}" in css
    assert "p {\n  width: 200px !important;\n}" in css
    page = (folder / "index.html").read_text()
    assert page.count("data-studio-edits") == 1 and page.index("data-studio-edits") < page.index("</head>")


def test_each_page_gets_its_own_stylesheet(tmp_path):
    folder, data = site(tmp_path / "d"), tmp_path / "data"
    data.mkdir()
    (folder / "flow").mkdir()
    (folder / "flow" / "step 2.html").write_text(PAGE)
    result = edits.save(folder, "index.html", data, {
        "index.html": {"h1": {"color": "#111111"}},
        "flow/step 2.html": {"h1": {"translate": "10px 0px"}}}, [])
    assert result["files"] == ["studio-edits.css", "studio-edits-flow-step-2.css"]
    assert "#111111" in (folder / "studio-edits.css").read_text()
    other = (folder / "studio-edits-flow-step-2.css").read_text()
    assert "translate: 10px 0px" in other and "#111111" not in other
    # The subfolder page links its file with a path relative to itself.
    assert 'href="../studio-edits-flow-step-2.css"' in (folder / "flow" / "step 2.html").read_text()
    with pytest.raises(edits.EditError, match="No such page"):
        edits.save(folder, "index.html", data, {"../outside.html": {"h1": {"width": "1px"}}}, [])
    with pytest.raises(edits.EditError, match="No such page"):
        edits.save(folder, "index.html", data, {"app.js": {"h1": {"width": "1px"}}}, [])


def test_old_flat_style_store_is_read_as_the_entry_page(tmp_path):
    import json
    folder, data = site(tmp_path / "d"), tmp_path / "data"
    data.mkdir()
    (data / "style-edits.json").write_text(json.dumps({"h1": {"width": "10px"}}))
    edits.save(folder, "index.html", data, {"index.html": {"p": {"width": "20px"}}}, [])
    css = (folder / edits.CSS_FILE).read_text()
    assert "width: 10px" in css and "width: 20px" in css
    assert set(json.loads((data / "style-edits.json").read_text())) == {"index.html"}


def test_route_saves_a_version_and_notes_the_agent(client):
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text(PAGE)
    res = client.post(f"/api/projects/{slug}/edits", json={
        "styles": {"index.html": {"body > h1": {"font-size": "48px"}}},
        "texts": [{"selector": "p", "before": "Start free", "after": "Try free"},
                  {"selector": "b", "before": "Not on the page", "after": "x"}]})
    body = res.json()
    assert res.status_code == 200 and body["styles"] == 1
    assert [t["after"] for t in body["placed"]] == ["Try free"]
    assert [t["before"] for t in body["unplaced"]] == ["Not on the page"]
    assert projects.list_versions(slug)[-1]["message"] == "Direct edits"
    note = projects.get(slug)["pending_note"]
    assert "edited the design directly" in note and "studio-edits.css" in note
    assert client.post(f"/api/projects/{slug}/edits",
                       json={"styles": {"index.html": {"h1": {"color": "red"}}}}).status_code == 400


def test_nothing_placed_means_no_version(client):
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text(PAGE)
    res = client.post(f"/api/projects/{slug}/edits",
                      json={"texts": [{"selector": "x", "before": "nope", "after": "y"}]})
    assert "sha" not in res.json() and projects.list_versions(slug) == []


def test_type_props_and_delete_validated():
    ok = {"font-family": '"Work Sans", system-ui', "font-weight": "600", "letter-spacing": "-0.5px",
          "line-height": "1.4", "font-size": "var(--text-lg)", "display": "none"}
    assert edits.validate_styles({"h1": ok})
    for prop, bad in (("font-family", "x; color: red"), ("font-weight", "650"), ("letter-spacing", "2"),
                      ("line-height", "1.4em; x"), ("display", "block"), ("font-size", "var(--x); y")):
        with pytest.raises(edits.EditError, match="Unsupported style"):
            edits.validate_styles({"h1": {prop: bad}})


def test_deleted_elements_are_hidden_until_the_agent_turn_drops_the_rule(tmp_path):
    folder, data = site(tmp_path / "d"), tmp_path / "data"
    data.mkdir()
    result = edits.save(folder, "index.html", data, {"index.html": {"p": {"display": "none", "width": "10px"}}}, [])
    assert result["deleted"] == [{"page": "index.html", "selector": "p"}]
    assert "display: none !important" in (folder / edits.CSS_FILE).read_text()
    edits.drop_deletes(folder, "index.html", data, result["deleted"])
    css = (folder / edits.CSS_FILE).read_text()
    assert "display" not in css and "width: 10px" in css  # other edits on it stay


def test_delete_round_trip_through_the_agent_turn(client, fake_engine):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    slug = new_project(client)
    (projects.design_dir(slug) / "index.html").write_text(PAGE)
    client.post(f"/api/projects/{slug}/edits", json={"styles": {"index.html": {"body > p": {"display": "none"}}}})
    assert projects.get(slug)["pending_deletes"] == [{"page": "index.html", "selector": "body > p"}]
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert "deleted (hidden with display: none for now) `body > p` in index.html" in eng.prompts[0]["prompt"]
    assert "Remove each deleted element from the source" in eng.prompts[0]["prompt"]
    assert projects.get(slug)["pending_deletes"] == []
    assert "display" not in (projects.design_dir(slug) / edits.CSS_FILE).read_text()
    client.post(f"/api/projects/{slug}/chat", json={"message": "again"})
    assert "deleted" not in eng.prompts[1]["prompt"]



def test_motion_presets_are_validated_and_written_for_motion_that_is_welcome():
    with pytest.raises(edits.EditError):
        edits.validate_styles({"h1": {"motion-enter": "spin"}})
    css = edits.render_css({"h1": {"color": "#fff", "motion-enter": "rise", "motion-speed": "slow"},
                            ".card": {"motion-hover": "lift"}})
    assert "h1 {\n  color: #fff !important;\n}" in css and "motion-enter:" not in css.split("@media")[0].split("h1 {\n")[1].split("}")[0]
    assert "h1 { --pm-motion-enter: rise; --pm-motion-hover: none; --pm-motion-speed: slow; }" in css
    welcome = css.split("@media (prefers-reduced-motion: no-preference) {")[1]
    assert "@keyframes pm-motion-rise { from { opacity: 0; transform: translateY(16px); } }" in welcome
    assert "h1 { animation: pm-motion-rise 600ms" in welcome
    assert ".card:hover { transform: translateY(-4px) !important; }" in welcome
    assert "pm-motion-rise" not in css.split("@media")[0].replace("--pm-motion-enter: rise", "")
    # A selector with only motion gets no empty rule.
    assert ".card {\n}" not in css
