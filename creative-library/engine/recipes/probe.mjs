/**
 * A first-pass probe before parameter maps are written: sweeps every declared prop of every
 * recipe with generic values (×0.5, ×1, ×2 of a number's default; both booleans; every enum
 * value; two contrasting colours or strings) into a scratch directory, and prints which
 * props move the image. It finds props that preview() drops, and props a still frame cannot
 * show, before anyone writes prose about them. Evidence it writes is throwaway; the committed
 * evidence comes from `npm run sweep` over the authored maps.
 *
 * Usage: node engine/recipes/probe.mjs <scratchDir> [ids…]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readManifest } from './manifest.js';
import { openShelf, sweepRecipe } from './sweep.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'recipes', 'web');
const [scratch, ...ids] = process.argv.slice(2);

function genericSweep(p) {
  if (p.type === 'boolean') return [false, true];
  if (p.type === 'enum' && p.values) return p.values;
  if (p.type === 'color') return ['#14532d', '#d9ff1e', '#ff3d2e'];
  if (p.type === 'string') return ['A', 'A much longer label'];
  if (p.type === 'array') return [[{ label: 'a', value: 1 }, { label: 'b', value: 5 }], [{ label: 'a', value: 5 }, { label: 'b', value: 1 }, { label: 'c', value: 3 }]];
  if (typeof p.default === 'number') {
    const d = p.default;
    return d === 0 ? [0, 5, 20] : [d * 0.5, d, d * 2];
  }
  return null;
}

const shelf = await openShelf(WEB);
try {
  for (const recipe of readManifest(WEB).components.filter((c) => !ids.length || ids.includes(c.id))) {
    const props = Object.fromEntries(Object.entries(recipe.props).map(([k, p]) => {
      const sweep = genericSweep(p);
      return [k, sweep ? { ...p, sweep, unswept: undefined, identical: undefined } : { ...p, unswept: 'no generic values' }];
    }));
    try {
      const report = await sweepRecipe(shelf, { ...recipe, props }, scratch);
      const line = Object.entries(report.params).map(([k, p]) => `${k}:${p.verdict === 'effective' ? 'ok' : p.verdict.toUpperCase()}${p.steps ? `(${p.steps.map((s) => (s * 100).toFixed(1)).join('/')})` : ''}`);
      console.log(`${recipe.id}  ${line.join('  ')}`);
    } catch (err) {
      console.log(`${recipe.id}  FAILED ${err.message}`);
    }
  }
} finally {
  await shelf.close();
}
