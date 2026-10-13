from app import projects


def test_slugs_are_unique():
    a = projects.create("Pricing Page!")
    b = projects.create("pricing page")
    assert a["slug"] == "pricing-page"
    assert b["slug"] == "pricing-page-2"


def test_resolve_file_stays_inside_project():
    slug = projects.create("x")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("hi")
    assert projects.resolve_file(slug, "index.html").read_text() == "hi"
    assert projects.resolve_file(slug, "../../data/x/meta.json") is None
    assert projects.resolve_file(slug, "missing.html") is None


def test_app_state_is_outside_design_folder():
    slug = projects.create("x")["slug"]
    projects.append_chat(slug, {"type": "user", "text": "hello"})
    projects.commit_version(slug, "first")
    assert projects.list_files(slug) == []  # no meta, chat or .git where the agent works


def test_duplicate_copies_files_not_chat_or_history():
    slug = projects.create("orig")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("a")
    projects.commit_version(slug, "one")
    (projects.design_dir(slug) / "index.html").write_text("b")
    projects.commit_version(slug, "two")
    projects.append_chat(slug, {"type": "user", "text": "hello"})

    copy = projects.duplicate(slug)["slug"]
    assert (projects.design_dir(copy) / "index.html").read_text() == "b"
    assert projects.read_chat(copy) == []
    assert [v["message"] for v in projects.list_versions(copy)] == ["Duplicated from orig"]


def test_commit_version_uses_first_line_and_skips_no_change():
    slug = projects.create("x")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("a")
    assert projects.commit_version(slug, "make a page\nwith details")
    assert projects.commit_version(slug, "nothing changed") is None
    assert [v["message"] for v in projects.list_versions(slug)] == ["make a page"]


def test_commit_version_initializes_git_for_older_projects():
    slug = projects.create("old")["slug"]
    import shutil
    shutil.rmtree(projects.DATA_DIR / slug / "git")  # as created before milestone 2
    (projects.design_dir(slug) / "index.html").write_text("a")
    assert projects.commit_version(slug, "first")


def test_restore_version_sets_note_for_agent():
    slug = projects.create("x")["slug"]
    page = projects.design_dir(slug) / "index.html"
    page.write_text("v1")
    first = projects.commit_version(slug, "one")
    page.write_text("v2")
    projects.commit_version(slug, "two")

    projects.restore_version(slug, first)
    assert page.read_text() == "v1"
    assert "version 1" in projects.get(slug)["pending_note"]
    assert [v["message"] for v in projects.list_versions(slug)] == ["one", "two", "Restored version 1"]


def test_restore_unknown_version_raises():
    slug = projects.create("x")["slug"]
    try:
        projects.restore_version(slug, "deadbeef")
    except KeyError:
        return
    raise AssertionError("expected KeyError")


def test_branch_copies_the_files_of_one_version():
    slug = projects.create("orig")["slug"]
    (projects.design_dir(slug) / "index.html").write_text("a")
    (projects.design_dir(slug) / "old.css").write_text("x")
    projects.commit_version(slug, "one")
    first = projects.list_versions(slug)[0]["sha"]
    (projects.design_dir(slug) / "index.html").write_text("b")
    (projects.design_dir(slug) / "old.css").unlink()
    projects.commit_version(slug, "two")

    branch = projects.duplicate(slug, first, "orig (branch)")
    folder = projects.design_dir(branch["slug"])
    assert branch["name"] == "orig (branch)"
    assert (folder / "index.html").read_text() == "a" and (folder / "old.css").read_text() == "x"
    assert [v["message"] for v in projects.list_versions(branch["slug"])] == ["Branched from orig version 1"]
    assert (projects.design_dir(slug) / "index.html").read_text() == "b"  # the original is untouched
