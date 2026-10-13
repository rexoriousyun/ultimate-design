from app import engine, projects
from tests.conftest import done, say
from tests.test_server import new_project


def make_system(client, tmp_path, name="Brand"):
    source = tmp_path / "brand-src"
    source.mkdir(exist_ok=True)
    (source / "theme.css").write_text(":root { --brand: #123456; }")
    res = client.post("/api/projects", json={"name": name, "kind": "design-system", "source": str(source)})
    assert res.status_code == 200
    ds = res.json()
    root = projects.design_dir(ds["slug"])
    (root / "tokens.css").write_text(":root { --brand: #123456; }")
    (root / "README.md").write_text("Use --brand.")
    (root / "specimen.html").write_text("<p>specimen</p>")
    return ds, source


def test_create_design_system_validates_source(client, tmp_path):
    ds, source = make_system(client, tmp_path)
    assert ds["kind"] == "design-system" and ds["entry"] == "specimen.html"
    assert ds["source"] == str(source.resolve())
    for bad in ("relative/path", str(tmp_path / "missing")):
        body = {"name": "x", "kind": "design-system", "source": bad}
        assert client.post("/api/projects", json=body).status_code == 400
    assert client.post("/api/projects", json={"name": "x", "kind": "nope"}).status_code == 400


def test_design_system_from_attached_files_only(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    ds = client.post("/api/projects", json={"name": "Files", "kind": "design-system", "source": ""}).json()
    assert ds["kind"] == "design-system" and ds["source"] is None
    client.post(f"/api/projects/{ds['slug']}/attachments?name=brand.pdf", content=b"%PDF-1.4 x")
    client.post(f"/api/projects/{ds['slug']}/chat", json={"message": "Extract"})
    assert "the files attached to the user's messages" in eng.options.system_prompt
    # Only the attachments folder is readable; there is no source folder.
    assert [d.name for d in eng.options.read_only_dirs] == ["attachments"]
    assert "brand.pdf" in eng.prompts[0]["prompt"]
    assert client.post(f"/api/projects/{ds['slug']}/source/refresh").status_code == 400


def test_default_design_system_is_attached_to_new_designs(client, tmp_path):
    ds, _ = make_system(client, tmp_path)
    assert client.get("/api/settings").json() == {"default_design_system": None}
    assert client.put("/api/settings/default-design-system", json={"design_system": "nope"}).status_code == 404
    plain = new_project(client, "plain")
    assert projects.get(plain)["design_system"] is None

    assert client.put("/api/settings/default-design-system",
                      json={"design_system": ds["slug"]}).json()["default_design_system"] == ds["slug"]
    made = client.post("/api/projects", json={"name": "Uses default"}).json()
    assert made["design_system"] == ds["slug"]
    assert (projects.design_dir(made["slug"]) / "design-system" / "tokens.css").exists()
    assert "now uses the design system" in made["pending_note"]
    # An explicit choice wins, including none.
    none = client.post("/api/projects", json={"name": "No system", "design_system": None}).json()
    assert none["design_system"] is None
    bad = client.post("/api/projects", json={"name": "Bad", "design_system": plain})
    assert bad.status_code == 400

    # Deleting the default system clears the default.
    client.delete(f"/api/projects/{ds['slug']}")
    assert client.get("/api/settings").json() == {"default_design_system": None}


def test_design_system_turn_gets_extract_prompt_and_read_only_source(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()])])
    ds, source = make_system(client, tmp_path)
    client.post(f"/api/projects/{ds['slug']}/chat", json={"message": "Extract"})
    assert eng.options.read_only_dirs == [source.resolve()]
    assert eng.options.system_prompt.startswith("You are a design systems engineer")
    assert f"The source is: {source.resolve()}" in eng.options.system_prompt


def test_file_source_gives_read_access_to_its_folder(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()])])
    shot = tmp_path / "shot.png"
    shot.write_bytes(b"png")
    ds = client.post("/api/projects", json={"name": "S", "kind": "design-system", "source": str(shot)}).json()
    client.post(f"/api/projects/{ds['slug']}/chat", json={"message": "Extract"})
    assert eng.options.read_only_dirs == [tmp_path.resolve()]
    assert str(shot.resolve()) in eng.options.system_prompt


def test_design_turn_uses_default_prompt_and_reads_only_the_library(client, fake_engine):
    eng = fake_engine([({}, [say(), done()])])
    slug = new_project(client)
    client.post(f"/api/projects/{slug}/chat", json={"message": "go"})
    assert eng.options.system_prompt is None and eng.options.read_only_dirs == [engine.LIBRARY_DIR]
    assert eng.options.mcp_env["PM_HIERARCHY"] == "1"  # designs are checked against data-priority


