"""Pixel sprite for Qt — the Qt half of recipes/web/pixel-sprite.js.

The sprite is the SAME sprite: byte-identical row-maps, identical 16-colour palette. Only
the delivery differs. That is what made this one worth porting when six shelf-mates could
not cross at all (docs/qt-port-log.md): the technique is a data format plus two rendering
decisions, and neither is a web idea.

The two decisions carry over exactly:

    Blit through a 1:1 buffer, then scale once. The web version paints into a 32x32
    offscreen canvas and calls drawImage; here it writes a 32x32 QImage and calls
    drawImage on the painter. Either way one scaled draw, not 1,024 filled rects at
    final size.

    Turn interpolation OFF on the destination. In a browser that is
    `ctx.imageSmoothingEnabled = false`; in Qt it is leaving SmoothPixmapTransform unset
    (and Antialiasing off for the blit). Set either one and the upscale is interpolated
    and the pixel art turns to mush — the same single mistake, in two dialects.

Row-maps are duplicated here rather than imported across the language boundary, because
recipes are copied, not imported: a Qt project takes this file and nothing else. The
duplication is guarded — engine/recipes/qtPixelSprite.test.js asserts both files carry the
same palette and the same pixels, so drift fails a test instead of going unnoticed.

Usage:
    from pixel_sprite import pixmap, POSES
    label.setPixmap(pixmap("smile", scale=4))
"""

PALETTE = {
    'Y': '#e8a13d',
    'K': '#f8d9bc',
    'E': '#441d0e',
    'B': '#763e23',
    'C': '#925c42',
    'D': '#a16445',
    'O': '#c26431',
    'P': '#dd885e',
    'q': '#dab299',
    'W': '#feefdc',
    'A': '#b87654',
    'T': '#5f9fd6',
    'S': '#1c1713',
    'G': '#59b389',
    'a': '#b06f2b',
    'h': '#6f451d',
}

