import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * companion-perch's placement rules, tested without a browser.
 *
 * The recipe injects its DOM probe precisely so this is possible, and the rules are where the
 * value is: "never covers content" and "same key, same perch" are claims, and a claim in a
 * docstring is worth what it costs to write. The render gate can only say a sprite appeared
 * somewhere — it cannot say it appeared somewhere legal.
 */
function loadRecipe(file, exportName) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', file), 'utf8');
  const win = {};
  new Function('global', src.replace(/\}\)\(window\);\s*$/, '})(global);'))(win);
  return win[exportName];
}

const perch = loadRecipe('companion-perch.js', 'UICompanionPerch');

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

const VIEWPORT_H = 900;
const OPTS = { spriteSize: 64, pad: 10, topGuard: 0 };

describe('makeRng — same key, same perch', () => {
  it('is deterministic for a given key', () => {
    const a = perch.makeRng('/dashboard');
    const b = perch.makeRng('/dashboard');
    const seqA = [a(10), a(10), a(10)];
    const seqB = [b(10), b(10), b(10)];
    expect(seqA).toEqual(seqB);
  });

  it('differs across keys, so a route change moves it', () => {
    const a = perch.makeRng('/dashboard');
    const b = perch.makeRng('/settings');
    expect([a(100), a(100), a(100)]).not.toEqual([b(100), b(100), b(100)]);
  });

  it('never returns an out-of-range index, including for n = 0', () => {
    const r = perch.makeRng('x');
    for (let i = 0; i < 200; i++) expect(r(5)).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 50; i++) expect(r(5)).toBeLessThan(5);
    expect(r(0)).toBe(0);
  });
});

describe('isViableHost — reject before probing', () => {
  it('rejects anything that cannot contain a whole sprite', () => {
    expect(perch.isViableHost(rect(0, 0, 120, 200), 64)).toBe(false);
    expect(perch.isViableHost(rect(0, 0, 400, 60), 64)).toBe(false);
  });

  it('accepts a roomy card', () => {
    expect(perch.isViableHost(rect(0, 0, 400, 220), 64)).toBe(true);
  });
});

describe('scoreHost — the never-cover-content rule', () => {
  const free = () => true;
  const blocked = () => false;

  it('returns null when every probe hits content, rather than placing anyway', () => {
    // The line the port changed from the prototype: no loosening pass, so a text-dense card
    // yields nothing at all instead of a sprite sitting on the text.
    expect(perch.scoreHost(rect(0, 100, 400, 220), blocked, VIEWPORT_H, OPTS)).toBeNull();
  });

  it('returns footholds when the host is clear', () => {
    const s = perch.scoreHost(rect(0, 100, 400, 220), free, VIEWPORT_H, OPTS);
    expect(s.spots.length).toBe(7);
    expect(s.score).toBeGreaterThan(0);
  });

  it('returns null when the host is too short for a body above its foot line', () => {
    expect(perch.scoreHost(rect(0, 100, 400, 70), free, VIEWPORT_H, OPTS)).toBeNull();
  });

  it('returns null when the host is too narrow to span', () => {
    expect(perch.scoreHost(rect(0, 100, 80, 220), free, VIEWPORT_H, OPTS)).toBeNull();
  });

  it('probes a column of rows up the body, not just the foot line', () => {
    // The sampling that makes the difference on a text card: a single-row probe lands in the
    // gap between two lines and reports clear.
    const ys = new Set();
    perch.scoreHost(rect(0, 100, 400, 220), (x, y) => { ys.add(y); return true; }, VIEWPORT_H, OPTS);
    expect(ys.size).toBeGreaterThan(3);
  });

  it('caps width so a full-bleed container cannot out-score a roomy card', () => {
    const wide = perch.scoreHost(rect(0, 100, 1600, 220), free, VIEWPORT_H, OPTS);
    const capped = perch.scoreHost(rect(0, 100, 900, 220), free, VIEWPORT_H, OPTS);
    expect(wide.score).toBeCloseTo(capped.score, 6);
  });
});

describe('rankHosts', () => {
  const hosts = [
    { el: 'small', rect: rect(0, 100, 300, 160) },
    { el: 'big', rect: rect(0, 100, 700, 300) },
  ];

  it('ranks the roomier host first', () => {
    const ranked = perch.rankHosts(hosts, () => true, VIEWPORT_H, OPTS);
    expect(ranked[0].host.el).toBe('big');
  });

  it('returns empty when nothing has room — "no companion" is a real answer', () => {
    expect(perch.rankHosts(hosts, () => false, VIEWPORT_H, OPTS)).toEqual([]);
  });

  it('drops only the hosts whose own probe fails', () => {
    const ranked = perch.rankHosts(hosts, (host) => host.el === 'small', VIEWPORT_H, OPTS);
    expect(ranked.map((r) => r.host.el)).toEqual(['small']);
  });
});

describe('placeAt — stays inside its host', () => {
  const host = rect(100, 200, 400, 220);

  it('clamps a foothold past the right edge back inside', () => {
    const { left } = perch.placeAt(host, 9999, VIEWPORT_H, OPTS);
    expect(left + 64).toBeLessThanOrEqual(host.right - 10);
  });

  it('clamps a foothold past the left edge back inside', () => {
    expect(perch.placeAt(host, -9999, VIEWPORT_H, OPTS).left).toBeGreaterThanOrEqual(host.left + 10);
  });

  it('sits the sprite above the host foot line, never below it', () => {
    const { top } = perch.placeAt(host, 200, VIEWPORT_H, OPTS);
    expect(top + 64).toBeLessThanOrEqual(host.bottom);
    expect(top).toBeGreaterThanOrEqual(host.top);
  });

  it('uses the viewport bottom when the host runs off-screen', () => {
    const tall = rect(100, 200, 400, 5000);
    expect(perch.placeAt(tall, 200, VIEWPORT_H, OPTS).top + 64).toBeLessThanOrEqual(VIEWPORT_H);
  });
});

describe('choosePerches', () => {
  const ranked = ['a', 'b', 'c', 'd'].map((el, i) => ({ host: { el }, spots: [0], score: 10 - i }));

  it('never picks the same host twice', () => {
    const out = perch.choosePerches(ranked, 3, perch.makeRng('k'));
    expect(new Set(out.map((o) => o.host.el)).size).toBe(3);
  });

  it('takes the best remaining for every perch after the first', () => {
    // Only the first varies, so a second companion is never a worse host than a third.
    const out = perch.choosePerches(ranked, 3, perch.makeRng('k'));
    expect(out[1].score).toBeGreaterThanOrEqual(out[2].score);
  });

  it('returns fewer than asked rather than repeating when the pool runs out', () => {
    expect(perch.choosePerches(ranked.slice(0, 2), 5, perch.makeRng('k'))).toHaveLength(2);
  });

  it('returns nothing when nothing ranked', () => {
    expect(perch.choosePerches([], 2, perch.makeRng('k'))).toEqual([]);
  });
});
