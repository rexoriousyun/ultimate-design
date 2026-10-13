#!/usr/bin/env node
/**
 * The corpus toolchain, lifted out of design-substrate's `substrate recipes <sub>` when the
 * library split off. Same three verbs, same behaviour, one level shallower — this repo has
 * nothing else to dispatch, so there is no outer command to nest under.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'recipes', 'web');
const QT_DIR = path.join(ROOT, 'recipes', 'qt');
const SKILL_DIR = path.join(ROOT, 'skill');
const WADA_DIR = path.join(ROOT, 'palettes', 'wada');

function printUsage() {
  console.error(
    'usage: recipes <sync|render|harvest|sweep>\n' +
      '  sync                      regenerate recipes/<shelf>/manifest.json from UI.define(),\n' +
      '                            and the skill shelf files from those manifests\n' +
      '  render                    run every recipe demo, commit a screenshot, fail on blank\n' +
      '  harvest <url> --id <kebab-id> [--selector <css>]\n' +
      '                            scaffold a new recipe from a page — output is NOT yet a recipe\n' +
      '  sweep [ids…]              sweep each mapped prop, write recipes/web/sweeps/ evidence\n' +
      '  sweep --floor [ids…]      measure noise floors only; --check: is the evidence current',
  );
}

async function sync() {
  const { writeManifest, readManifest } = await import('./recipes/manifest.js');
  const { writeShelf } = await import('./recipes/shelf.js');
  const { path: file, changed } = await writeManifest(WEB_DIR);
  console.log(changed ? `regenerated ${file}` : `${file} already matches the recipe sources`);
  const shelf = writeShelf(SKILL_DIR, 'web', readManifest(WEB_DIR));
  console.log(shelf.changed ? `regenerated ${shelf.path}` : `${shelf.path} already matches the manifest`);
  const { writeIndex } = await import('./palettes/wada.js');
  const wada = writeIndex(WADA_DIR);
  console.log(wada.changed ? `regenerated ${wada.path}` : `${wada.path} already matches colors.json`);

  // The Qt shelf is generated the same way, from the same command — a second sync step
  // people have to remember is a second thing that drifts.
  const { writeQtManifest, readQtManifest } = await import('./recipes/qtManifest.js');
  try {
    const qt = writeQtManifest(QT_DIR);
    console.log(qt.changed ? `regenerated ${qt.path}` : `${qt.path} already matches the recipe sources`);
    const qtShelf = writeShelf(SKILL_DIR, 'qt', readQtManifest(QT_DIR));
    console.log(qtShelf.changed ? `regenerated ${qtShelf.path}` : `${qtShelf.path} already matches the manifest`);
  } catch (err) {
    // No python3 is a legitimate environment, not a failed sync: the web half is already
    // written and correct. Say what was skipped rather than failing the whole command.
    console.error(`Qt recipes not synced — ${err.message}`);
  }
}

async function render() {
  const { renderRecipes } = await import('./recipes/render.js');
  for (const r of await renderRecipes(WEB_DIR)) {
    console.log(`  [${r.status}] ${r.id} — ${r.status === 'rendered' ? r.screenshot : r.reason}`);
  }

  // The Qt shelf gets the same gate — a recipe that runs and paints nothing is the same
  // failure on either platform.
  const { renderQtRecipes } = await import('./recipes/qtRender.js');
  const qt = renderQtRecipes(QT_DIR);
  if (qt.unavailable) {
    console.error(`  Qt recipes not rendered — ${qt.unavailable}`);
    return;
  }
  for (const r of qt.results) {
    console.log(`  [${r.status}] ${r.id} (qt) — ${r.status === 'rendered' ? r.screenshot : r.reason}`);
  }
}

async function harvestCmd(rest) {
  const url = rest.find((a) => !a.startsWith('--'));
  const idFlag = rest.indexOf('--id');
  const selFlag = rest.indexOf('--selector');
  if (!url || idFlag === -1) {
    console.error('usage: recipes harvest <url> --id <kebab-id> [--selector <css>]');
    process.exit(2);
    return;
  }

  const { harvest, writeScaffold } = await import('./recipes/harvest.js');
  const h = await harvest(url, {
    id: rest[idFlag + 1],
    selector: selFlag === -1 ? undefined : rest[selFlag + 1],
  });
  const { path: file } = writeScaffold(WEB_DIR, h, new Date().toISOString().slice(0, 10));
  console.log(
    `scaffolded ${file}\n\n` +
      'This is NOT yet a recipe. Reduce the captured markup to the construction itself, make\n' +
      'demo() paint something, then run `npm run sync && npm run render`.',
  );
}

/**
 * `sweep [ids…]` sweeps each mapped prop and writes recipes/web/sweeps/<id>.json and strips;
 * `sweep --floor [ids…]` only measures noise floors (all recipes: also writes floors.json);
 * `sweep --check` is the staleness gate, no browser. Exits non-zero on any failure.
 */
