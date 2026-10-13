/**
 * Pixel sprite — a character defined as a row-map of characters, blitted to canvas.
 *
 * Ported from Dotori's squirrel companion design doc, which states the contract plainly:
 * "the canvas blit is the canonical renderer; sprites/*.png are exports of these row-maps."
 * The sprite is source, not an asset. That inversion is the whole technique.
 *
 * A sprite is an array of equal-length strings, one character per pixel, each character a key
 * into a palette. `.` is transparent. What it buys you over shipping PNGs:
 *
 *   - **Variants are data, not files.** A blink, a worried brow, a pushed-out belly are pixel
 *     patches applied to a base map. Eight moods cost eight small functions instead of eight
 *     images, eight requests, and eight things to keep in sync when the character changes.
 *   - **It diffs.** A row-map change shows up in review as the pixels that moved. A PNG shows
 *     up as "binary file changed".
 *   - **Recolour is a palette swap.** One object, every pose.
 *
 * ## The two things that must be right
 *
 * **Blit through an offscreen buffer, then scale once.** The naive renderer paints one
 * `fillRect` per pixel at final size — 1,024 of them per frame for a 32×32, per sprite. This
 * paints them once into a 32×32 offscreen canvas at 1px each and `drawImage`s that up in a
 * single call. Same output, one draw.
 *
 * **`imageSmoothingEnabled = false`, on the destination context.** Without it the browser
 * interpolates the upscale and the pixel art turns to mush — it is the single mistake that
 * makes a correct sprite look broken, and it must be set on the context you draw *to*, not
 * the offscreen one.
 *
 * ## Accessibility
 *
 * A canvas has no text and no DOM inside it, so a sprite carrying meaning — a mood, a state —
 * is invisible to assistive tech and to this repo's own `contrast-minimum` check, which reads
 * computed styles. `mount` therefore requires the canvas to be labelled: it sets `role="img"`
 * and an `aria-label` from the pose, and takes an override. A decorative sprite passes
 * `decorative: true` and gets `aria-hidden` instead. There is no unlabelled third option.
 *
 * Under prefers-reduced-motion the idle blink loop does not start; the sprite renders once.
 *
 * Usage: const s = UIPixelSprite.mount(canvasEl, { pose: 'smile', scale: 4 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  // Dotori's palette. One object; every pose reads through it, so a recolour is a one-line
  // change rather than a re-export of every sprite.
  const PALETTE = {
    Y: '#e8a13d', K: '#f8d9bc', E: '#441d0e', B: '#763e23', C: '#925c42', D: '#a16445',
    O: '#c26431', P: '#dd885e', q: '#dab299', W: '#feefdc', A: '#b87654', T: '#5f9fd6',
    S: '#1c1713', G: '#59b389', a: '#b06f2b', h: '#6f451d',
  };

  const POSES = {
    neutral: [
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
    plead: [
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
    joy: [
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
    shock: [
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
    smile: [
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
    cry: [
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
    worry: [
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
    chubBase: [
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
    ],  };

  // ---------------------------------------------------------------------------
  // Pixel patching. Every function returns a NEW row-map — the base poses are never
  // mutated, so a variant can be composed from another variant without the two fighting.
  // ---------------------------------------------------------------------------

  /** Set one pixel, returning a copy of the map. */
  function pset(rows, r, c, ch) {
    if (r < 0 || r >= rows.length) return rows;
    const out = rows.slice();
    const row = out[r];
    if (c < 0 || c >= row.length) return out;
    out[r] = row.slice(0, c) + ch + row.slice(c + 1);
    return out;
  }

  /** Apply a list of [row, col, char] edits in order. */
  function patch(rows, edits) {
    return (edits || []).reduce((acc, e) => pset(acc, e[0], e[1], e[2]), rows);
  }

  // Where the eyes live in this 32x32 character. Named once rather than repeated as magic
  // numbers across every mood.
  const EYES_TOP = [[11, 16], [11, 17], [11, 25], [11, 26]];
  const EYES_BOTTOM = [[12, 16], [12, 17], [12, 25], [12, 26]];
  const BROWS = [[10, 16], [10, 17], [10, 25], [10, 26]];
  const TEARS = [[13, 17], [14, 17], [13, 26], [14, 26]];

  const MOODS = {
    /** Lids down: the top eye row takes the fur colour. */
    blink: (rows) => patch(rows, EYES_TOP.map(([r, c]) => [r, c, 'K'])),
    worried: (rows) => patch(rows, BROWS.map(([r, c]) => [r, c, 'E'])),
    despair: (rows) => patch(patch(rows, BROWS.map(([r, c]) => [r, c, 'E'])), TEARS.map(([r, c]) => [r, c, 'T'])),
    sleep: (rows) => patch(
      patch(rows, EYES_TOP.concat(EYES_BOTTOM).map(([r, c]) => [r, c, 'K'])),
      EYES_BOTTOM.map(([r, c]) => [r, c, 'E']),
    ),
    /** A visor of dark pixels across both eyes. */
    fire: (rows) => {
      let out = rows;
      for (let c = 15; c <= 28; c++) {
        out = pset(out, 11, c, 'S');
        if ((c >= 15 && c <= 18) || (c >= 24 && c <= 27)) out = pset(out, 12, c, 'S');
      }
      return out;
    },
  };

  function rightEdge(row) {
    let i = row.length - 1;
    while (i >= 0 && row[i] === '.') i--;
    return i;
  }

  /**
   * Push the silhouette out a few pixels at cheek and belly rows — the "chub" state.
   *
   * This is the part that shows what a row-map is really for. Widening a character is a loop
   * over rows here; with PNG assets it is a second full set of exports for every pose.
   */
  function chubify(rows) {
    let out = rows.slice();
    for (const r of [9, 10, 11, 12, 13, 14, 15, 16]) {
      const last = rightEdge(out[r]);
      if (last < 31) {
        const inner = out[r][last - 1];
        out = pset(out, r, last + 1, 'E');
        out = pset(out, r, last, inner === '.' ? 'K' : inner);
      }
    }
    for (const r of [19, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
      const last = rightEdge(out[r]);
      if (last < 30) {
        const inner = out[r][last - 1];
        out = pset(out, r, last + 2, 'E');
        out = pset(out, r, last + 1, inner === '.' ? 'K' : inner);
        out = pset(out, r, last, inner === '.' ? 'K' : inner);
      }
    }
    return patch(out, [[14, 14, 'q'], [14, 15, 'q'], [15, 14, 'q'], [24, 14, 'q'], [25, 14, 'q']]);
  }

  // The doc's "chub" pose is the base map run through the widener, not a separate drawing.
  // Derived once at load so it is a pose like any other, and so the widening is exercised
  // every time the shelf renders rather than only when someone calls chubify by hand.
  POSES.chub = chubify(POSES.chubBase);

  // ---------------------------------------------------------------------------
  // Expression overlays. These are the rest of Dotori's generative track: states the
  // character enters that are edits to a pose rather than drawings of their own. Kept as code
  // because that is the point of holding the sprite as source — a new expression is a handful
  // of coordinates, not another export.
  //
  // Each takes a row-map and returns a new one, so they compose: shock(chubify(POSES.joy)) is
  // a valid, never-drawn sprite.
  // ---------------------------------------------------------------------------

  /** Wide wet eyes with a tear that alternates side. `phase` drives the tear; step it to animate. */
  function plead(rows, phase) {
    let out = patch(rows, [[11, 15, 'E'], [12, 15, 'E'], [11, 24, 'E'], [12, 24, 'E']]);
    out = patch(out, [[11, 15, 'W'], [11, 24, 'W'], [12, 17, 'W'], [12, 26, 'W']]);
    out = patch(out, [[10, 17, 'E'], [10, 26, 'E']]);
    const tears = (phase || 0) % 2 === 0 ? [[13, 15], [13, 24]] : [[13, 16], [13, 25]];
    return patch(out, tears.map(([r, c]) => [r, c, 'T']));
  }

  /** Pupil-less saucer eyes — the "forty-two dollars?!" face. */
  function shock(rows) {
    let out = patch(rows, [
      [11, 16, 'K'], [11, 17, 'K'], [12, 16, 'K'], [12, 17, 'K'],
      [11, 25, 'K'], [11, 26, 'K'], [12, 25, 'K'], [12, 26, 'K'],
    ]);
    out = patch(out, [[10, 15, 'E'], [10, 17, 'E'], [11, 16, 'E'], [12, 15, 'E'], [12, 17, 'E']]);
    out = patch(out, [[10, 24, 'E'], [10, 26, 'E'], [11, 25, 'E'], [12, 24, 'E'], [12, 26, 'E']]);
    return patch(out, [
      [10, 16, 'K'], [11, 15, 'K'], [11, 17, 'K'], [12, 16, 'K'],
      [10, 25, 'K'], [11, 24, 'K'], [11, 26, 'K'], [12, 25, 'K'],
    ]);
  }

  /** Empty paws and max-white eyeballs: the acorn has just been dropped. */
  function acornDrop(rows) {
    const paws = [
      [24, 21], [24, 22], [24, 23],
      [25, 21], [25, 22], [25, 23], [25, 24],
      [26, 20], [26, 21], [26, 22], [26, 23], [26, 24],
      [27, 20], [27, 21], [27, 22], [27, 23], [27, 24],
    ];
    let out = patch(rows, paws.map(([r, c]) => [r, c, 'K']));
    // Both eyes, built from the same four-row stamp at two column offsets.
    [[16, 19], [24, 27]].forEach(([c0, c1]) => {
      out = patch(out, [
        [10, c0, 'K'], [10, c0 + 1, 'E'], [10, c0 + 2, 'E'], [10, c1, 'K'],
        [11, c0, 'E'], [11, c0 + 1, 'W'], [11, c0 + 2, 'W'], [11, c1, 'E'],
        [12, c0, 'E'], [12, c0 + 1, 'W'], [12, c0 + 2, 'W'], [12, c1, 'E'],
        [13, c0, 'K'], [13, c0 + 1, 'E'], [13, c0 + 2, 'E'], [13, c1, 'K'],
      ]);
    });
    return patch(out, [[0, 20, 'Y'], [0, 21, 'Y']]);
  }

  const OVERLAYS = { plead, shock, acornDrop };

  // ---------------------------------------------------------------------------
  // Procedural props, drawn onto the canvas after the sprite rather than into the row-map.
  // A row-map is a fixed grid; these are things whose position or count varies, so they are
  // generated instead. Same reason the sprite is code: an acorn is nine fillRects, not a file.
  // ---------------------------------------------------------------------------

  /** One acorn: cap, body, taper. `s` is the pixel size, so it scales with the sprite. */
  function drawAcorn(ctx, x, y, s, palette) {
    const pal = palette || PALETTE;
    ctx.fillStyle = pal.h;
    ctx.fillRect(x + s, y, s * 2, s);
    ctx.fillStyle = pal.a;
    ctx.fillRect(x, y + s, s * 4, s);
    ctx.fillRect(x + s, y + s * 2, s * 2, s);
    return { width: s * 4, height: s * 3 };
  }

  /** Two rising Z glyphs, offset by `phase`. Drawn in pixels so they match the sprite's grid. */
  function drawZzz(ctx, x, y, phase, palette) {
    const pal = palette || PALETTE;
    const t = (phase || 0) % 3;
    ctx.fillStyle = pal.B;
    const Z = (zx, zy, s) => {
      [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]]
        .forEach(([c, r]) => ctx.fillRect(zx + c * s, zy + r * s, s, s));
    };
    Z(x - 26, y + 30 - t * 4, 3);
    Z(x - 14, y + 16 - t * 5, 4);
  }

  /** Four glints around the sprite; call on alternate phases so they twinkle. */
  function drawSparkle(ctx, ox, oy, px, palette) {
    const pal = palette || PALETTE;
    ctx.fillStyle = pal.G;
    [[1, 4], [30, 6], [2, 14]].forEach(([c, r]) => ctx.fillRect(ox + c * px, oy + r * px, px * 0.7, px * 0.7));
    ctx.fillStyle = pal.W;
    ctx.fillRect(ox + 29 * px, oy + 2 * px, px * 0.6, px * 0.6);
  }


  // ---------------------------------------------------------------------------
  // Rendering.
  // ---------------------------------------------------------------------------

  let scratch = null;

  /**
   * Paint `rows` into `ctx` at `scale` device-independent pixels per sprite pixel.
   *
   * One fillRect per pixel into a 1:1 offscreen buffer, then a single scaled drawImage. The
   * offscreen canvas is module-level and reused: allocating one per frame is the other way
   * people make this slow.
   */
  function blit(ctx, rows, opts) {
    const o = opts || {};
    const palette = o.palette || PALETTE;
    const scale = o.scale == null ? 4 : o.scale;
    const ox = o.ox || 0;
    const oy = o.oy || 0;
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;

    if (!scratch) scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext('2d');
    sctx.clearRect(0, 0, w, h);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const colour = palette[row[c]];
        // Any character absent from the palette — '.' by convention — is transparent.
        if (colour) {
          sctx.fillStyle = colour;
          sctx.fillRect(c, r, 1, 1);
        }
      }
    }

    // On the destination, and before the draw. This is the line that decides whether the
    // result is pixel art or a blurry smear.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, ox, oy, w * scale, h * scale);
    return { width: w * scale, height: h * scale };
  }

  const POSE_LABEL = {
    neutral: 'calm', smile: 'content', joy: 'delighted', worry: 'worried',
    cry: 'distraught', shock: 'shocked', plead: 'pleading', chub: 'well-fed',
  };

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts] pose, scale, mood, palette, animate, decorative, label, name
   */
  function mount(canvas, opts) {
    const o = opts || {};
    const scale = o.scale == null ? 4 : o.scale;
    const palette = o.palette || PALETTE;
    const name = o.name || 'The companion';
    let pose = POSES[o.pose] ? o.pose : 'neutral';
    let mood = o.mood || null;

    // No unlabelled third option: it either means something and is named, or it is decoration
    // and is hidden. A canvas carries no text for a screen reader to fall back on.
    if (o.decorative) {
      canvas.setAttribute('aria-hidden', 'true');
    } else {
      canvas.setAttribute('role', 'img');
    }

    function label() {
      if (o.label) return o.label;
      return `${name} looks ${POSE_LABEL[pose] || pose}`;
    }

    let blinking = false;
    let raf = null;
    let phase = 0;
    let overlay = o.overlay || null;
    const props = o.props || [];

    function paint() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const rows0 = POSES[pose];
      // Order matters and is deliberate: the overlay is an expression the character is
      // wearing, so it goes on before a mood tint and before a blink can close the eyes it
      // just opened wide.
      let rows = overlay && OVERLAYS[overlay] ? OVERLAYS[overlay](rows0, phase) : rows0;
      if (mood && MOODS[mood]) rows = MOODS[mood](rows);
      if (blinking) rows = MOODS.blink(rows);

      const w = Math.max(...rows0.map((r) => r.length));
      const h = rows0.length;
      canvas.width = Math.round(w * scale * dpr);
      canvas.height = Math.round(h * scale * dpr);
      canvas.style.width = `${w * scale}px`;
      canvas.style.height = `${h * scale}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w * scale, h * scale);
      blit(ctx, rows, { palette, scale });

      // Procedural props on top of the sprite. Declared by name so a caller does not have to
      // reach for the draw functions to get the common cases.
      if (props.includes('sparkle') && phase % 2 === 0) drawSparkle(ctx, 0, 0, scale, palette);
      if (props.includes('zzz')) drawZzz(ctx, w * scale, 0, phase, palette);
      if (props.includes('acorn')) {
        const bounce = [0, 8, 15, 12, 15][phase % 5];
        drawAcorn(ctx, w * scale * 0.62, h * scale - 10 + bounce * 0.4, scale * 0.75, palette);
      }

      if (!o.decorative) canvas.setAttribute('aria-label', label());
    }

    // Idle blink: open for a beat, shut briefly. Driven off a timestamp rather than a frame
    // count so it reads the same on a 60Hz and a 120Hz display.
    function tick(now) {
      const cycle = now % 4200;
      const shut = cycle > 3900;
      // Props and the plead tear step on their own slow beat; repainting only when something
      // actually changed keeps an idle sprite from redrawing sixty times a second.
      const nextPhase = Math.floor(now / 700);
      const moved = (props.length > 0 || overlay === 'plead') && nextPhase !== phase;
      if (shut !== blinking || moved) {
        blinking = shut;
        phase = nextPhase;
        paint();
      }
      raf = requestAnimationFrame(tick);
    }

    paint();
    if (o.animate && !REDUCED()) raf = requestAnimationFrame(tick);

    return {
      set(next) {
        const n = next || {};
        if (n.pose && POSES[n.pose]) pose = n.pose;
        if ('mood' in n) mood = n.mood;
        if ('overlay' in n) overlay = n.overlay;
        paint();
      },
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
      },
    };
  }

  global.UIPixelSprite = {
    mount, blit, pset, patch, chubify,
    plead, shock, acornDrop,
    drawAcorn, drawZzz, drawSparkle,
    POSES, PALETTE, MOODS, OVERLAYS,
    poses: Object.keys(POSES),
    moods: Object.keys(MOODS),
    overlays: Object.keys(OVERLAYS),
  };

  if (global.UI) {
    function makeCanvas(container, w, h) {
      const cv = document.createElement('canvas');
      cv.style.display = 'block';
      container.appendChild(cv);
      return cv;
    }

    global.UI.define({
      id: 'pixel-sprite',
      primitive: 'canvas',
      label: 'Pixel sprite',
      source: 'recipes/web/pixel-sprite.js',
      export: 'UIPixelSprite',
      description:
        'Character sprites as row-maps blitted to canvas — variants are pixel patches, not extra PNGs. Crisp at any integer scale.',
      props: {
        pose: {
          type: 'enum',
          values: ['neutral', 'smile', 'joy', 'worry', 'cry', 'shock', 'plead', 'chub'],
          default: 'smile',
          controls: 'The character\'s expression and body: each is a pixel patch on one base map.',
          sweep: ['neutral', 'smile', 'joy', 'worry', 'cry', 'shock', 'plead', 'chub'],
          cost: 'none',
        },
        mood: {
          type: 'enum', values: ['none', 'blink', 'worried', 'despair', 'sleep', 'fire'], default: 'none',
          controls: 'An overlay on the pose: a worried brow, a despair cloud, sleep, fire. Blink is an animation and shows only in motion.',
          sweep: ['none', 'worried', 'despair', 'sleep', 'fire'],
          cost: 'none',
        },
        scale: {
          type: 'number', default: 4,
          controls: 'Whole-pixel scale of the sprite. Integers only stay crisp.',
          range: [1, 8], sweep: [1, 2, 4, 6, 8],
          breaks: { below: 'Fractional scales blur or skip pixel rows; keep it an integer.' },
          cost: 'one drawImage at any scale',
        },
        animate: {
          type: 'boolean', default: true,
          controls: 'Whether idle animations (blinks, bobbing) run.',
          unswept: 'motion: under reduced motion the sprite holds still, as designed, so no still frame shows it',
        },
      },
      snippet:
        "const sprite = UIPixelSprite.mount(canvasEl, {\n  pose: 'smile',\n  scale: 4,\n  animate: true,           // idle blink; stops under prefers-reduced-motion\n  name: 'Peanut',          // becomes the aria-label\n});\n\nsprite.set({ pose: 'worry', mood: 'worried' });\n\n// Or compose a variant yourself — every patch returns a new map:\nconst chubby = UIPixelSprite.chubify(UIPixelSprite.POSES.joy);",
      preview(container, props) {
        const p = props || {};
        const cv = makeCanvas(container);
        const sprite = mount(cv, {
          pose: p.pose,
          mood: p.mood === 'none' ? null : p.mood,
          scale: p.scale,
          animate: p.animate,
          name: 'Peanut',
        });
        return { destroy() { sprite.destroy(); container.innerHTML = ''; } };
      },
      demo(container) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end';
        container.appendChild(wrap);

        const sprites = [];
        // Every pose, from one 32x32 map each plus patches — the argument for the technique.
        ['joy', 'smile', 'worry', 'cry', 'shock', 'chub'].forEach((pose) => {
          const cell = document.createElement('figure');
          cell.style.cssText = 'margin:0;display:grid;gap:4px;justify-items:center';
          const cv = makeCanvas(cell);
          const cap = document.createElement('figcaption');
          cap.textContent = pose;
          cap.style.cssText = 'font-size:0.78rem;color:#3d443d';
          cell.appendChild(cap);
          wrap.appendChild(cell);
          sprites.push(mount(cv, { pose, scale: 3, animate: true, name: 'Peanut' }));
        });

        return { destroy() { sprites.forEach((s) => s.destroy()); container.innerHTML = ''; } };
      },
    });
  }
})(window);
