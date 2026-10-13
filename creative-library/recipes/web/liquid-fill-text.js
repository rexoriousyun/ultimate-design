/**
 * Liquid fill text — a word that fills up like a glass, driven by a percentage.
 *
 * A progress indicator you actually want to look at, and the rare decorative effect that
 * carries real information: the fill level IS the value. Most "fun" progress treatments add
 * motion around a number; this one makes the number the picture.
 *
 * The construction is a `<mask>` containing the text, applied to two stacked layers: a muted
 * "empty" copy underneath, and a filled rect on top clipped to the wave. What people reach for
 * instead is `background-clip: text` with a gradient, which cannot do a wave edge and cannot
 * animate the surface.
 *
 * Two details decide whether it reads as liquid:
 *
 *   - **The wave is one path repeated twice, translated by exactly its own width.** That is
 *     what lets it scroll seamlessly — animate `x` by one wavelength and it loops with no
 *     seam. A single wave sliding across leaves a visible edge every cycle.
 *   - **`mask` is on the group, not on the text.** Masking the text directly makes the browser
 *     rasterise glyph coverage twice and the edges go soft at small sizes.
 *
 * Accessibility: the value lives in `role="img"` with the percentage in the label, because a
 * masked SVG glyph is a shape, not text — a screen reader gets nothing from it otherwise.
 * Under prefers-reduced-motion the surface stops moving and the level stays exactly where it
 * is, which is the whole content.
 *
 * Usage: container.innerHTML = UILiquidFillText.render('42%', { value: 0.42 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  // SMIL, unlike a CSS animation, is invisible to `reduced-motion-respected` (which reads
  // computed styles) AND to the rAF-counting guard (SMIL schedules no frames of its own). So
  // nothing in this repo would have caught the surface still sliding under the preference —
  // the docstring claimed it stopped and no branch existed. Checked here, at render time.
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /** One wavelength of a sine, as a path segment, starting at (x, y). */
  function waveSegment(x, y, width, amplitude, steps) {
    let d = '';
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = x + t * width;
      const py = y + Math.sin(t * Math.PI * 2) * amplitude;
      d += ` L ${Math.round(px * 10) / 10} ${Math.round(py * 10) / 10}`;
    }
    return d;
  }

  function render(text, opts) {
    const o = opts || {};
    const value = Math.max(0, Math.min(1, o.value == null ? 0.42 : o.value));
    const width = o.width == null ? 420 : o.width;
    const height = o.height == null ? 140 : o.height;
    const amplitude = o.amplitude == null ? 7 : o.amplitude;
    const wavelength = o.wavelength == null ? 140 : o.wavelength;
    const speed = o.speed == null ? 4 : o.speed;
    const fill = o.fill || '#2f9e4f';
    const empty = o.empty || 'rgba(0,0,0,0.14)';
    const fontSize = o.fontSize == null ? Math.round(height * 0.78) : o.fontSize;
    const id = 'liquid-' + ++seq;

    // Surface height: 0 is the bottom of the box, 1 the top. Amplitude is left inside the box
    // so a full or empty glass never clips its own crest.
    const surface = height - amplitude - value * (height - amplitude * 2);

    // Two identical wavelengths side by side. Translating by exactly one wavelength lands the
    // second where the first began, so the loop has no seam.
    const cycles = Math.ceil(width / wavelength) + 2;
    let d = `M ${-wavelength} ${surface}`;
    for (let i = 0; i < cycles; i++) {
      d += waveSegment(-wavelength + i * wavelength, surface, wavelength, amplitude, 12);
    }
    d += ` L ${width + wavelength} ${height} L ${-wavelength} ${height} Z`;

    // The level is the content and stays exactly where it is; only the surface stops.
    const wanted = o.animate == null ? true : o.animate;
    const animate = wanted && !REDUCED()
      ? `<animateTransform attributeName="transform" type="translate" from="0 0"` +
        ` to="${wavelength} 0" dur="${speed}s" repeatCount="indefinite"/>`
      : '';

    return (
      `<svg width="100%" viewBox="0 0 ${width} ${height}" role="img"` +
      ` aria-label="${esc(o.label || `${text} — ${Math.round(value * 100)}% full`)}"` +
      ` style="max-width:${width}px;display:block">` +
        `<defs><mask id="${id}">` +
          `<rect width="${width}" height="${height}" fill="black"/>` +
          `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"` +
          ` font-size="${fontSize}" font-weight="800" font-family="system-ui, sans-serif"` +
          ` fill="white">${esc(text)}</text>` +
        `</mask></defs>` +
        // Masked as a group. Masking the text node itself rasterises glyph coverage twice and
        // softens the edges at small sizes.
        `<g mask="url(#${id})">` +
          `<rect width="${width}" height="${height}" fill="${empty}"/>` +
          `<g>${animate}<path d="${d}" fill="${fill}"/></g>` +
        `</g>` +
      `</svg>`
    );
  }

  global.UILiquidFillText = { render };

  if (global.UI) {
    global.UI.define({
      id: 'liquid-fill-text',
      primitive: 'svg',
      label: 'Liquid fill text',
      source: 'recipes/web/liquid-fill-text.js',
      export: 'UILiquidFillText',
      description:
        'Text that fills like a glass to a value — a seamless looping wave inside an SVG mask. The fill level is the data.',
      props: {
        value: {
          type: 'number', default: 0.42,
          controls: 'The fill level, 0 to 1. This is the data: the word shows how full the thing is.',
          range: [0, 1], sweep: [0, 0.25, 0.42, 0.75, 1],
          cost: 'none',
        },
        amplitude: {
          type: 'number', default: 7, unit: 'px',
          controls: 'Wave height on the surface: calm at low values, sloshing at high.',
          range: [0, 16], sweep: [0, 3, 7, 11, 16],
          cost: 'none',
        },
        wavelength: {
          type: 'number', default: 140, unit: 'px',
          controls: 'Distance between crests: short is choppy, long is a gentle swell.',
          range: [60, 280], sweep: [60, 100, 140, 200, 280],
          cost: 'none',
        },
        animate: {
          type: 'boolean', default: true,
          controls: 'Whether the surface moves. The level never moves; only the wave does.',
          unswept: 'motion: under reduced motion the surface stops, as designed, so no still frame shows it',
        },
      },
      signature: {
        within: 'svg',
        requires: ['mask', 'animatetransform'],
        why: 'a translating wave inside a text mask is the liquid-fill recipe',
      },
      snippet:
        "container.innerHTML = UILiquidFillText.render('STORAGE', {\n  value: 0.42,          // 0..1 — this is the data, not decoration\n  fill: 'var(--accent)',\n});",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render('42%', {
          value: p.value, amplitude: p.amplitude, wavelength: p.wavelength, animate: p.animate,
        });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:grid;gap:0.5rem">' +
          // Amplitude raised for the demo: the 7px default is deliberately subtle at full
          // size and disappears entirely in a 96px-tall thumbnail, which is the browsing
          // surface. Same lesson flow-field taught — the screenshot has to show the effect.
          render('EMPTY', { value: 0.08, height: 96, amplitude: 10, wavelength: 110 }) +
          render('HALF', { value: 0.5, height: 96, amplitude: 10, wavelength: 110 }) +
          render('FULL', { value: 0.95, height: 96, amplitude: 10, wavelength: 110 }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