POSES = {
    'neutral': [
        '................................',
        '................................',
        '...............E..........E.....',
        '..............PCE........ECP....',
        '.....EEEEE....POC........BCP....',
        '...EEAAAAAEE..POCEEEEEEEEEEP....',
        '..EAACCCCCAAE.EECCCCCCCCCCEE....',
        '.EACCCCCCCCCAEECCBBCCCCCCBCE....',
        '.ECCCCCCCCCCCEBBBKKBCCCCBKBB....',
        'ECCCCBBBCCCCCEBKKKKKBCCBKKKKE...',
        'ECCBBDDDBCCCCEBKKKKKBCCBKKKKBE..',
        'EBCBDEDDDBCCBEBKEWKKKCCKKEWKBE..',
        'EBBDBBEDDBCCEqKKEEKKKCCKKEEKKE..',
        '.EBBBBEDDBCBEKKKEEKKKOOKKEEKKKE.',
        '..EBBBEDDBCEqKKKKKKKKKEKKKKKKKE.',
        '...EEEDDDBCEqKKKKKKKEEqEKKKKKKE.',
        '.....EDDDBCBEqKKKKKKKKKKKKKKKE..',
        '....EDDDBBBBBEqKKKKKKKKKKKKKE...',
        '...EEDDDBBBBBBEEqqqKKKEKKqqE....',
        '...EDDDBBBBBBBBBEEEqqEEqEEE.....',
        '...EDDDBBBBBBBBEBEqEEDCEBE......',
        '...EDDDDBBBBBBBECCEECBBBECE.....',
        '...EDDDDBBBBBBEBBCCCEOOECCE.....',
        '...EBDDDBBBBBEBCBEEEOPOCEE......',
        '...EBDDDBBBBBEBCEqKKEOOEKBE.....',
        '....EBDDDBBBBECCCBEKKEEKKBCE....',
        '....EBBDDDBBBECCCCEKKKKKKBCE....',
        '.....EEBBDDBBEBCCCEKKKKKqBBE....',
        '.......EBBBBBEBCCBEqKKKqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'plead': [
        '................................',
        '................................',
        '...............E..........E.....',
        '..............PCE........ECP....',
        '.....EEEEE....POC........BCP....',
        '...EEAAAAAEE..POCEEEEEEEEEEP....',
        '..EAACCCCCAAE.EECCCCCCCCCCEE....',
        '.EACCCCCCCCCAEECCEECCCCCCECE....',
        '.ECCCCCCCCCCCEBEEKKECCCCEKEE....',
        'ECCCCBBBCCCCCEEKKKKKECCEKKKKE...',
        'ECCBBDDDBCCCCEEKKKEKECCEKEKKEE..',
        'EBCBDEDDDBCCBEEKEEWKKEEKKWEKEE..',
        'EBBDBBEDDBCCEqKKEEEKKEEKKEEKKE..',
        '.EBBBBEDDBCEEKKKKTTKKBOqKTTKKKE.',
        '..EBBBEDDBCEqKKKTKKKKKEKKKKTKKE.',
        '...EEEDDDBCEqKKTKKKKKEKEKKKKTKE.',
        '.....EDDDBCBEqKKKKKKKKKKKKKKqE..',
        '....EDDDBBBBBEqqTKKKKKKKKKKqE...',
        '...EEDDDBBBBBBEEqqqKKKEKKqqE....',
        '...EDDDBBBBBBBBBEEEqqEBqEEE.....',
        '...EDDDBBBBBBBBEBEqEEADEBE......',
        '...EDDDDBBBBBBBECCEEDBBBECE.....',
        '...EDDDDBBBBBBEBBCCCEOOECCE.....',
        '...EBDDDBBBBBEBCBEEEPPOOEE......',
        '...EBDDDBBBBBEBCEqKKEPOEKEE.....',
        '....EBDDDBBBBECCCBEKKEEKKECE....',
        '....EBBDDDBBBECCCCEKKKKKKECE....',
        '.....EEBBDDBBEBCCCEKKKKKqEBE....',
        '.......EBBBBBEBCCBEqKKKqEBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'joy': [
        '................................',
        '................................',
        '...............E..........E.....',
        '..............PCE........ECP....',
        '.....EEEEE....POC........BCP....',
        '...EEPPPPPEE..POCEEEEEEEEBEP....',
        '..EPPCCCCCPPE.BECCCCCCCCCCEB....',
        '.EPCCCCCCCCCPEECCBBCCCCCCBCE....',
        '.ECCCCCCCCCCCEBBBKKBCCCCBKBE....',
        'EPCCCBBBCCCCCEBKKKKKBCCBKKKKE...',
        'ECCBBDDDBCCCCEBKKKKKBCCBKKKKEE..',
        'EBCBDEDDDBCCBEBKKEKKKBBKKEKKBE..',
        'EBBCBBEDDBCCECKKEKEKKBBKEKEKKE..',
        '.EBBBBEDDBCEEKKKKKKKKOOKKKKKKKE.',
        '..EBBBEDDBCEqKKKKKKEKKEKEKKKKKE.',
        '...EEEDDDBCEqKKKKKKqEEqEAKKKKqE.',
        '.....EDDDBCBEEKKKKKKAKKAKKKKEE..',
        '....EDDDBBBEKKEKKKKKKAAKKKKEKKE.',
        '...EEDDDBBBEAKCEqqKKKKKKKqECKDE.',
        '...EDDDBBBBBEBCCEEEqqqqqEECCBE..',
        '...EDDDBBBBBBEBCCBBqqqqqBCCBE...',
        '...EDDDDBBBBBBEBCCCKKKKKCCBE....',
        '...EDDDDBBBBBBEBCCKKKKKKqBE.....',
        '...EBDDDBBBBBEBCCCKKKKKKKE......',
        '...EBDDDBBBBBEBCEqKKKKKKKBE.....',
        '....EBDDDBBBBECCCEKKKKKKKBDE....',
        '....EBBDDDBBBECCCCEKKKKKKBDE....',
        '.....EEBBDDBBEBCCCEKKKKKqBBE....',
        '.......EBBBBBEBCCBEqKKKqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'shock': [
        '................................',
        '....................YY..........',
        '...............E..........E.....',
        '..............PCE...YY...ECP....',
        '.....EEEEE....POC........BCP....',
        '...EEAAAAAEE..POCEEEEEEEEBEP....',
        '..EAACCCCCAAE.EECCCCCCCCCCEE....',
        '.EACCCCCCCCCAEECCBBCCCCCCBCE....',
        '.ECCCCCCCCCCCEBBBKKBCCCCBKBE....',
        'ECCCCBBBCCCCCEBKKKKKBCCBKKKqE...',
        'ECCBBDDDBCCCCEBKKEEKBCCBKEEKBE..',
        'EBCBDEDDDBCCBEBKqWWKKCCKEWWEBE..',
        'EBBDBBEDDBCCEqKKWWWEKCCKWEWWKE..',
        '.EBBBBEDDBCCEKKKqWWKKBBKEWWEKKE.',
        '..EBBBEDDBCEqKKKKKKKKKEKKKKKKKE.',
        '...EEEDDDBCEqKKKKKKKKKKKKKKKKKE.',
        '.....EDDDBCBEqKKKKKKKEEKKKKKKE..',
        '....EDDDBBBBBEqKKKKKKEPKKKKKE...',
        '...EEDDDBBBBBBEEqqqKKKKKKqqE....',
        '...EDDDBBBBBBBBBEEEqEqqqEEEEE...',
        '...EDDDBBBBBBBBEBEDEEqqBBEEDDE..',
        '...EDDDDBBBBBBBECCEDDEKKqCCCE...',
        '...EDDDDBBBBBBEBBBBEEKKKqBEE....',
        '...EBDDDBBBBBEBCBEEKKKKqKE......',
        '...EBDDDBBBBBEBCEqKKKEEEKEE.....',
        '....EBDDDBBBBECCCEKKKEBOEBCE....',
        '....EBBDDDBBBECCCCEKEYYBEBCE....',
        '.....EEBBDDBBEBCCCEKKYOOqBBE....',
        '.......EBBBBBEBCCBEqKKEqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'smile': [
        '................................',
        '...............E.........E......',
        '..............OE.........EO.....',
        '..............OCE........ECO....',
        '.....EEEEE....OOCE......ECOO....',
        '...EEAAAAAEE..OOCEEEEEEEEEOO....',
        '..EAACCCCCAAE.OECCCCCCCCCCEO....',
        '.EACCCCCCCCCAEECCBBCCCCCCBCE....',
        '.ECCCCCCCCCCCEBBBKKBCCCCBKBE....',
        'ECCCCBBBCCCCCEBqKKKKBCCBKKKqE...',
        'ECCBBDDDBCCCCEBKKKKKBCCBKKKKBE..',
        'EBCBDEDDDBCCBEBKEKKKKBBKKEKKBE..',
        'EBBDBBEDDBCCEqKKEEKKKBBKKEEKKE..',
        '.EBBBBEDDBCBEKKKDEKKKOOOKDEKKKE.',
        '..EBBBEDDBCEqKKKKKKKKKEKKKKKKKE.',
        '...EEEDDDBCEqKKKKKEKKKqKKEKKKKE.',
        '.....EDDDBCBEqKKKKKEEEEEEKKKKE..',
        '....EADDBBBBBEqKKKKKKKKKKKKKE...',
        '...EBDDDBBBBBBEEqqqKKKKKKqqE....',
        '...EADDBBBBBBBBBEEEqqqqqEEE.....',
        '...EADDBBBBBBBBEBBqqEECEBE......',
        '...EADDDBBBBBBBECCEEBBBBECE.....',
        '...EADDDBBBBBBEBEDCDEOOECCE.....',
        '...EBDDDBBBBBEBCBEEEOPOOEE......',
        '...EBDDDBBBBBEBCEqKKEPPEKBE.....',
        '....EBDDDBBBBECCCBEKKEEKKBCE....',
        '....EBBDDDBBBECCCCEKKKKKKBCE....',
        '.....EEBBDDBBEBCCCEKKKKKqBBE....',
        '.......EBBBBBEBCCBEqKKKqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'cry': [
        '................................',
        '................................',
        '................................',
        '................................',
        '.....EEEEE......................',
        '...EEAAAAAEE.....EEEEEEE........',
        '..EAACCCCCAAE.EEEBCCCCCCEEE.....',
        '.EACCCCCCCCCAEBCCCCCCCCCCCBEE...',
        '.ECCCCCCCCCEECCECCCCCCCCCCCEBE..',
        'ECCCCBBBCCEOOOECCBBBBCCCCBBCEOE.',
        'ECCBBDDDBCCEEEBCBKKKKBCCBKKBEE..',
        'EBCBDEDDDBCCCECBKKKKKBCCBKKKBE..',
        'EBBDBBEDDBCCEBBKKKKEKqCCKEKKqE..',
        '.EBBBBEDDBCCEqKKEEEWKKCCKWEEKE..',
        '..EBBBEDDBCEqKKKTTTTKKOOKTTTKqE.',
        '...EEEDDDBCEqKKKTKKKKKKKKKKTKqE.',
        '.....EDDDBCBEqKKTKKKKKEEKKKTqE..',
        '....EDDDBBBBBEqKTKKKKEKKEKKTE...',
        '...EBDDDBBBBBBEEqKKKKKKKKKqE....',
        '...EDDDBBBBBBBBBEEEqqEEqEEE.....',
        '...EDDDBBBBBBBBEBEqqEBDEBE......',
        '...EDDDDBBBBBBBECCEEDBBBECE.....',
        '...EDDDDBBBBBBEBECCCEOOECCE.....',
        '...EBDDDBBBBBEBCBEEECPOCEE......',
        '...EBDDDBBBBBEBCEqKKEPPEKBE.....',
        '....EBDDDBBBBECCCBEKKEEKKBCE....',
        '....EBBDDDBBBECCCCEKKKKKKBCE....',
        '.....EEBBCCBBEBCCCEKKKKKqBBE....',
        '.......EBBBBBEBCCBEKKKKqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'worry': [
        '................................',
        '................................',
        '.............EEE..........EEEE..',
        '............ECCCE........ECCE...',
        '.....EEEEE....POCE......EBCP....',
        '...EEPAAAAEE..POCEEEEEEEEBOP....',
        '..EAACCCCCAAE.PECCCCCCCCCCEP....',
        '.EACCCCCCCCCAEECCBBCCCCCCBCE....',
        '.ECCCCCCCCCCCEBBBKKBCCCCBKBE....',
        'EACCCBBBCCCCCEBKKKKKBCCBKKKKE...',
        'ECCBBDDDBCCCCEBKKKEKBCCBEKKKEE..',
        'EBCBDEDDDBCCBEBKEEqKKBBKqEEKBE..',
        'EBBCBBEDDBCCECKKKEKKKBBKKEKKKE..',
        '.EBBBBEDDBCEEKKKKBEKKBBKEBKKKKE.',
        '..EBBBEDDBCEKKKKKKKKKOOKKKKKKKE.',
        '...EEEDDDBCEqKKKKKKKKKKKKKKKKqE.',
        '.....EDDDBCBEqKKKKKKEEEKKKKKqE..',
        '....EDDDBBBBBEqKKKKEKKKEKKKqE...',
        '...EEDDDBBBBBBEEqqKKKKKKKqEE....',
        '...EDDDBBBBBBBBBEEBEEqEEEE......',
        '...EDDDBBBBBBBBEBBECCECCECE.....',
        '...EDDDDBBBBBBEBBCCCBEBCCCBE....',
        '...EDDDDBBBBBBEBCCCBEqEBCCBE....',
        '...EBDDDBBBBBEBBECBEqKqEBBE.....',
        '...EBDDDBBBBBEBCBEEqKKKqEEE.....',
        '....EBDDDBBBBECCCEKKKKKKKBDE....',
        '....EBBDDDBBBECCCCEKKKKKKBDE....',
        '.....EEBBDDBBEBCCCEKKKKKqBBE....',
        '.......EBBBBBEBCCBEqKKKqBBE.....',
        '........EEEEEEEBECCEEEEBBCCE....',
        '...............EEEE....EEEE.....',
        '................................',
    ],
    'chubBase': [
        '................................',
        '................................',
        '...............E..........E.....',
        '..............PCE........ECP....',
        '.....EEEEE....POC.EEEEEE.BCP....',
        '...EEPPPPAEE..POCECBEECEBEEP....',
        '..EPACCCCCPPE.EEBCCCBEECBCEE....',
        '.EPCCCCCCCCCPEECCBBCCEECCBCE....',
        '.ECCCCCCCCCCCEBCBKKBCCBCBKBE....',
        'ECCCCBBBCCCCCECBKKKKBCCBKKKBE...',
        'ECCCBDDDBCCCCECKKKKKBCCBKKKKE...',
        'EBCBDEDDDBCCEBBKEWKKKCCCKEWKE...',
        'EBBDBBEDDBCCEKKKEEKKKCCCKEEKKE..',
        '.EBBBBEDDBCECKWWWWWKKBOOKKWWWKE.',
        '..EBBBEDDBCEKWWWWWWWCKEKBWWWWKE.',
        '...EEEDDDBCEKWWWWWWWEEWEKWWWWKE.',
        '.....EDDDBBEEKWWWWWKWWWWKWWWKE..',
        '....EDDDBBEEBEKKKKKWWWWWWKKKE...',
        '...EBDDDBBEBBBEECCKWKKKKKCBE....',
        '...EDDDBBEBBBBCCBKWWWWWWWKBBE...',
        '...EDDDBBEBBBBCCCEWWWEEWWECBE...',
        '...EDDDBBEBBBEBCCCBEBBBBECBBE...',
        '...EDDDBEBBBBBEBBCCCEOPECBBEBE..',
        '...EBDDBEBCCCBBEEEEEOOOOEEEKBE..',
        '...EBDDDEBCCCCEKWWWWEOOEWWWKBE..',
        '....EBDDEBCCCCCEWWWWWEEWWWWKBE..',
        '....EBBCEECCCCCCEWWWWWWWWWKBBE..',
        '.....EEBBEBCCCCCEKWWWWWWWKBBE...',
        '.......EEEEBCCBBEKKKKKKKBEE.....',
        '...........EEBBCCEEEEEEEBBCE....',
        '.............EEEE......EEEE.....',
        '................................',
    ],
}

