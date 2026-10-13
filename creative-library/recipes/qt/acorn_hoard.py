"""Quantity as a pile, for Qt — the Qt half of recipes/web/acorn-hoard.js.

A count drawn as stacked objects with a character standing on it. The layout is pure
arithmetic and crossed the language boundary unchanged; only the drawing calls differ
(QPainter.fillRect instead of ctx.fillRect). That is the second-strongest form of a recipe
travelling: not identical artwork like icon.py, but identical *logic*.

The row structure is the whole trick and it is unchanged: rows of 7/6/5/4/2 fill bottom-up,
each centred on the WIDEST row's span rather than its own. Centring each row on itself makes
the stack shuffle sideways as it fills — the detail people get wrong.

Past capacity the pile stops being proportional, so `layout` reports `overflow` instead of
silently capping. A pile that quietly stops counting is a chart that lies; the caller has to
know to print the number in text.

Usage:
    from acorn_hoard import pixmap, layout, capacity
    label.setPixmap(pixmap(14))
"""

import pixel_sprite

ROW_CAPACITY = (7, 6, 5, 4, 2)


def capacity(row_capacity=ROW_CAPACITY):
    """Total the pile can show. Past this the drawing is no longer proportional."""
    return sum(row_capacity)


def layout(count, size=3, row_capacity=ROW_CAPACITY):
    """Lay `count` items into bottom-up rows of decreasing width.

    Pure, so it is reusable for any stacked-object count — coins, bricks, jars — and
    testable without a QApplication.

    Returns a dict: items [(x, y, row)] as offsets from the pile's bottom-left, rows_used,
    pile_top (negative, or 0 when empty), overflow, width.
    """
    item_w = size * 4 + 2
    row_h = size * 3 - 1
    widest = max(row_capacity) * item_w

    items = []
    placed = 0
    rows_used = 0
    for r, cap in enumerate(row_capacity):
        if placed >= count:
            break
        n = min(cap, count - placed)
        # Centred on the widest row, not on this one.
        start_x = (widest - cap * item_w) / 2
        for i in range(n):
            items.append((start_x + i * item_w, -r * row_h, r))
            placed += 1
        rows_used = r + 1

    return {
        "items": items,
        "rows_used": rows_used,
        # Explicit zero when empty rather than a negated zero.
        "pile_top": -((rows_used - 1) * row_h) if rows_used > 0 else 0,
        "overflow": max(0, count - placed),
        "width": widest,
    }


def draw_acorn(painter, x, y, size, palette=None):
    """One acorn: cap, body, taper. Nine filled rects, scaled with the sprite."""
    from PyQt6.QtGui import QColor

    pal = palette or pixel_sprite.PALETTE
    painter.fillRect(int(x + size), int(y), int(size * 2), int(size), QColor(pal['h']))
    painter.fillRect(int(x), int(y + size), int(size * 4), int(size), QColor(pal['a']))
    painter.fillRect(int(x + size), int(y + size * 2), int(size * 2), int(size), QColor(pal['a']))


def pixmap(count=14, size=3, sprite_scale=3, pose='smile', background="#f0ece3", palette=None):
    """The pile with the character standing on top of it."""
    from PyQt6.QtGui import QColor, QPainter, QPixmap

    pal = palette or pixel_sprite.PALETTE
    plan = layout(count, size=size)
    sprite = pixel_sprite.pixmap(pose, scale=sprite_scale, palette=pal)

    w = int(max(sprite.width(), plan["width"]) + 16)
    h = int(sprite.height() + abs(plan["pile_top"]) + size * 3 + 18)

    pm = QPixmap(w, h)
    pm.fill(QColor(background))
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)

    base_y = h - size * 3 - 4
    base_x = (w - plan["width"]) / 2
    for x, y, _row in plan["items"]:
        draw_acorn(painter, base_x + x, base_y + y, size, pal)

    # The character's feet follow the top of the pile, so it rises as the hoard grows.
    # Positioning it at a fixed offset is what makes a hand-drawn version lie about the count.
    feet = base_y + plan["pile_top"] + 6
    painter.drawPixmap(int((w - sprite.width()) / 2), int(feet - sprite.height()), sprite)
    painter.end()
    return pm


def demo(background="#f0ece3"):
    """Several counts side by side — every value honest, not three hand-drawn states."""
    from PyQt6.QtGui import QColor, QPainter, QPixmap

    counts = [0, 3, 9, 14, 24]
    tiles = [pixmap(c, background=background) for c in counts]
    pad = 14
    w = sum(t.width() for t in tiles) + pad * (len(tiles) + 1)
    h = max(t.height() for t in tiles) + pad * 2

    pm = QPixmap(w, h)
    pm.fill(QColor(background))
    painter = QPainter(pm)
    x = pad
    for tile in tiles:
        painter.drawPixmap(x, h - pad - tile.height(), tile)
        x += tile.width() + pad
    painter.end()
    return pm


RECIPE = {
    "id": "acorn-hoard",
    "primitive": "canvas",
    "label": "Acorn hoard",
    "source": "recipes/qt/acorn_hoard.py",
    "export": "acorn_hoard",
    "description": (
        "A count drawn as a tapering pile of objects, with a character whose feet rise as "
        "the pile grows. Same layout arithmetic as the web recipe."
    ),
    "ports": "recipes/web/acorn-hoard.js",
    "props": {
        "count": {"type": "number", "default": 14},
        "size": {"type": "number", "default": 3},
        "sprite_scale": {"type": "number", "default": 3},
        "pose": {"type": "enum", "values": ["smile", "joy", "neutral", "worry"], "default": "smile"},
    },
    "requires": ["PyQt6.QtGui", "recipes/qt/pixel_sprite.py alongside it"],
    "signature": None,
    "snippet": (
        "from acorn_hoard import pixmap, layout, capacity\n"
        "label.setPixmap(pixmap(14))\n"
        "if layout(n)['overflow']:\n"
        "    ...  # say the number in text too"
    ),
}
