/**
 * The skill's shelf files — `skill/references/recipe-library-<shelf>.md`, one line per recipe.
 *
 * These were copied in from design-guide's skill export when the library split off, and then
 * nothing regenerated them: four recipes landed on the web shelf and stayed invisible to any
 * agent that reads the skill. `sync` now writes them from the same manifest it just wrote, so
 * the shelf cannot fall behind the recipes without a test noticing.
 *
 * The line format matches design-guide's `shelfContent`, so both repos' skills read the same.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} shelf `web` or `qt`
 * @param {{components: {id: string, primitive: string, label: string, source: string}[]}} manifest
 */
export function shelfMarkdown(shelf, manifest) {
  const lines = [...manifest.components]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `- \`${c.id}\` ${c.primitive} — ${c.label}. ${c.source}`);
  return `# Recipe library — ${shelf}. Copy the source and adapt; never import it.\n\n${lines.join('\n')}\n`;
}

/** @returns {{path: string, changed: boolean}} */
export function writeShelf(skillDir, shelf, manifest) {
  const file = path.join(skillDir, 'references', `recipe-library-${shelf}.md`);
  const next = shelfMarkdown(shelf, manifest);
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (previous === next) return { path: file, changed: false };
  fs.writeFileSync(file, next);
  return { path: file, changed: true };
}
