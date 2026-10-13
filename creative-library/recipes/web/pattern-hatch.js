/**
 * Hatch / crosshatch / dot fill via <pattern> — the texture layer for charts.
 *
 * Worth having as a recipe because it is the accessible answer to "these two series look the
 * same in greyscale". A hatched fill survives colourblindness, printing, and forced-colors
 * mode, none of which a second hue does. That is why the dataviz guidance treats texture as a
 * secondary encoding rather than decoration.
 *
 * The detail that trips people: `patternUnits="userSpaceOnUse"` means the pattern tiles in
 * user coordinates and stays a constant size regardless of the shape it fills. The default,
 * objectBoundingBox, scales the hatch with the element, so a small bar gets a fine hatch and a
 * large one gets a coarse one — the same fill reading as two different textures.
 *
 * Usage: const { defs, fill } = UIPatternHatch.make({ kind: 'diagonal' });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  const KINDS = {
    diagonal: (s, c, w) => '<path d="M0 ' + s + ' L ' + s + ' 0" stroke="' + c + '" stroke-width="' + w + '"/>',
    'diagonal-back': (s, c, w) => '<path d="M0 0 L ' + s + ' ' + s + '" stroke="' + c + '" stroke-width="' + w + '"/>',
    cross: (s, c, w) =>
      '<path d="M0 ' + s + ' L ' + s + ' 0 M0 0 L ' + s + ' ' + s + '" stroke="' + c + '" stroke-width="' + w + '"/>',
    horizontal: (s, c, w) => '<path d="M0 ' + s / 2 + ' L ' + s + ' ' + s / 2 + '" stroke="' + c + '" stroke-width="' + w + '"/>',
    dots: (s, c) => '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + s / 6 + '" fill="' + c + '"/>',
  };

  /**
   * @returns {{id: string, defs: string, fill: string}} defs to drop in an <svg>, and the
   *   `fill` value to reference it with.
   */
  function make(opts) {
    const o = opts || {};
    const kind = KINDS[o.kind] ? o.kind : 'diagonal';
    const size = o.size == null ? 8 : o.size;
    const color = o.color || 'currentColor';
    const weight = o.weight == null ? 1.5 : o.weight;
    const angle = o.angle == null ? 0 : o.angle;
    const id = 'hatch-' + ++seq;

    const defs =
      '<pattern id="' + id + '" width="' + size + '" height="' + size + '"' +
      // Constant texture size regardless of the filled shape — the whole point.
      ' patternUnits="userSpaceOnUse"' +
      (angle ? ' patternTransform="rotate(' + angle + ')"' : '') + '>' +
      (o.background ? '<rect width="' + size + '" height="' + size + '" fill="' + o.background + '"/>' : '') +
      KINDS[kind](size, color, weight) +
      '</pattern>';

    return { id: id, defs: defs, fill: 'url(#' + id + ')' };
  }

  global.UIPatternHatch = { make, kinds: Object.keys(KINDS) };

  if (global.UI) {
    function swatches(props) {
      const p = props || {};
      const kinds = Object.keys(KINDS);
      const defs = [];
      const rects = [];
      kinds.forEach((kind, i) => {
        const h = make({ kind: kind, size: p.size, weight: p.weight, angle: p.angle, background: '#ffffff' });
        defs.push(h.defs);
        rects.push(
          '<g transform="translate(' + i * 92 + ' 0)">' +
          '<rect width="84" height="84" fill="' + h.fill + '" stroke="#6b7280"/>' +
          '<text x="42" y="100" text-anchor="middle" font-size="11" fill="#1a1a1a">' + kind + '</text></g>',
        );
      });
      return (
        '<svg width="100%" viewBox="0 0 ' + kinds.length * 92 + ' 108" role="img"' +
        ' aria-label="Five pattern fills: ' + kinds.join(', ') + '" style="color:#14532d">' +
        '<defs>' + defs.join('') + '</defs>' + rects.join('') + '</svg>'
      );
    }

    global.UI.define({
      id: 'pattern-hatch',
      primitive: 'svg',
      label: 'Pattern hatch',
      source: 'recipes/web/pattern-hatch.js',
      export: 'UIPatternHatch',
      description: 'Hatch, crosshatch and dot fills that survive greyscale, print and forced-colors — the texture encoding.',
      props: {
        size: {
          type: 'number',
          default: 8,
          unit: 'px',
          controls: 'Tile size: the spacing between hatch lines (and dot pitch). Small reads as a tone, large as visible stripes.',
          range: [3, 24],
          sweep: [3, 4, 6, 8, 12, 16, 24],
          breaks: { below: 'Under ~3px with weight 1.5 the lines merge into a flat fill and the texture stops encoding anything.' },
          cost: 'none — one <pattern> tile, drawn by the renderer',
        },
        weight: {
          type: 'number',
          default: 1.5,
          unit: 'px',
          controls: 'Line weight: how dark the hatch reads. Heavier lines carry further and survive print; thin ones read as a light tone.',
          range: [0.5, 4],
          sweep: [0.5, 1, 1.5, 2, 3, 4],
          breaks: { above: 'Near the tile size the lines fill the tile and the hatch becomes a solid.' },
          cost: 'none',
        },
        angle: {
          type: 'number',
          default: 0,
          unit: 'deg',
          controls: 'Rotates the whole pattern. Distinguishes two series that share a hatch kind.',
          range: [0, 180],
          sweep: [0, 15, 30, 45, 60, 90],
          // Every kind is symmetric under a half turn, so 0 and 180 render the same.
          identical: [[0, 180]],
          cost: 'none',
        },
      },
      signature: {
        within: 'svg',
        requires: ['pattern[patternUnits="userSpaceOnUse"]'],
        why: 'a user-space tiled pattern used as a fill is the texture-encoding recipe',
      },
      snippet:
        "const hatch = UIPatternHatch.make({ kind: 'diagonal', size: 8 });\nsvg.innerHTML =\n  '<defs>' + hatch.defs + '</defs>' +\n  '<rect width=\"100\" height=\"60\" fill=\"' + hatch.fill + '\"/>';",
      preview(container, props) {
        container.innerHTML = swatches(props);
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML = swatches({});
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
