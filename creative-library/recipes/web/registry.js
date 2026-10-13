/**
 * Component registry — the single index every recipes/web/*.js module registers itself
 * into. Ported from ui-master's lib/core/registry.js.
 *
 * Nothing outside this file should hand-list components: `npm run sync`
 * generates recipes/web/manifest.json by loading these modules in a real browser and
 * reading UI.manifest(), so a component that does not actually run cannot appear in the
 * manifest, and a deleted file disappears from it on the next sync. That replaces
 * ui-master's steps 3 and 4, which were "add a script tag" and "add a matching entry by
 * hand" — the two manual steps its React port and its vanilla lib had already drifted
 * apart on, leaving two component-manifest.json copies that disagreed.
 *
 * Adding a component:
 *   1. New file at recipes/web/<id>.js (one component per file).
 *   2. Call UI.define({...}) at the bottom of that file.
 *   3. Run `node engine/cli.js recipes sync`.
 * Never grow an existing component file to cover a second, unrelated component — split
 * into a new file instead.
 *
 * Two renderers, on purpose. `demo(container)` is the scripted showcase with its own
 * controls — it is what the screenshot is taken of. `preview(container, props)` renders the
 * construction with a caller-supplied set of props and nothing else, which is what lets the
 * app build a control panel from `props` and re-render as you drag a slider. Documenting a
 * prop and giving no way to change it is documentation that cannot be checked.
 *
 * `signature` is the field this repo adds to ui-master's original spec. It is what
 * engine/checks/recipeReinvention.js matches against a page's DOM to say "a recipe
 * already covers this". Each selector should name the distinctive construction the
 * recipe exists to encapsulate — the SVG filter primitive pair, not the wrapper div —
 * so that matching it means the page really did hand-roll this technique.
 */
(function (global) {
  const components = {};

  function define(spec) {
    if (!spec.id) throw new Error('UI.define requires an id');
    if (!spec.primitive) throw new Error('UI.define("' + spec.id + '") requires a primitive');
    if (!spec.demo) throw new Error('UI.define("' + spec.id + '") requires a demo(container) renderer');
    if (!spec.preview) throw new Error('UI.define("' + spec.id + '") requires a preview(container, props) renderer');
    components[spec.id] = spec;
  }

  function get(id) {
    return components[id];
  }

  function all() {
    return Object.values(components);
  }

  function byPrimitive(primitive) {
    return all().filter((c) => c.primitive === primitive);
  }

  /** The serializable half of every spec — what the manifest carries. `demo` is a live
   * renderer and never survives JSON, so it is dropped here rather than silently
   * stringified. Sorted by id so a regenerated manifest is byte-stable. */
  function manifest() {
    return all()
      .map((c) => ({
        id: c.id,
        primitive: c.primitive,
        label: c.label,
        source: c.source,
        export: c.export,
        description: c.description,
        props: c.props || {},
        hasPreview: typeof c.preview === 'function',
        requires: c.requires || [],
        // Other recipes in this library that must be loaded first. Distinct from `requires`,
        // which names things outside it (a CDN global). Kept separate because the two are
        // satisfied in completely different ways: a dependency here is another file on this
        // shelf, and anything consuming the manifest can resolve it without asking a human.
        dependsOn: c.dependsOn || [],
        signature: c.signature || null,
        snippet: c.snippet,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  global.UI = { define, get, all, byPrimitive, manifest };
})(window);
