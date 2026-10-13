/**
 * Where the one external recipe dependency comes from.
 *
 * `three` is a pinned devDependency rather than a CDN fetch. It used to be loaded from unpkg
 * at render time, which meant three.js recipes were verified only when the machine happened to
 * have network — and skipped, silently unverified, when it did not. A recipe is a promise that
 * the code works, so "verified if the network is up" is not good enough to make that promise
 * with.
 *
 * The version is pinned in package.json and asserted against here, so a dependency bump cannot
 * quietly change what recipes are validated against.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const THREE_VERSION = '0.128.0';

/**
 * @returns {string|null} absolute path to the pinned UMD build, or null if it is not installed
 *   (in which case three.js recipes skip with a stated reason, as before).
 */
export function threeBuildPath() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve('three/package.json');
    const build = path.join(path.dirname(pkg), 'build', 'three.min.js');
    return fs.existsSync(build) ? build : null;
  } catch {
    return null;
  }
}

/** True when a `requires` string names the THREE global. */
export function needsThree(requires) {
  return (requires ?? []).some((r) => /\bTHREE\b/.test(r));
}
