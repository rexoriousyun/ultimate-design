import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTechniques, primitivesOf, recommend } from './techniques.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('listTechniques', () => {
  const techniques = listTechniques(REPO_ROOT);

  it('gathers both shelves into one catalogue', () => {
    expect(techniques.some((t) => t.platform === 'web')).toBe(true);
    expect(techniques.some((t) => t.platform === 'qt')).toBe(true);
  });

  it('carries a screenshot path exactly when the file is on disk', () => {
    // Was: "…and null for three-scene, which skips rendering for its CDN dependency." That
    // stopped being a fact once the render harness started loading three from the CDN, so
    // three-scene has an image now and every recipe on the shelf is rendered. Asserting file
    // existence keeps the mapping honest without naming a recipe that has to lack one.
    expect(techniques.find((t) => t.id === 'gooey-blobs').screenshot).toMatch(
      /screenshots\/gooey-blobs\.png$/,
    );
    const wrong = techniques.filter(
      (t) => Boolean(t.screenshot) !== fs.existsSync(path.join(REPO_ROOT, t.screenshot ?? 'nope')),
    );
    expect(wrong.map((t) => t.id)).toEqual([]);
  });

  it('lists the primitives actually present rather than a hardcoded set', () => {
    expect(primitivesOf(techniques)).toEqual(['canvas', 'svg', 'three']);
  });
});

describe('recommend', () => {
  const techniques = listTechniques(REPO_ROOT);

  it('finds the gooey recipe from a description of what it does', () => {
    const top = recommend(techniques, 'blobs that merge together')[0];
    expect(top.technique.id).toBe('gooey-blobs');
    expect(top.matched).toContain('blob'); // matched words are stems (rank.js)
  });

  it('shows which words matched, so the ranking can be argued with', () => {
    const hits = recommend(techniques, 'chart');
    expect(hits[0].matched).toEqual(['chart']);
  });

  it('returns nothing rather than the least-bad option when the shelf has no answer', () => {
    // An empty answer is the honest one, and it is what tells you to go harvest.
    expect(recommend(techniques, 'kerberos authentication ticket')).toEqual([]);
  });

  it('ignores filler words so a natural sentence does not match everything', () => {
    expect(recommend(techniques, 'I want to make something for the')).toEqual([]);
  });
});