# --- pixel patching -------------------------------------------------------------------
# Every function returns a NEW row-map. The base poses are never mutated, so a variant can
# be composed from another variant without the two fighting — same contract as the web half.

def pset(rows, r, c, ch):
    """Set one pixel, returning a copy."""
    if r < 0 or r >= len(rows):
        return list(rows)
    out = list(rows)
    row = out[r]
    if c < 0 or c >= len(row):
        return out
    out[r] = row[:c] + ch + row[c + 1:]
    return out


def patch(rows, edits):
    out = list(rows)
    for r, c, ch in edits:
        out = pset(out, r, c, ch)
    return out


EYES_TOP = [(11, 16), (11, 17), (11, 25), (11, 26)]
EYES_BOTTOM = [(12, 16), (12, 17), (12, 25), (12, 26)]
BROWS = [(10, 16), (10, 17), (10, 25), (10, 26)]
TEARS = [(13, 17), (14, 17), (13, 26), (14, 26)]


def _blink(rows):
    return patch(rows, [(r, c, 'K') for r, c in EYES_TOP])


def _worried(rows):
    return patch(rows, [(r, c, 'E') for r, c in BROWS])


def _despair(rows):
    return patch(_worried(rows), [(r, c, 'T') for r, c in TEARS])


def _sleep(rows):
    shut = patch(rows, [(r, c, 'K') for r, c in EYES_TOP + EYES_BOTTOM])
    return patch(shut, [(r, c, 'E') for r, c in EYES_BOTTOM])