async function sweepCmd(rest) {
  const { openShelf, measureFloor, sweepRecipe, failuresOf, checkEvidence, THRESHOLDS } = await import('./recipes/sweep.js');
  const { readManifest } = await import('./recipes/manifest.js');
  const sweepsDir = path.join(WEB_DIR, 'sweeps');
  if (rest.includes('--check')) {
    const problems = checkEvidence(WEB_DIR, sweepsDir);
    for (const p of problems) console.error(`  ${p}`);
    console.log(problems.length ? `${problems.length} problem(s)` : 'every recipe has a current, passing parameter map');
    process.exit(problems.length ? 1 : 0);
  }
  const ids = rest.filter((a) => !a.startsWith('--'));
  const recipes = readManifest(WEB_DIR).components.filter((c) => !ids.length || ids.includes(c.id));
  const shelf = await openShelf(WEB_DIR);
  let failed = 0;
  try {
    if (rest.includes('--floor')) {
      const floors = {};
      for (const recipe of recipes) {
        try {
          floors[recipe.id] = (await measureFloor(shelf, recipe)).floor;
          const mark = floors[recipe.id] >= THRESHOLDS.MIN_EFFECT ? '  UNSWEEPABLE' : '';
          console.log(`  ${(floors[recipe.id] * 100).toFixed(3).padStart(8)}%  ${recipe.id}${mark}`);
        } catch (err) {
          failed += 1;
          console.log(`  [failed] ${recipe.id} — ${err.message}`);
        }
      }
      if (!ids.length) {
        fs.mkdirSync(sweepsDir, { recursive: true });
        fs.writeFileSync(path.join(sweepsDir, 'floors.json'), `${JSON.stringify({
          generatedBy: 'recipes sweep --floor', thresholds: THRESHOLDS, floors }, null, 2)}\n`);
      }
      process.exitCode = failed ? 1 : 0;
      return;
    }
    for (const recipe of recipes) {
      let report;
      try {
        report = await sweepRecipe(shelf, recipe, sweepsDir);
      } catch (err) {
        failed += 1;
        console.log(`  [failed] ${recipe.id} — ${err.message}`);
        continue;
      }
      console.log(`${recipe.id}  floor ${(report.noiseFloor * 100).toFixed(3)}%  ${report.status}`);
      for (const [name, p] of Object.entries(report.params)) {
        const detail = p.steps ? `steps ${p.steps.map((s) => (s * 100).toFixed(1)).join(' ')}` : (p.reason ?? '');
        console.log(`  ${p.verdict.padEnd(11)} ${name}  ${detail}`);
      }
      const failures = failuresOf(report);
      failed += failures.length;
      for (const f of failures) console.log(`  FAIL ${f}`);
    }
  } finally {
    await shelf.close();
  }
  process.exitCode = failed ? 1 : 0;
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'sync':
    await sync();
    break;
  case 'render':
    await render();
    break;
  case 'harvest':
    await harvestCmd(rest);
    break;
  case 'sweep':
    await sweepCmd(rest);
    break;
  default:
    printUsage();
    process.exit(2);
}
