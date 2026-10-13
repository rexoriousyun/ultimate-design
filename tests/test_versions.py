from app import versions


def repo(tmp_path):
    git_dir, work = tmp_path / "git", tmp_path / "work"
    work.mkdir()
    versions.init(git_dir, work)
    return git_dir, work


def test_log_is_empty_before_first_commit(tmp_path):
    assert versions.log(*repo(tmp_path)) == []


def test_commit_log_and_show(tmp_path):
    git_dir, work = repo(tmp_path)
    (work / "index.html").write_text("one")
    first = versions.commit(git_dir, work, "first")
    (work / "index.html").write_text("two")
    versions.commit(git_dir, work, "second")

    log = versions.log(git_dir, work)
    assert [v["message"] for v in log] == ["first", "second"]
    assert log[0]["sha"] == first
    assert versions.show(git_dir, work, first, "index.html") == b"one"
    assert versions.show(git_dir, work, first, "missing.html") is None
    assert versions.show(git_dir, work, "not-a-sha!", "index.html") is None


def test_no_git_folder_in_work_tree(tmp_path):
    git_dir, work = repo(tmp_path)
    (work / "a.txt").write_text("a")
    versions.commit(git_dir, work, "a")
    assert sorted(p.name for p in work.iterdir()) == ["a.txt"]


def test_restore_removes_files_added_later(tmp_path):
    git_dir, work = repo(tmp_path)
    (work / "index.html").write_text("one")
    first = versions.commit(git_dir, work, "first")
    (work / "extra.css").write_text("x")
    (work / "index.html").write_text("two")
    versions.commit(git_dir, work, "second")

    assert versions.restore(git_dir, work, first, "restore")
    assert sorted(p.name for p in work.iterdir()) == ["index.html"]
    assert (work / "index.html").read_text() == "one"
