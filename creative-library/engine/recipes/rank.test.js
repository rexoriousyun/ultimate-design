import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseIntent, rankByIntent, stem, words } from './rank.js';
import { listTechniques, readIntents } from './techniques.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'recipes', 'intent-cases.json'), 'utf8')).cases;
const web = listTechniques(ROOT).filter((t) => t.platform === 'web');
const top3 = (intent) => rankByIntent(web, intent).slice(0, 3).map((r) => r.technique.id);

describe('intent index (PLAN.md phase 4)', () => {
  it('describes every web recipe, and only those', () => {
    const indexed = Object.keys(readIntents(ROOT)).sort();
    expect(indexed).toEqual(web.map((t) => t.id).sort());
    expect(web.filter((t) => t.intents.length === 0).map((t) => t.id)).toEqual([]);
  });

  for (const c of CASES.filter((x) => x.expect.length && !x.gap)) {
    it(`"${c.intent}" has a hand-picked recipe in the top 3`, () => {
      const got = top3(c.intent);
      // A miss names what the index or the shelf does not cover. Record it as a gap in
      // intent-cases.json; never edit `expect` to make it pass.
      expect(got.some((id) => c.expect.includes(id)), `top 3 was ${got.join(', ')}`).toBe(true);
    });
  }

  for (const c of CASES.filter((x) => x.gap)) {
    it(`"${c.intent}" is a known gap, still missing`, () => {
      // When this starts passing, the gap is closed: delete the `gap` field.
      expect(top3(c.intent).some((id) => c.expect.includes(id))).toBe(false);
    });
  }

  it('returns nothing for an ask the shelf has no answer to', () => {
    for (const c of CASES.filter((x) => x.expect.length === 0)) expect(rankByIntent(web, c.intent)).toEqual([]);
  });

  it('README intents are among the cases, so the promise in the README is tested', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' '); // wrapped lines
    for (const intent of ['make this feel hand-made', 'add depth without 3D', 'break up a flat field']) {
      expect(readme).toContain(intent);
      expect(CASES.map((c) => c.intent)).toContain(intent);
    }
  });
});

describe('rank.js', () => {
  it('stems plural, past and -ing forms to meet each other', () => {
    expect(stem('printed')).toBe(stem('print'));
    expect(stem('loads')).toBe(stem('loading'));
    expect(stem('shapes')).toBe(stem('shape'));
    expect(stem('glass')).toBe('glass');
  });

  it('splits and joins hyphenated compounds, and keeps 3d', () => {
    expect(words('hand-made')).toEqual(['handmad', 'hand', 'made']);
    expect(words('a 3D object')).toEqual(['3d', 'object']);
  });

  it('turns the words after a negation into a penalty', () => {
    expect(parseIntent('depth without 3D')).toEqual({ wanted: ['depth'], unwanted: ['3d'] });
    expect(top3('depth without 3D').some((id) => id.startsWith('three-'))).toBe(false);
  });

  it('shows the words that matched', () => {
    const [first] = rankByIntent(web, 'two-tone photos in the brand colours');
    expect(first.technique.id).toBe('duotone-filter');
    expect(first.matched).toEqual(expect.arrayContaining(['photo', 'brand']));
  });
});

describe('rank.js synonyms', () => {
  it('reaches an index word through a synonym, scoring below an exact match', () => {
    const tv = [{ id: 'a', label: 'A', description: '', primitive: 'svg', intents: ['retro tv'] }];
    const screen = [{ id: 'b', label: 'B', description: '', primitive: 'svg', intents: ['retro screen'] }];
    expect(rankByIntent(tv, 'broken screen')[0].score).toBe(2); // screen ~ tv: 3 - 1
    expect(rankByIntent(screen, 'broken screen')[0].score).toBe(3); // exact
    expect(rankByIntent(tv, 'broken screen')[0].matched).toEqual(['screen']); // the ask's word
    expect(rankByIntent(tv, 'broken screen')[0].phrases).toEqual(['retro tv']); // the purpose it reached
  });

  it('keeps meaningful two-letter words like tv', () => {
    expect(words('retro TV')).toEqual(['retro', 'tv']);
    expect(words('go to it')).toEqual([]);
  });
});
