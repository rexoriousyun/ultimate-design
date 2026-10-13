/**
 * Glow / neon halo — feGaussianBlur fed back over the source with feMerge.
 *
 * The construction is three primitives and the order is the whole thing: blur the source, then
 * merge the blur *under* the original. Using the blur alone gives a smear; using feDropShadow
 * gives an offset shadow, not a halo. Stacking two merge nodes of the same blur is what makes
 * it read as light rather than as fog.
 *
 * `filterUnits`/region matters more here than elsewhere: a glow paints outside the element's
 * box, so the filter region is widened to -50%/200%. Leaving it at the default clips the halo
 * to a rectangle, which is the single most common way this looks broken.
 *
 * Usage: container.innerHTML = UIGlowFilter.wrap('<circle .../>', { strength: 4 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  function wrap(inner, opts) {
    const o = opts || {};
    const width = o.width == null ? 220 : o.width;
    const height = o.height == null ? 160 : o.height;
    const strength = o.strength == null ? 4 : o.strength;
    const layers = Math.max(1, o.layers == null ? 2 : o.layers);
    const id = 'glow-' + ++seq;

    const merges =
      new Array(layers).fill('<feMergeNode in="blur"/>').join('') + '<feMergeNode in="SourceGraphic"/>';

    return (
      '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"' +
      ' aria-hidden="true" focusable="false">' +
      '<defs>' +
        // Widened region: a halo paints outside the source box and the default clips it.
        '<filter id="' + id + '" x="-50%" y="-50%" width="200%" height="200%">' +
          '<feGaussianBlur stdDeviation="' + strength + '" result="blur"/>' +
          '<feMerge>' + merges + '</feMerge>' +
        '</filter>' +
      '</defs>' +
      '<g filter="url(#' + id + ')">' + inner + '</g>' +
      '</svg>'
    );
  }

  global.UIGlowFilter = { wrap };

  if (global.UI) {
    const ART =
      '<circle cx="60" cy="80" r="30" fill="none" stroke="#4ade80" stroke-width="3"/>' +
      '<path d="M110 110 L140 50 L170 110" fill="none" stroke="#4ade80" stroke-width="3" stroke-linejoin="round"/>' +
      '<text x="110" y="145" text-anchor="middle" fill="#4ade80" font-size="16" font-weight="700">ONLINE</text>';

    global.UI.define({
      id: 'glow-filter',
      primitive: 'svg',
      label: 'Glow filter',
      source: 'recipes/web/glow-filter.js',
      export: 'UIGlowFilter',
      description: 'Neon halo from feGaussianBlur merged under the source, with a widened filter region so it is not clipped.',
      props: {
        strength: {
          type: 'number', default: 4,
          controls: 'Blur radius of the halo: how far the light spreads past the shape.',
          range: [1, 12], sweep: [1, 2, 4, 8, 12],
          breaks: { above: 'Large blurs thin out; past ~12 the halo reads as fog rather than light.' },
          cost: 'grows with blur radius; filters repaint on every change',
        },
        layers: {
          type: 'number', default: 2,
          controls: 'How many copies of the blur are stacked under the shape: one is soft, more is intense, like a neon tube.',
          range: [1, 4], sweep: [1, 2, 3, 4],
          cost: 'one merge node per layer',
        },
      },
      signature: {
        within: 'filter',
        requires: ['feGaussianBlur', 'feMerge'],
        why: 'a blur merged back under its own source is the glow recipe',
      },
      snippet:
        "container.innerHTML = UIGlowFilter.wrap(\n  '<circle cx=\"60\" cy=\"60\" r=\"30\" stroke=\"#4ade80\" fill=\"none\"/>',\n  { strength: 4, layers: 2 }\n);",
      preview(container, props) {
        const p = props || {};
        container.innerHTML =
          '<div style="background:#07130c;border-radius:8px;padding:0.5rem">' +
          wrap(ART, { strength: p.strength, layers: p.layers }) + '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="background:#07130c;border-radius:8px;padding:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">' +
          wrap(ART, { strength: 1.5, layers: 1 }) +
          wrap(ART, { strength: 4, layers: 2 }) +
          wrap(ART, { strength: 8, layers: 3 }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
