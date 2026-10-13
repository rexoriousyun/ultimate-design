/**
 * Star rating with real fractional fill — 3.6 stars renders as 3.6, not 4.
 *
 * The technique is one clipPath whose rect width is the rating as a percentage of the row,
 * laid over a second copy of the same stars. Rounding to the nearest half (the common
 * shortcut, usually via three separate glyphs) misreports the number the page is showing,
 * which matters when the rating is the thing being compared.
 *
 * Announces as text: `role="img"` with the numeric rating in the label, because a reader
 * needs "3.6 out of 5", not five star outlines.
 *
 * Usage: container.innerHTML = UIStarRating.render({ value: 3.6 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  const STAR = 'M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z';

  function render(opts) {
    const o = opts || {};
    const max = o.max == null ? 5 : o.max;
    const value = Math.max(0, Math.min(max, o.value == null ? 3.6 : o.value));
    const size = o.size == null ? 28 : o.size;
    const gap = o.gap == null ? 4 : o.gap;
    const color = o.color || '#b45309';
    const empty = o.empty || 'rgba(0,0,0,0.15)';
    const id = 'stars-' + ++seq;

    const cell = 24 + gap;
    const width = max * cell - gap;
    const stars = [];
    for (let i = 0; i < max; i++) {
      stars.push('<path d="' + STAR + '" transform="translate(' + i * cell + ' 0)"/>');
    }
    const row = stars.join('');

    return (
      '<svg width="' + Math.round((width / 24) * size) + '" height="' + size + '"' +
      ' viewBox="0 0 ' + width + ' 24" role="img"' +
      ' aria-label="' + (Math.round(value * 10) / 10) + ' out of ' + max + '">' +
      '<defs><clipPath id="' + id + '">' +
        // The whole recipe: clip the filled copy to the exact fraction of the row.
        '<rect x="0" y="0" width="' + (value / max) * width + '" height="24"/>' +
      '</clipPath></defs>' +
      '<g fill="' + empty + '">' + row + '</g>' +
      '<g fill="' + color + '" clip-path="url(#' + id + ')">' + row + '</g>' +
      '</svg>'
    );
  }

  global.UIStarRating = { render };

  if (global.UI) {
    global.UI.define({
      id: 'star-rating',
      primitive: 'svg',
      label: 'Star rating',
      source: 'recipes/web/star-rating.js',
      export: 'UIStarRating',
      description: 'Fractional star fill via a clipped overlay — 3.6 renders as 3.6, and announces as a number.',
      props: {
        value: {
          type: 'number', default: 3.6,
          controls: 'The rating, filled to the exact fraction: 3.6 shows as 3.6, not rounded to a half.',
          range: [0, 5], sweep: [0, 1.2, 2.5, 3.6, 5],
          cost: 'none',
        },
        max: {
          type: 'number', default: 5,
          controls: 'How many stars the scale has.',
          range: [3, 10], sweep: [3, 5, 7, 10],
          cost: 'none',
        },
        size: {
          type: 'number', default: 28, unit: 'px',
          controls: 'Star size.',
          range: [12, 48], sweep: [12, 20, 28, 36, 48],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIStarRating.render({ value: 3.6, max: 5, size: 28 });",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render({ value: p.value, max: p.max, size: p.size });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:grid;gap:0.6rem">' +
          [4.8, 3.6, 2.1, 0.4].map((v) =>
            '<div style="display:flex;align-items:center;gap:0.75rem">' +
            render({ value: v }) +
            '<span style="font-variant-numeric:tabular-nums;color:#1a1a1a">' + v.toFixed(1) + '</span></div>',
          ).join('') +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
