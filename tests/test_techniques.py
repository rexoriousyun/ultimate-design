"""The technique library in the studio (app/techniques.py): the catalogue and live demo pages."""

from playwright.sync_api import sync_playwright

from app import techniques


def test_catalogue_lists_every_web_recipe_with_what_the_studio_shows():
    items = techniques.all_techniques()
    assert len(items) == 41
    halftone = next(t for t in items if t["id"] == "halftone")
    assert halftone["label"] == "Halftone" and halftone["primitive"] == "canvas"
    assert halftone["source"] == "creative-library/recipes/web/halftone.js"
    assert halftone["screenshot"] == "/creative-library/recipes/web/screenshots/halftone.png"
    assert halftone["props"] and halftone["description"]
    # The header comment, without its comment markers, is what explains the effect.
    assert halftone["notes"] and not halftone["notes"].startswith(("/**", "*"))
    assert all(t["screenshot"] for t in items)  # the render gate keeps one per recipe


def test_routes(client):
    listed = client.get("/api/techniques").json()
    assert [t["id"] for t in listed] == [t["id"] for t in techniques.all_techniques()]
    shot = client.get("/creative-library/recipes/web/screenshots/halftone.png")
    assert shot.status_code == 200 and shot.headers["content-type"] == "image/png"
    demo = client.get("/library/demo/halftone")
    assert demo.status_code == 200 and demo.headers["content-type"].startswith("text/html")
    assert '<script src="/creative-library/recipes/web/registry.js">' in demo.text
    assert "three.min.js" not in demo.text
    assert client.get("/library/demo/no-such").status_code == 404


def test_demo_loads_three_and_dependencies_only_when_declared():
    assert "/creative-library/node_modules/three/build/three.min.js" in techniques.demo_html("three-points")
    acorn = techniques.demo_html("acorn-hoard")  # depends on pixel-sprite
    assert acorn.index("pixel-sprite.js") < acorn.index("acorn-hoard.js")


def test_demo_page_paints_in_chromium(live_server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{live_server}/library/demo/noise-grain")
        page.wait_for_selector("#stage svg")
        assert page.evaluate("document.querySelector('#stage').getBoundingClientRect().height") > 50
        browser.close()
    assert errors == []


def test_catalogue_carries_each_recipes_intents():
    by_id = {t["id"]: t for t in techniques.all_techniques()}
    assert "handmade paper feel" in by_id["noise-grain"]["intents"]
    assert all(t["intents"] for t in by_id.values())


def test_catalogue_carries_parameter_maps_and_their_evidence():
    halftone = next(t for t in techniques.all_techniques() if t["id"] == "halftone")
    assert halftone["props"]["cell"]["controls"].startswith("Dot pitch")
    assert halftone["props"]["cell"]["range"] == [2, 32]
    assert halftone["evidence"]["cell"] == {
        "verdict": "effective", "strip": "/creative-library/recipes/web/sweeps/halftone/cell.png"}
    accel = next(t for t in techniques.all_techniques() if t["id"] == "absorb-drops")["evidence"]["accel"]
    assert accel["verdict"] == "unswept" and "reduced motion" in accel["reason"]


def test_evidence_strips_are_served(client):
    strip = client.get("/creative-library/recipes/web/sweeps/halftone/cell.png")
    assert strip.status_code == 200 and strip.headers["content-type"] == "image/png"