def test_design_system_turn_skips_the_hierarchy_check_and_the_library(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()])])
    ds, _ = make_system(client, tmp_path)
    client.post(f"/api/projects/{ds['slug']}/chat", json={"message": "Extract"})
    assert "PM_HIERARCHY" not in eng.options.mcp_env
    assert engine.LIBRARY_DIR not in eng.options.read_only_dirs


def test_attach_copies_system_without_specimen_notes_and_commits(client, tmp_path):
    ds, _ = make_system(client, tmp_path)
    slug = new_project(client)
    res = client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    assert res.status_code == 200

    copied = projects.design_dir(slug) / "design-system"
    assert sorted(p.name for p in copied.iterdir()) == ["README.md", "tokens.css"]
    meta = projects.get(slug)
    assert meta["design_system"] == ds["slug"]
    assert "design-system/README.md" in meta["pending_note"]
    assert projects.list_versions(slug)[-1]["message"] == "Use design system Brand"


def test_detach_removes_copy(client, tmp_path):
    ds, _ = make_system(client, tmp_path)
    slug = new_project(client)
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": None})
    assert not (projects.design_dir(slug) / "design-system").exists()
    assert projects.get(slug)["design_system"] is None
    assert projects.list_versions(slug)[-1]["message"] == "Removed design system"


def test_attach_rejects_unknown_or_non_system(client, tmp_path):
    slug = new_project(client)
    other = new_project(client, "other")
    assert client.put(f"/api/projects/{slug}/design-system", json={"design_system": "nope"}).status_code == 404
    assert client.put(f"/api/projects/{slug}/design-system", json={"design_system": other}).status_code == 404
    ds, _ = make_system(client, tmp_path)
    assert client.put(f"/api/projects/{ds['slug']}/design-system",
                      json={"design_system": ds["slug"]}).status_code == 400


def test_changed_system_is_resynced_and_noted_before_a_turn(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    ds, _ = make_system(client, tmp_path)
    slug = new_project(client)
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    assert "now uses the design system" in eng.prompts[0]["prompt"]

    (projects.design_dir(ds["slug"]) / "tokens.css").write_text(":root { --brand: #654321; }")
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    assert "#654321" in (projects.design_dir(slug) / "design-system" / "tokens.css").read_text()
    assert "was updated" in eng.prompts[1]["prompt"]


def test_unchanged_system_adds_no_note(client, fake_engine, tmp_path):
    eng = fake_engine([({}, [say(), done()]), ({}, [say(), done()])])
    ds, _ = make_system(client, tmp_path)
    slug = new_project(client)
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    client.post(f"/api/projects/{slug}/chat", json={"message": "one"})
    client.post(f"/api/projects/{slug}/chat", json={"message": "two"})
    assert eng.prompts[1]["prompt"] == "two"


def test_duplicate_keeps_kind_and_design_system(client, tmp_path):
    ds, _ = make_system(client, tmp_path)
    slug = new_project(client)
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    copy = projects.duplicate(slug)
    assert copy["design_system"] == ds["slug"]
    assert (projects.design_dir(copy["slug"]) / "design-system" / "tokens.css").exists()
    ds_copy = projects.duplicate(ds["slug"])
    assert ds_copy["kind"] == "design-system" and ds_copy["source"] == ds["source"]


def test_old_metadata_gets_defaults(tmp_path):
    import json
    slug = projects.create("old")["slug"]
    path = projects.DATA_DIR / slug / "meta.json"
    meta = json.loads(path.read_text())
    for key in ("kind", "source", "design_system", "pending_note"):
        meta.pop(key)
    path.write_text(json.dumps(meta))
    assert projects.get(slug)["kind"] == "design" and projects.get(slug)["design_system"] is None


def test_components_come_with_the_system_and_are_optional_per_page(client, tmp_path):
    import asyncio

    from app.preview import DESKTOP, Previewer
    ds, _ = make_system(client, tmp_path)
    root = projects.design_dir(ds["slug"])
    (root / "components").mkdir()
    (root / "components" / "components.css").write_text(".ds-button { padding: 8px; }")
    (root / "components" / "components.js").write_text("customElements.define('ds-x', class extends HTMLElement {});")
    slug = new_project(client)
    client.put(f"/api/projects/{slug}/design-system", json={"design_system": ds["slug"]})
    copied = projects.design_dir(slug) / "design-system" / "components"
    assert sorted(p.name for p in copied.iterdir()) == ["components.css", "components.js"]

    (projects.design_dir(slug) / "index.html").write_text(
        "<!doctype html><title>t</title><link rel=stylesheet href='design-system/tokens.css'><h1>x</h1>")

    async def unloaded():
        previewer = Previewer(projects.design_dir(slug))
        try:
            return (await previewer.screenshot("index.html", DESKTOP))[1].unloaded_files
        finally:
            await previewer.close()
    assert asyncio.run(unloaded()) == []  # not loading the component library is fine
