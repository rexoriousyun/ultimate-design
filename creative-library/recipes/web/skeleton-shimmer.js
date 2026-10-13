/**
 * Loading skeleton — grey blocks in the shape of the content that is coming.
 *
 * The technique is a moving linear-gradient background, sized wider than the element, offset
 * by animation. Worth a recipe for three details that are usually wrong:
 *
 *   - `background-size: 200% 100%` with the gradient's highlight in the middle. Animating
 *     `background-position` across that is one composited property; animating `left` on a
 *     child overlay is layout, and janks on a list of forty rows.
 *   - The shimmer stops under prefers-reduced-motion, leaving a flat grey block. A skeleton is
 *     already communicating "loading" by existing; the sweep is decoration.
 *   - `aria-hidden` on the blocks plus one live region saying "Loading". Otherwise a screen
 *     reader either reads nothing at all or reads forty empty divs.
 *
 * Usage: container.innerHTML = UISkeletonShimmer.render({ lines: 3 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let injected = false;

  const CSS =
    '@keyframes ui-skeleton-sweep { from { background-position: 200% 0 } to { background-position: -200% 0 } }' +
    '.ui-skeleton{background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);' +
    'background-size:200% 100%;animation:ui-skeleton-sweep 1.4s linear infinite;border-radius:6px}' +
    // The whole reduced-motion story: the block stays, the sweep goes.
    '@media (prefers-reduced-motion: reduce){.ui-skeleton{animation:none;background:#e5e7eb}}';

  function ensureStyles(doc) {
    if (injected) return;
    const style = (doc || document).createElement('style');
    style.textContent = CSS;
    (doc || document).head.appendChild(style);
    injected = true;
  }

  /**
   * @param {object} [opts] lines, avatar, lineHeight, gap, lastLineWidth, label
   * @returns {string} markup for one skeleton block.
   */
  function render(opts) {
    const o = opts || {};
    ensureStyles(o.document);
    const lines = Math.max(1, o.lines == null ? 3 : o.lines);
    const lineHeight = o.lineHeight == null ? 12 : o.lineHeight;
    const gap = o.gap == null ? 10 : o.gap;
    const last = o.lastLineWidth == null ? 60 : o.lastLineWidth;
    const avatar = o.avatar == null ? true : o.avatar;

    const bars = [];
    for (let i = 0; i < lines; i++) {
      const width = i === lines - 1 ? last + '%' : '100%';
      bars.push(
        '<div class="ui-skeleton" style="height:' + lineHeight + 'px;width:' + width +
        (i ? ';margin-top:' + gap + 'px' : '') + '"></div>',
      );
    }

    return (
      // One announcement for the whole block; the shapes themselves say nothing useful.
      '<div role="status" aria-live="polite" style="display:flex;gap:14px;align-items:flex-start">' +
        '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">' +
          (o.label || 'Loading') + '</span>' +
        (avatar
          ? '<div class="ui-skeleton" aria-hidden="true" style="width:44px;height:44px;' +
            'border-radius:50%;flex:0 0 auto"></div>'
          : '') +
        '<div aria-hidden="true" style="flex:1 1 auto">' + bars.join('') + '</div>' +
      '</div>'
    );
  }

  global.UISkeletonShimmer = { render };

  if (global.UI) {
    global.UI.define({
      id: 'skeleton-shimmer',
      primitive: 'svg',
      label: 'Skeleton shimmer',
      source: 'recipes/web/skeleton-shimmer.js',
      export: 'UISkeletonShimmer',
      description: 'Loading placeholder with a composited gradient sweep, one live-region announcement, and a flat fallback under reduced motion.',
      props: {
        lines: {
          type: 'number', default: 3,
          controls: 'How many text lines the placeholder stands in for. Match the content that is coming.',
          range: [1, 6], sweep: [1, 2, 3, 4, 6],
          cost: 'none',
        },
        avatar: {
          type: 'boolean', default: true,
          controls: 'Whether a round avatar block leads the lines, as in a comment or a profile row.',
          sweep: [false, true],
          cost: 'none',
        },
        lineHeight: {
          type: 'number', default: 12, unit: 'px',
          controls: 'Height of each line block: match the type size that will replace it.',
          range: [8, 20], sweep: [8, 12, 16, 20],
          cost: 'none',
        },
        lastLineWidth: {
          type: 'number', default: 60, unit: '%',
          controls: 'Width of the last line, so the block reads as a paragraph rather than a grid of bars.',
          range: [20, 100], sweep: [20, 40, 60, 80, 100],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UISkeletonShimmer.render({\n  lines: 3,\n  avatar: true,\n  label: 'Loading comments',\n});",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render({
          lines: p.lines, avatar: p.avatar, lineHeight: p.lineHeight, lastLineWidth: p.lastLineWidth,
        });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:grid;gap:1.25rem;max-width:420px">' +
          render({ lines: 3 }) + render({ lines: 2, avatar: false, lastLineWidth: 40 }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
