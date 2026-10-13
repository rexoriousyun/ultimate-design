/**
 * Organic blob — a closed cubic Bézier through jittered points on a circle.
 *
 * Two things make this work and are the reasons to copy rather than retype:
 *
 *   - The control points are tangent to the circle at each vertex, scaled by a constant
 *     derived from the number of points. That is what keeps the curve smooth across the seam;
 *     joining first to last with a straight handle leaves a visible kink at 3 o'clock.
 *   - The randomness is seeded. An unseeded blob is a different shape on every render, which
 *     means a screenshot test can never pass and a design can never be reproduced.
 *
 * Usage: container.innerHTML = UIBlobShape.render({ seed: 7, wobble: 0.22 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  /** Deterministic LCG — a blob you cannot reproduce is a blob you cannot design with. */
  function rng(seed) {
    let s = (seed | 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function path(opts) {
    const o = opts || {};
    const points = Math.max(3, o.points == null ? 6 : o.points);
    const wobble = o.wobble == null ? 0.22 : o.wobble;
    const size = o.size == null ? 200 : o.size;
    const rand = rng(o.seed == null ? 7 : o.seed);

    const cx = size / 2;
    const cy = size / 2;
    const base = size * 0.38;

    const verts = [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = base * (1 - wobble + rand() * wobble * 2);
      verts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, a: angle, r: r });
    }

    // Tangent handle length for a smooth closed curve through N points.
    const k = ((4 / 3) * Math.tan(Math.PI / (2 * points))) ;

    let d = 'M ' + rnd(verts[0].x) + ' ' + rnd(verts[0].y);
    for (let i = 0; i < points; i++) {
      const p0 = verts[i];
      const p1 = verts[(i + 1) % points];
      // Tangent to the circle at each vertex: d/da (cos a, sin a) = (-sin a, cos a). The
      // leading handle goes forward along it, the trailing one backward. Flipping either sign
      // still closes the path — it just pinches into a cusp at every vertex, which renders
      // fine and is obviously wrong the moment you look at it.
      const c1 = { x: p0.x - Math.sin(p0.a) * k * p0.r, y: p0.y + Math.cos(p0.a) * k * p0.r };
      const c2 = { x: p1.x + Math.sin(p1.a) * k * p1.r, y: p1.y - Math.cos(p1.a) * k * p1.r };
      d += ' C ' + rnd(c1.x) + ' ' + rnd(c1.y) + ', ' + rnd(c2.x) + ' ' + rnd(c2.y) + ', ' + rnd(p1.x) + ' ' + rnd(p1.y);
    }
    return d + ' Z';
  }

  function rnd(n) { return Math.round(n * 100) / 100; }

  function render(opts) {
    const o = opts || {};
    const size = o.size == null ? 200 : o.size;
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"' +
      ' aria-hidden="true" focusable="false">' +
      '<path d="' + path(o) + '" fill="' + (o.fill || 'currentColor') + '"/>' +
      '</svg>'
    );
  }

  global.UIBlobShape = { render, path };

  if (global.UI) {
    global.UI.define({
      id: 'blob-shape',
      primitive: 'svg',
      label: 'Blob shape',
      source: 'recipes/web/blob-shape.js',
      export: 'UIBlobShape',
      description: 'Seeded organic blob from a closed cubic Bézier — reproducible, and smooth across the seam.',
      props: {
        seed: {
          type: 'number', default: 7,
          controls: 'Which blob: a different seed is a different silhouette with the same smoothness, and the same seed is always the same one.',
          sweep: [1, 7, 13, 42],
          cost: 'none',
        },
        points: {
          type: 'number', default: 6,
          controls: 'Number of lobes around the edge. Few reads as a pebble, many as a splat.',
          range: [3, 12], sweep: [3, 4, 6, 8, 12],
          cost: 'none',
        },
        wobble: {
          type: 'number', default: 0.22,
          controls: 'How far points stray from the circle: 0 is a circle, high is a lumpy, organic shape.',
          range: [0, 0.5], sweep: [0, 0.1, 0.22, 0.35, 0.5],
          breaks: { above: 'Past ~0.5 lobes can fold back over each other and the outline pinches.' },
          cost: 'none',
        },
        size: {
          type: 'number', default: 200, unit: 'px',
          controls: 'Rendered size of the blob.',
          range: [80, 320], sweep: [80, 140, 200, 260, 320],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIBlobShape.render({ seed: 7, points: 6, wobble: 0.22 });\n\n// Or take just the path, e.g. for a clip-path:\nconst d = UIBlobShape.path({ seed: 7 });",
      preview(container, props) {
        const p = props || {};
        container.innerHTML =
          '<div style="color:#2f9e4f">' + render({ seed: p.seed, points: p.points, wobble: p.wobble, size: p.size }) + '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:flex;gap:1rem;flex-wrap:wrap">' +
          [[3, 0.15, '#14532d'], [11, 0.28, '#2f9e4f'], [42, 0.4, '#7cc496']]
            .map(([seed, wobble, fill]) => render({ seed, wobble, fill, size: 150 }))
            .join('') +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
