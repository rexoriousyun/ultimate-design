import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

/**
 * Geometry that renders fine and is wrong.
 *
 * The render gate proves a recipe painted something; it cannot prove the something is right.
 * blob-shape shipped pinched vases through every version of that gate. Where a recipe's output
 * has a checkable ground truth, this is where it gets checked.
 *
 * Lat/lon is the clearest case: the polar angle is measured from the north pole and latitude
 * is measured from the equator, so using latitude directly puts everything on the wrong
 * hemisphere — and on a featureless wireframe sphere that looks completely plausible. Real
 * great-circle distances are the ground truth that plausibility cannot fake.
 */
function loadRecipe(file, exportName) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', file), 'utf8');
  const win = {};
  // The recipes are browser IIFEs taking `window`; hand them a bare object. They only touch
  // `global.UI` (absent here, so registration is skipped) and their own export.
  new Function('global', 'matchMedia', src.replace(/\}\)\(window\);\s*$/, '})(global);'))(win, undefined);
  return win[exportName];
}

describe('three-wireframe-globe: lat/lon to 3D', () => {
  const THREE = require('three');
  const globe = loadRecipe('three-wireframe-globe.js', 'UIThreeWireframeGlobe');
  const at = (lat, lon) => globe.latLonToVector3(THREE, lat, lon, 1);
  const chord = (a, b) => at(a[0], a[1]).distanceTo(at(b[0], b[1]));

  const SEOUL = [37.57, 126.98];
  const TOKYO = [35.68, 139.69];
  const LONDON = [51.51, -0.13];
  const NEW_YORK = [40.71, -74.01];
  const SYDNEY = [-33.87, 151.21];
  const NAIROBI = [-1.29, 36.82];

  it('puts every point on the sphere', () => {
    for (const [lat, lon] of [SEOUL, LONDON, SYDNEY, [90, 0], [-90, 180]]) {
      expect(at(lat, lon).length()).toBeCloseTo(1, 6);
    }
  });

  it('puts the poles at the poles, two radii apart', () => {
    expect(at(90, 0).y).toBeCloseTo(1, 6);
    expect(at(-90, 0).y).toBeCloseTo(-1, 6);
    expect(chord([90, 0], [-90, 0])).toBeCloseTo(2, 6);
  });

  it('puts southern latitudes south and the equator at zero', () => {
    // What using latitude as the polar angle directly would break, invisibly.
    expect(at(SYDNEY[0], SYDNEY[1]).y).toBeLessThan(0);
    expect(Math.abs(at(NAIROBI[0], NAIROBI[1]).y)).toBeLessThan(0.03);
  });

  it('reproduces real great-circle distances as chords on the unit sphere', () => {
    // chord = 2 * sin(greatCircleKm / 6371 / 2). Ground truth no plausible-looking wrong
    // formula reproduces: a mirrored or hemisphere-flipped globe fails these outright.
    const expected = (km) => 2 * Math.sin(km / 6371 / 2);
    expect(chord(SEOUL, TOKYO)).toBeCloseTo(expected(1160), 2);
    expect(chord(LONDON, NEW_YORK)).toBeCloseTo(expected(5570), 2);
    expect(chord(SEOUL, SYDNEY)).toBeCloseTo(expected(8300), 2);
  });

  it('does not collapse longitude — two cities at the same latitude stay apart', () => {
    expect(chord([0, 0], [0, 90])).toBeCloseTo(Math.SQRT2, 6);
    expect(chord([0, 0], [0, 180])).toBeCloseTo(2, 6);
  });
});

describe('blob-shape: the closed curve', () => {
  const blob = loadRecipe('blob-shape.js', 'UIBlobShape');

  it('is reproducible for a given seed — a blob you cannot repeat cannot be designed with', () => {
    expect(blob.path({ seed: 7 })).toBe(blob.path({ seed: 7 }));
    expect(blob.path({ seed: 7 })).not.toBe(blob.path({ seed: 8 }));
  });

  it('closes, and emits one cubic segment per vertex', () => {
    const d = blob.path({ seed: 7, points: 6 });
    expect(d.trim().endsWith('Z')).toBe(true);
    expect((d.match(/ C /g) ?? []).length).toBe(6);
  });

  it('keeps every control handle tangent to the circle, which is what stops the cusps', () => {
    // The bug that shipped: both handle signs were flipped, so the curve still closed and
    // still painted — as a pinched vase. A tangent handle is perpendicular to the radius, so
    // its dot product with the outward normal is zero. A flipped sign inverts the handle
    // and leaves it perpendicular too, so the real tell is direction: the leading handle at
    // vertex i must point toward the NEXT vertex, not away from it.
    const size = 200;
    const points = 6;
    const d = blob.path({ seed: 7, points, size, wobble: 0 });
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    // M x y, then per segment: C c1x c1y c2x c2y px py
    const start = { x: nums[0], y: nums[1] };
    const verts = [start];
    const lead = [];
    for (let i = 0; i < points; i++) {
      const o = 2 + i * 6;
      lead.push({ x: nums[o], y: nums[o + 1] });
      verts.push({ x: nums[o + 4], y: nums[o + 5] });
    }
    for (let i = 0; i < points; i++) {
      const from = verts[i];
      const to = verts[i + 1];
      const handle = { x: lead[i].x - from.x, y: lead[i].y - from.y };
      const forward = { x: to.x - from.x, y: to.y - from.y };
      expect(handle.x * forward.x + handle.y * forward.y).toBeGreaterThan(0);
    }
  });
});
