import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * pixel-sprite's row-map layer, tested without a browser.
 *
 * The interesting failure here is silent. A character that is not in the palette renders as
 * transparent, so a typo in a 32×32 map punches an invisible hole rather than throwing — and
 * the render gate happily reports a sprite that painted. These assert the maps are well-formed
 * and that every patch returns a new map instead of mutating the shared base, which is the
 * bug that would make one pose corrupt another at runtime.
 */
function loadRecipe(file, exportName) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', file), 'utf8');
  const win = {};
  // `document` is only touched inside blit()/mount(), which these tests do not call.
  new Function('global', src.replace(/\}\)\(window\);\s*$/, '})(global);'))(win);
  return win[exportName];
}

const sprite = loadRecipe('pixel-sprite.js', 'UIPixelSprite');

describe('the committed row-maps', () => {
  it('ships every pose the props enum offers', () => {
    for (const pose of ['neutral', 'smile', 'joy', 'worry', 'cry', 'shock', 'plead', 'chub']) {
      expect(sprite.POSES[pose], pose).toBeTruthy();
    }
  });

  it('is a rectangle — every row the same length', () => {
    for (const [name, rows] of Object.entries(sprite.POSES)) {
      const widths = new Set(rows.map((r) => r.length));
      expect(widths.size, `${name} has ragged rows: ${[...widths].join(', ')}`).toBe(1);
    }
  });

  it('uses only characters the palette can paint, so no pixel is silently transparent', () => {
    // The one that matters. An unknown character is not an error at runtime — it just does
    // not draw, leaving a hole nobody notices until the sprite is on screen at 4x.
    const known = new Set([...Object.keys(sprite.PALETTE), '.']);
    const bad = [];
    for (const [name, rows] of Object.entries(sprite.POSES)) {
      rows.forEach((row, r) => {
        for (const ch of row) if (!known.has(ch)) bad.push(`${name} row ${r}: '${ch}'`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('actually draws something — a map of nothing but transparency would still "render"', () => {
    for (const [name, rows] of Object.entries(sprite.POSES)) {
      const painted = rows.join('').split('').filter((c) => c !== '.').length;
      expect(painted, name).toBeGreaterThan(100);
    }
  });
});

describe('pset / patch — never mutate the shared base', () => {
  it('returns a new map and leaves the original untouched', () => {
    const before = sprite.POSES.neutral;
    const snapshot = before.slice();
    const after = sprite.pset(before, 5, 5, 'E');
    expect(after).not.toBe(before);
    expect(before).toEqual(snapshot);
    expect(after[5][5]).toBe('E');
  });

  it('applies a list of edits in order', () => {
    const out = sprite.patch(sprite.POSES.neutral, [[3, 3, 'E'], [3, 3, 'K'], [4, 4, 'B']]);
    expect(out[3][3]).toBe('K');
    expect(out[4][4]).toBe('B');
  });

  it('ignores an out-of-range edit rather than corrupting the row length', () => {
    const rows = sprite.POSES.neutral;
    const wide = sprite.pset(rows, 0, 999, 'E');
    const tall = sprite.pset(rows, 999, 0, 'E');
    expect(wide[0].length).toBe(rows[0].length);
    expect(tall).toEqual(rows);
  });

  it('leaves row width unchanged for an in-range edit', () => {
    const out = sprite.pset(sprite.POSES.neutral, 10, 10, 'E');
    expect(out[10].length).toBe(sprite.POSES.neutral[10].length);
  });
});

describe('moods compose onto any pose', () => {
  it('blink closes the top eye row without touching the rest', () => {
    const base = sprite.POSES.smile;
    const blinked = sprite.MOODS.blink(base);
    expect(blinked).not.toEqual(base);
    // Only row 11 changes.
    blinked.forEach((row, r) => {
      if (r !== 11) expect(row, `row ${r}`).toBe(base[r]);
    });
  });

  it('every mood returns a well-formed map for every pose', () => {
    const known = new Set([...Object.keys(sprite.PALETTE), '.']);
    for (const [poseName, rows] of Object.entries(sprite.POSES)) {
      for (const [moodName, fn] of Object.entries(sprite.MOODS)) {
        const out = fn(rows);
        expect(out.length, `${poseName}/${moodName}`).toBe(rows.length);
        expect(new Set(out.map((r) => r.length)).size, `${poseName}/${moodName} ragged`).toBe(1);
        for (const row of out) {
          for (const ch of row) expect(known.has(ch), `${poseName}/${moodName}: '${ch}'`).toBe(true);
        }
      }
    }
  });
});

describe('chubify — widening as a row operation', () => {
  it('makes the silhouette strictly wider, never narrower', () => {
    const base = sprite.POSES.chubBase;
    const fat = sprite.chubify(base);
    const edge = (row) => { let i = row.length - 1; while (i >= 0 && row[i] === '.') i--; return i; };
    let widened = 0;
    fat.forEach((row, r) => {
      expect(edge(row), `row ${r} narrowed`).toBeGreaterThanOrEqual(edge(base[r]));
      if (edge(row) > edge(base[r])) widened++;
    });
    expect(widened).toBeGreaterThan(5);
  });

  it('keeps the map rectangular and inside its 32 columns', () => {
    const fat = sprite.chubify(sprite.POSES.chubBase);
    expect(new Set(fat.map((r) => r.length)).size).toBe(1);
    expect(fat[0].length).toBe(32);
  });

  it('does not mutate the base it widened', () => {
    const base = sprite.POSES.chubBase;
    const snapshot = base.slice();
    sprite.chubify(base);
    expect(base).toEqual(snapshot);
  });

  it('is what the shipped chub pose is made of', () => {
    // Asserted so the pose cannot drift into a hand-drawn second map, which is the exact
    // duplication the technique exists to avoid.
    expect(sprite.POSES.chub).toEqual(sprite.chubify(sprite.POSES.chubBase));
  });
});

describe('expression overlays — the rest of the generative track', () => {
  const known = new Set([...Object.keys(sprite.PALETTE), '.']);

  function wellFormed(rows, label) {
    expect(rows.length, label).toBe(32);
    expect(new Set(rows.map((r) => r.length)).size, `${label} ragged`).toBe(1);
    for (const row of rows) for (const ch of row) expect(known.has(ch), `${label}: '${ch}'`).toBe(true);
  }

  it('every overlay returns a well-formed map for every pose', () => {
    for (const [poseName, rows] of Object.entries(sprite.POSES)) {
      for (const [name, fn] of Object.entries(sprite.OVERLAYS)) {
        wellFormed(fn(rows, 0), `${poseName}/${name}`);
      }
    }
  });

  it('composes with the other patches, which is the point of returning new maps', () => {
    // Never drawn by hand and never needs to be: a widened, shocked, joyful squirrel.
    wellFormed(sprite.shock(sprite.chubify(sprite.POSES.joy)), 'shock(chubify(joy))');
  });

  it('leaves the base pose untouched', () => {
    const base = sprite.POSES.neutral;
    const snapshot = base.slice();
    sprite.plead(base, 0);
    sprite.shock(base);
    sprite.acornDrop(base);
    expect(base).toEqual(snapshot);
  });

  it('plead alternates its tear with the phase, so it animates without a second map', () => {
    const a = sprite.plead(sprite.POSES.neutral, 0);
    const b = sprite.plead(sprite.POSES.neutral, 1);
    expect(a).not.toEqual(b);
    // Only the tear row differs.
    a.forEach((row, r) => { if (r !== 13) expect(row, `row ${r}`).toBe(b[r]); });
  });

  it('acornDrop empties the paws — the acorn is gone, not redrawn elsewhere', () => {
    const before = sprite.POSES.shock;
    const after = sprite.acornDrop(before);
    const changed = after.filter((row, r) => row !== before[r]).length;
    expect(changed).toBeGreaterThan(3);
  });
});

describe('acorn-hoard — a count drawn as a pile', () => {
  const hoard = loadRecipe('acorn-hoard.js', 'UIAcornHoard');

  it('fills rows bottom-up at the declared capacities', () => {
    const perRow = (n) => {
      const counts = {};
      hoard.layout(n, { size: 3 }).items.forEach((i) => { counts[i.row] = (counts[i.row] ?? 0) + 1; });
      return counts;
    };
    expect(perRow(7)).toEqual({ 0: 7 });
    expect(perRow(8)).toEqual({ 0: 7, 1: 1 });
    expect(perRow(24)).toEqual({ 0: 7, 1: 6, 2: 5, 3: 4, 4: 2 });
  });

  it('centres every row on the widest span, not on itself', () => {
    // Centring each row on its own width makes the stack shuffle sideways as it fills.
    const plan = hoard.layout(24, { size: 3 });
    const itemW = 3 * 4 + 2;
    const byRow = {};
    plan.items.forEach((i) => { (byRow[i.row] ??= []).push(i.x); });
    for (const xs of Object.values(byRow)) {
      expect((Math.min(...xs) + Math.max(...xs) + itemW) / 2).toBeCloseTo(plan.width / 2, 6);
    }
  });

  it('is monotonic — more acorns is never a shorter pile', () => {
    let previous = 0;
    for (let n = 0; n <= hoard.capacity(); n++) {
      const height = Math.abs(hoard.layout(n, { size: 3 }).pileTop);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  it('reports overflow rather than silently stopping the count', () => {
    // A pile that quietly caps is a chart that lies; the caller needs to know to print the
    // number in text.
    expect(hoard.layout(hoard.capacity(), { size: 3 }).overflow).toBe(0);
    expect(hoard.layout(hoard.capacity() + 6, { size: 3 }).overflow).toBe(6);
  });

  it('draws nothing for zero, and does not crash', () => {
    const plan = hoard.layout(0, { size: 3 });
    expect(plan.items).toEqual([]);
    expect(plan.rowsUsed).toBe(0);
    expect(plan.pileTop).toBe(0);
  });
});
