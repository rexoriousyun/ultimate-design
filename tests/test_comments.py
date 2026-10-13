from app import comments


def test_add_resolve_delete(tmp_path):
    path = tmp_path / "comments.json"
    a = comments.add(path, "#buy", "button", "Buy now", " Make it bigger ")
    b = comments.add(path, "h1", "h1", "Welcome", "Shorter headline")
    assert a["note"] == "Make it bigger"
    assert [c["id"] for c in comments.open_comments(path)] == [a["id"], b["id"]]

    resolved = comments.resolve(path, a["id"], "Raised font size")
    assert resolved["status"] == "resolved"
    assert [c["id"] for c in comments.open_comments(path)] == [b["id"]]
    assert len(comments.list_all(path)) == 2  # resolved comments are kept

    assert comments.delete(path, b["id"])
    assert not comments.delete(path, b["id"])
    assert comments.resolve(path, "nope", "x") is None
    assert comments.open_comments(path) == []


def test_missing_file_is_empty(tmp_path):
    assert comments.open_comments(tmp_path / "none" / "comments.json") == []


def test_element_text_is_truncated(tmp_path):
    c = comments.add(tmp_path / "c.json", "p", "p", "x" * 500, "note")
    assert len(c["element_text"]) == 120


def test_prompt_block_lists_id_selector_text_and_note(tmp_path):
    path = tmp_path / "c.json"
    c = comments.add(path, "#plans > div:nth-of-type(2) > a", "a", "Talk to sales", "Say 'Book a demo'")
    block = comments.prompt_block(comments.open_comments(path))
    assert "resolve_comment" in block
    assert f'[{c["id"]}] on `#plans > div:nth-of-type(2) > a` (<a> "Talk to sales"): Say \'Book a demo\'' in block
