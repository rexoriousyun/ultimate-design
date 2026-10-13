"""Monoline stroke icon set for Qt — the Qt half of recipes/web/icon.js.

The artwork is the SAME artwork: identical 24x24 viewBox path data, identical 1.75 stroke
width. Qt renders it through QSvgRenderer instead of handing an <svg> string to a browser,
so the *delivery* differs and the *design* does not. That is the strongest form of a recipe
travelling between platforms, and it is why this one survived the port when three of its
shelf-mates did not — see docs/qt-port-log.md.

The path data is duplicated here rather than imported across the language boundary, because
recipes are copied, not imported: a Qt project takes this file and nothing else. The
duplication is guarded — engine/recipes/qt.test.js asserts both files define the same icon
names and the same path data, so drift fails a test instead of going unnoticed.

Usage:
    from icon import pixmap, qicon
    label.setPixmap(pixmap("cube", size=20, color="#26221c"))
    button.setIcon(qicon("check", color="#1d7a5f"))
"""

STROKE = 1.75

# name -> inner markup (viewBox 0 0 24 24). Byte-identical to recipes/web/icon.js's ICONS.
ICONS = {
    'cube': '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
    'layers': '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M2 13l10 5 10-5"/><path d="M2 18l10 5 10-5"/>',
    'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    'chart': '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/><path d="M2 20h20"/>',
    'image': '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.75"/><path d="M21 16l-5.5-5.5L6 20"/>',
    'terminal': '<rect x="2.5" y="4" width="19" height="16" rx="1.5"/><path d="M6.5 9.5 10 12l-3.5 2.5"/><path d="M12.5 15.5h5"/>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="1.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/>',
    'check': '<path d="M4 12.5 9.5 18 20 6"/>',
    'chevronRight': '<path d="M9 5.5 16 12l-7 6.5"/>',
    'externalLink': '<path d="M10 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V14"/><path d="M14 4h6v6"/><path d="M20 4 10.5 13.5"/>',
    'github': '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.53 9.53 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/>',
    'box': '<path d="M21 8v8a1 1 0 0 1-.5.87l-8 4.5a1 1 0 0 1-1 0l-8-4.5A1 1 0 0 1 3 16V8a1 1 0 0 1 .5-.87l8-4.5a1 1 0 0 1 1 0l8 4.5A1 1 0 0 1 21 8Z"/><path d="M3.27 7.13 12 12l8.73-4.87"/><path d="M12 22V12"/>',
    'sparkle': '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/><circle cx="12" cy="12" r="3"/>',
    'cursor': '<path d="M5 3l5.5 15.5 2-6.5 6.5-2L5 3Z"/>',
}


def svg(name, size=20, color="#000000"):
    """The full SVG document for one icon.

    `color` is explicit rather than `currentColor`: QSvgRenderer has no CSS cascade to
    inherit from, so the browser recipe's `stroke="currentColor"` would render black no
    matter what the surrounding palette says. Passing the colour in is the Qt-shaped way to
    keep the same "icon takes the colour of its context" behaviour.
    """
    body = ICONS.get(name)
    if body is None:
        return ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 24 24" '
        'fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
        'stroke-linejoin="round">%s</svg>'
    ) % (size, size, color, STROKE, body)


def pixmap(name, size=20, color="#000000", dpr=1.0):
    """Renders to a QPixmap at the given device pixel ratio, so the icon stays crisp on a
    HiDPI screen rather than being upscaled from a 1x raster."""
    from PyQt6.QtCore import QRectF, Qt
    from PyQt6.QtGui import QPainter, QPixmap
    from PyQt6.QtSvg import QSvgRenderer

    markup = svg(name, size=size, color=color)
    if not markup:
        return QPixmap()

    renderer = QSvgRenderer(markup.encode("utf-8"))
    pm = QPixmap(int(size * dpr), int(size * dpr))
    pm.setDevicePixelRatio(dpr)
    pm.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    # Explicit target rect in LOGICAL coordinates. render(painter) with no bounds leans on
    # the painter viewport interacting with devicePixelRatio, and at dpr=2 that drew the
    # icon at a fraction of its size in the corner — 30 painted pixels against 247 at dpr=1,
    # for artwork that should simply scale. Naming the rect removes the interaction.
    renderer.render(painter, QRectF(0, 0, float(size), float(size)))
    painter.end()
    return pm


def qicon(name, size=20, color="#000000"):
    from PyQt6.QtGui import QIcon

    return QIcon(pixmap(name, size=size, color=color))


def names():
    return list(ICONS.keys())


def demo(width=520, height=180, color="#26221c", background="#ffffff"):
    """Renders the whole set to a QPixmap — the Qt analogue of the web recipes' demo(container).

    `npm run render` calls this, screenshots it, and fails the recipe if it paints
    nothing. That gate exists because the first version of pixmap() produced a perfectly valid
    QPixmap containing 10 lit pixels at dpr=2: no exception, no error, essentially blank. A
    recipe that runs and paints nothing is the normal way a copied construction rots, and only
    looking at the output catches it.
    """
    from PyQt6.QtCore import Qt
    from PyQt6.QtGui import QColor, QPainter, QPixmap

    pm = QPixmap(width, height)
    pm.fill(QColor(background))
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

    size, pad, cols = 28, 18, 7
    for i, name in enumerate(ICONS):
        col, row = i % cols, i // cols
        x = pad + col * (size + pad)
        y = pad + row * (size + pad + 10)
        painter.drawPixmap(x, y, pixmap(name, size=size, color=color))
    painter.end()
    return pm


RECIPE = {
    "id": "icon",
    "primitive": "svg",
    "label": "Icon",
    "source": "recipes/qt/icon.py",
    "export": "icon",
    "description": (
        "Monoline stroke icon set, 24x24 viewBox, rendered via QSvgRenderer. "
        "Same artwork as the web recipe."
    ),
    "ports": "recipes/web/icon.js",
    "props": {
        "name": {"type": "enum", "values": list(ICONS.keys())},
        "size": {"type": "number", "default": 20},
        "color": {"type": "color", "default": "#000000"},
    },
    "requires": ["PyQt6.QtSvg"],
    "signature": None,
    "snippet": (
        'from icon import pixmap, qicon\n'
        'label.setPixmap(pixmap("cube", size=20, color="#26221c"))\n'
        'button.setIcon(qicon("check", color="#1d7a5f"))'
    ),
}