def _fire(rows):
    out = list(rows)
    for c in range(15, 29):
        out = pset(out, 11, c, 'S')
        if (15 <= c <= 18) or (24 <= c <= 27):
            out = pset(out, 12, c, 'S')
    return out


MOODS = {
    'blink': _blink,
    'worried': _worried,
    'despair': _despair,
    'sleep': _sleep,
    'fire': _fire,
}


def _right_edge(row):
    i = len(row) - 1
    while i >= 0 and row[i] == '.':
        i -= 1
    return i


def chubify(rows):
    """Push the silhouette out at cheek and belly rows.

    A loop over rows here; with bitmap assets it is a second full set of exports for every
    pose. This is the clearest argument for holding a sprite as data.
    """
    out = list(rows)
    for r in (9, 10, 11, 12, 13, 14, 15, 16):
        last = _right_edge(out[r])
        if last < 31:
            inner = out[r][last - 1]
            out = pset(out, r, last + 1, 'E')
            out = pset(out, r, last, 'K' if inner == '.' else inner)
    for r in (19, 20, 21, 22, 23, 24, 25, 26, 27, 28):
        last = _right_edge(out[r])
        if last < 30:
            inner = out[r][last - 1]
            out = pset(out, r, last + 2, 'E')
            out = pset(out, r, last + 1, 'K' if inner == '.' else inner)
            out = pset(out, r, last, 'K' if inner == '.' else inner)
    return patch(out, [(14, 14, 'q'), (14, 15, 'q'), (15, 14, 'q'), (24, 14, 'q'), (25, 14, 'q')])


