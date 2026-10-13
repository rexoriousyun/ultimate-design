/**
 * The tier-2 shelf as a browsable, recommendable catalogue.
 *
 * Tier 2 already existed as a library to *copy from* once you knew what you wanted. This is
 * the other half of the question Rex asked: given a shelf of SVG/canvas/three techniques,
 * can the thing help you decide what to reach for in the first place?
 *
 * That is a different job from the gate. The gate answers "is this wrong". Ideation answers
 * "what could this be" — so it is deliberately a browse-and-filter surface with a screenshot
 * per entry, not a check. Nothing here binds anything.
 *
 * Recommendation lives in rank.js (shared with Ultimate Design's browser): the ask is matched
 * against the intent index (recipes/web/intents.json, what each recipe is for) before the
 * recipe's own label and description, and every result shows the words that matched. A
 * shallow ranker that shows its reasoning is more useful to a person choosing between six
 * options than a confident opaque score over a shelf this size.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readManifest } from './manifest.js';
import { readQtManifest } from './qtManifest.js';
import { addedDates, addedDateFor } from './added.js';

import { rankByIntent } from './rank.js';

/** The intent index: what each web recipe is for (PLAN.md phase 4). */
export function readIntents(repoRoot) {
  const file = path.join(repoRoot, 'recipes', 'web', 'intents.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).intents : {};
}

/**
 * Every recipe on both shelves, with its screenshot when one has been rendered.
 *
 * @param {string} repoRoot
 * @returns {{id: string, platform: 'web'|'qt', primitive: string, label: string,
 *            description: string, source: string, snippet: string, requires: string[],
 *            props: object, screenshot: string|null, ports: string|null}[]}
 */
export function listTechniques(repoRoot) {
  const out = [];
  // One git call for both shelves. See engine/recipes/added.js for why this is not mtime.
  const added = addedDates(repoRoot);

  const webDir = path.join(repoRoot, 'recipes', 'web');
  const web = readManifest(webDir);
  const intents = readIntents(repoRoot);
  for (const c of web?.components ?? []) {
    const shot = path.join(webDir, 'screenshots', `${c.id}.png`);
    out.push({
      id: c.id,
      platform: 'web',
      primitive: c.primitive,
      label: c.label ?? c.id,
      description: c.description ?? '',
      source: c.source,
      snippet: c.snippet ?? '',
      requires: c.requires ?? [],
      props: c.props ?? {},
      intents: intents[c.id] ?? [],
      // Relative to the repo root so a server can map it to a URL without knowing this layout.
      screenshot: fs.existsSync(shot) ? `recipes/web/screenshots/${c.id}.png` : null,
      added: addedDateFor(added, c.source),
      ports: null,
    });
  }

  const qtDir = path.join(repoRoot, 'recipes', 'qt');
  const qt = readQtManifest(qtDir);
  for (const c of qt?.components ?? []) {
    const shot = path.join(qtDir, 'screenshots', `${c.id}.png`);
    out.push({
      id: c.id,
      platform: 'qt',
      primitive: c.primitive,
      label: c.label ?? c.id,
      description: c.description ?? '',
      source: c.source,
      snippet: c.snippet ?? '',
      requires: c.requires ?? [],
      props: c.props ?? {},
      screenshot: fs.existsSync(shot) ? `recipes/qt/screenshots/${c.id}.png` : null,
      added: addedDateFor(added, c.source),
      ports: c.ports ?? null,
    });
  }

  return out.sort((a, b) => a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
}

/** Distinct primitives present, for a filter row. */
export function primitivesOf(techniques) {
  return [...new Set(techniques.map((t) => t.primitive))].sort();
}

/**
 * Ranks techniques against a free-text intent, showing which words matched.
 *
 * @param {object[]} techniques
 * @param {string} intent
 * @returns {{technique: object, score: number, matched: string[]}[]} Only non-zero scores,
 *   best first. An empty result is a real answer — "the shelf has nothing for this" is more
 *   useful than the least-bad of six irrelevant options.
 */
export function recommend(techniques, intent) {
  return rankByIntent(techniques, intent);
}
