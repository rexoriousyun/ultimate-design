"""The design agent's prompt keeps rules that fixed real problems. Each assertion names a
rule a later edit must not silently drop (see docs/decisions.md for why each exists)."""

from pathlib import Path

SYSTEM = (Path(__file__).resolve().parent.parent / "app" / "prompts" / "system.md").read_text()


def test_missing_facts_become_placeholders_not_inventions():
    assert "`[YOUR PRICE]`" in SYSTEM and "Never invent facts about the user's business" in SYSTEM
    assert "Invent plausible" not in SYSTEM  # the old rule this replaced


def test_content_and_change_discipline():
    for rule in ("No filler", "Change only what was asked", "follow its visual vocabulary",
                 "with flex or grid and `gap`", "copy its exact values"):
        assert rule in SYSTEM, rule


EXTRACT = (Path(__file__).resolve().parent.parent / "app" / "prompts" / "extract.md").read_text()


def test_design_systems_carry_real_components():
    assert "components/components.css" in EXTRACT and 'a "Components" section' in EXTRACT
    assert "use its components with the exact markup" in SYSTEM


def test_wada_palettes_drive_colour_when_none_is_given():
    from app import engine
    prompt = engine.design_prompt()
    for rule in ('<meta name="palette" content="wada:006">', "Never use the colours in equal amounts",
                 "--palette-override-", "enum tweak named `palette`", "its own Wada palette"):
        assert rule in SYSTEM, rule
    assert "greyscale, real structure" not in SYSTEM  # directions were greyscale before
    for name in ("README.md", "combinations.md"):  # the paths the prompt names exist
        path = engine.LIBRARY_DIR / "palettes" / "wada" / name
        assert str(path) in prompt and path.is_file()


def test_prompt_points_at_the_intent_index():
    from app import engine
    path = engine.LIBRARY_DIR / "recipes" / "web" / "intents.json"
    assert str(path) in engine.design_prompt() and path.is_file()