# The doc's "chub" is the base map run through the widener, not a separate drawing. Derived
# once at import so it is a pose like any other — and so the widening runs every time.
POSES['chub'] = chubify(POSES['chubBase'])


# --- rendering ------------------------------------------------------------------------

def image(rows, palette=None):
    """The 1:1 buffer: one QImage pixel per sprite pixel, ARGB with transparency."""
    from PyQt6.QtGui import QColor, QImage

    pal = palette or PALETTE
    w = max(len(r) for r in rows)
    h = len(rows)
    img = QImage(w, h, QImage.Format.Format_ARGB32)
    img.fill(QColor(0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            colour = pal.get(ch)
            # Any character absent from the palette — '.' by convention — stays transparent.
            if colour:
                img.setPixelColor(c, r, QColor(colour))
    return img


def pixmap(pose='neutral', scale=4, mood=None, palette=None, rows=None):
    """One sprite, scaled with interpolation off.

    Pass `rows` to render a composed variant — chubify(POSES['joy']) and the like — instead
    of a named pose.
    """
    from PyQt6.QtCore import QRectF
    from PyQt6.QtGui import QPainter, QPixmap

    src = rows if rows is not None else POSES.get(pose, POSES['neutral'])
    if mood and mood in MOODS:
        src = MOODS[mood](src)

    img = image(src, palette)
    pm = QPixmap(img.width() * scale, img.height() * scale)
    pm.fill(_TRANSPARENT())
    painter = QPainter(pm)
    # Both hints stay OFF. SmoothPixmapTransform is Qt's imageSmoothingEnabled, and turning
    # it on is the same mistake in a different dialect: an interpolated upscale of pixel art.
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    # An explicit target rect, for the reason icon.py documents: QSvgRenderer/QPainter
    # geometry left implicit interacts with devicePixelRatio and silently paints almost
    # nothing at dpr=2.
    painter.drawImage(QRectF(0, 0, pm.width(), pm.height()), img)
    painter.end()
    return pm


def _TRANSPARENT():
    from PyQt6.QtCore import Qt
    return Qt.GlobalColor.transparent


def demo(scale=3, background="#f0ece3"):
    """Every pose in one pixmap — what `npm run render` screenshots and gates."""
    from PyQt6.QtGui import QColor, QPainter, QPixmap

    names = [n for n in POSES if n != 'chubBase']
    cols = 4
    cell_w, cell_h, pad = 32 * scale, 32 * scale, 16
    rows_n = (len(names) + cols - 1) // cols
    pm = QPixmap(cols * (cell_w + pad) + pad, rows_n * (cell_h + pad) + pad)
    pm.fill(QColor(background))

    painter = QPainter(pm)
    for i, name in enumerate(names):
        x = pad + (i % cols) * (cell_w + pad)
        y = pad + (i // cols) * (cell_h + pad)
        painter.drawPixmap(x, y, pixmap(name, scale=scale))
    painter.end()
    return pm


RECIPE = {
    "id": "pixel-sprite",
    "primitive": "canvas",
    "label": "Pixel sprite",
    "source": "recipes/qt/pixel_sprite.py",
    "export": "pixel_sprite",
    "description": (
        "Character sprites as row-maps blitted to a QImage and scaled with interpolation "
        "off. Same row-maps and palette as the web recipe."
    ),
    "ports": "recipes/web/pixel-sprite.js",
    "props": {
        "pose": {"type": "enum", "values": [n for n in POSES if n != 'chubBase'], "default": "smile"},
        "mood": {"type": "enum", "values": list(MOODS.keys()), "default": None},
        "scale": {"type": "number", "default": 4},
    },
    "requires": ["PyQt6.QtGui"],
    "signature": None,
    "snippet": (
        'from pixel_sprite import pixmap, POSES, chubify\n'
        'label.setPixmap(pixmap("smile", scale=4))\n'
        'label.setPixmap(pixmap(rows=chubify(POSES["joy"]), scale=4))'
    ),
}
