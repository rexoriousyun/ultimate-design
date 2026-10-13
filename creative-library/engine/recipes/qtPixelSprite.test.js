import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QT_DIR = path.join(REPO_ROOT, 'recipes', 'qt');

/**
 * Cross-language drift guard for the sprite that exists twice.
 *
 * `recipes/qt/pixel_sprite.py` carries a byte-for-byte copy of the web recipe's row-maps and
 * palette, and `acorn_hoard.py` re-implements the pile arithmetic. That duplication is
 * deliberate — recipes are copied, not imported, and a Qt project takes one file — but
 * deliberate duplication still rots. Nothing about editing the JavaScript makes anyone open
 * the Python.
 *
 * So the two are compared directly rather than trusted: same palette, same pixels, same
 * widening, same layout for every count. A change to one side without the other fails here
 * instead of shipping as two characters that quietly stopped being the same character.
 *
 * The pile arithmetic is the more interesting half. It was ported as logic, not as data, so
 * this is the only thing standing between "same rule" and "same-looking rule".
 */

function python3Available() {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skip = !python3Available();

/** Loads a browser-IIFE recipe with a bare object standing in for `window`. */
function loadWeb(file, exportName) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', file), 'utf8');
  const win = {};
  new Function('global', src.replace(/\}\)\(window\);\s*$/, '})(global);'))(win);
  return win[exportName];
}

/** Runs a snippet with recipes/qt on sys.path and returns its parsed JSON stdout. */
function qt(snippet) {
  const program = `import json, sys\nsys.path.insert(0, ${JSON.stringify(QT_DIR)})\n${snippet}`;
  return JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' }));
}

describe.skipIf(skip)('pixel-sprite: the Qt copy matches the web original', () => {
  const web = loadWeb('pixel-sprite.js', 'UIPixelSprite');

  it('uses the same palette, key for key', () => {
    const py = qt('import pixel_sprite as p\nprint(json.dumps(p.PALETTE))');
    expect(py).toEqual(web.PALETTE);
  });

  it('carries the same pixels for every pose', () => {
    // Byte-for-byte. A single character differing is a hole or a wrong colour in one
    // platform's sprite and nothing else would report it.
    const py = qt('import pixel_sprite as p\nprint(json.dumps(p.POSES))');
    expect(Object.keys(py).sort()).toEqual(Object.keys(web.POSES).sort());
    for (const name of Object.keys(web.POSES)) {
      expect(py[name], name).toEqual(web.POSES[name]);
    }
  });

  it('derives the chub pose by widening, on both sides', () => {
    const py = qt("import pixel_sprite as p\nprint(json.dumps(p.chubify(p.POSES['chubBase'])))");
    expect(py).toEqual(web.chubify(web.POSES.chubBase));
    expect(py).toEqual(web.POSES.chub);
  });

  it('produces the same map for every mood on every pose', () => {
    const py = qt(
      'import pixel_sprite as p\n' +
        'out = {n: {m: f(rows) for m, f in p.MOODS.items()} for n, rows in p.POSES.items()}\n' +
        'print(json.dumps(out))',
    );
    for (const [pose, rows] of Object.entries(web.POSES)) {
      for (const [mood, fn] of Object.entries(web.MOODS)) {
        expect(py[pose][mood], `${pose}/${mood}`).toEqual(fn(rows));
      }
    }
  });
});

describe.skipIf(skip)('acorn-hoard: the pile arithmetic agrees across languages', () => {
  const web = loadWeb('acorn-hoard.js', 'UIAcornHoard');

  it('places every item at the same offset, for every count up to overflow', () => {
    // Ported as logic rather than as data, so nothing but this comparison distinguishes
    // "the same rule" from "a rule that looks the same".
    const counts = [0, 1, 7, 8, 13, 14, 22, 24, 30];
    const py = qt(
      'import acorn_hoard as a\n' +
        `print(json.dumps({str(c): a.layout(c, size=3) for c in ${JSON.stringify(counts)}}))`,
    );
    for (const c of counts) {
      const mine = web.layout(c, { size: 3 });
      const theirs = py[String(c)];
      expect(theirs.items.map((i) => [i[0], i[1], i[2]]), `count ${c}`).toEqual(
        mine.items.map((i) => [i.x, i.y, i.row]),
      );
      expect(theirs.rows_used, `count ${c} rows`).toBe(mine.rowsUsed);
      expect(theirs.pile_top, `count ${c} top`).toBe(mine.pileTop);
      expect(theirs.overflow, `count ${c} overflow`).toBe(mine.overflow);
      expect(theirs.width, `count ${c} width`).toBe(mine.width);
    }
  });

  it('agrees on capacity, so both stop being proportional at the same number', () => {
    const py = qt('import acorn_hoard as a\nprint(json.dumps(a.capacity()))');
    expect(py).toBe(web.capacity());
  });
});
