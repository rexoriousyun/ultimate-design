import { defineConfig } from 'vitest/config';

/**
 * Bounded parallelism, because most of this suite drives a real browser.
 *
 * There was no config here at all, which meant vitest sized its worker pool to the machine —
 * twelve forks on this one — and a dozen of them launch their own Chromium: the observer
 * tests, the fixture cross-product, the recipe render gate, the reduced-motion guard, the art
 * reference analyzer. That was survivable while the recipe shelf was small. At thirty-two
 * recipes the render gate holds a browser open long enough to overlap everything else, and
 * `analyzeReference` started failing with `Protocol error (Page.captureScreenshot): Unable to
 * capture screenshot` — a resource failure, not a defect in the code under test.
 *
 * It reproduced 2/2 in the full suite and passed 2/2 when that file ran alone, which is the
 * signature of contention rather than a bug. A test that fails only when its neighbours are
 * busy teaches people to re-run until green, and a suite nobody trusts is one nobody reads.
 *
 * Four is not tuned to this machine's core count on purpose — CI runners are usually smaller,
 * and the ceiling that matters is concurrent browsers, not cores.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      // minForks must be set too: it otherwise defaults to the core count and conflicts
      // with the ceiling, which vitest reports as "minThreads and maxThreads must not conflict".
      forks: { minForks: 1, maxForks: 4 },
    },
    // Playwright launches, page loads and axe runs are all slow; the default 5s is too tight
    // for the corpus-wide guards, which is why several of them pass an explicit timeout.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
