/**
 * Hand-drawn "squiggle vision" wobble filter — feTurbulence (fractal noise) feeds
 * feDisplacementMap to jitter pixels, with the noise seed animated via SMIL <animate>
 * for a sketchy, hand-wobbled look. The classic "wiggle a graphic without a motion
 * library" trick: a fractalNoise map re-seeded every frame, displacing the source.
 *
 * Ported from ui-master's React SquiggleWobble.jsx. Two changes, both deliberate:
 *   - No framework. The React version leaned on useId() for a collision-safe filter id;
 *     this uses a module-local counter, which is what useId was doing for us.
 *   - Respects prefers-reduced-motion. The original animated unconditionally, which
 *     fails this repo's own `reduced-motion-respected` invariant — a recipe that cannot
 *     pass the gate is not a recipe anyone should copy. The filter still applies at rest,
 *     so the hand-drawn look survives; only the re-seeding stops.
 *
 * Usage: UISquiggleWobble.wrap(svgChildrenMarkup, { scale: 18 })
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  const REDUCED = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * @param {string} inner  SVG markup to displace (paths, circles, text…).
   * @param {object} [opts] width, height, viewBox, scale, baseFrequency, speed, animate, class
   * @returns {string} a complete <svg> string.
   */
  function wrap(inner, opts) {
    const o = opts || {};
    const width = o.width || 200;
    const height = o.height || 200;
    const viewBox = o.viewBox || '0 0 ' + width + ' ' + height;
    const scale = o.scale == null ? 18 : o.scale;
    const baseFrequency = o.baseFrequency == null ? 0.03 : o.baseFrequency;
    const speed = o.speed == null ? 1.2 : o.speed;
    const animate = (o.animate == null ? true : o.animate) && !REDUCED();
    const cls = o.class ? ' class="' + o.class + '"' : '';
    const id = 'squiggle-' + ++seq;

    const seedAnimation = animate
      ? '<animate attributeName="seed" values="1;2;3;4;5;1" dur="' + speed + 's" repeatCount="indefinite"/>'
      : '';

    return (
      '<svg' + cls + ' width="' + width + '" height="' + height + '" viewBox="' + viewBox + '">' +
        '<defs>' +
          '<filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%">' +
            '<feTurbulence type="fractalNoise" baseFrequency="' + baseFrequency + '" numOctaves="1" seed="1" result="noise">' +
              seedAnimation +
            '</feTurbulence>' +
            '<feDisplacementMap in="SourceGraphic" in2="noise" scale="' + scale + '"/>' +
          '</filter>' +
        '</defs>' +
        '<g filter="url(#' + id + ')">' + inner + '</g>' +
      '</svg>'
    );
  }

  global.UISquiggleWobble = { wrap };

  if (global.UI) {
    global.UI.define({
      id: 'squiggle-wobble',
      primitive: 'svg',
      label: 'Squiggle wobble',
      source: 'recipes/web/squiggle-wobble.js',
      export: 'UISquiggleWobble',
      description: 'Hand-drawn wobble: animated fractal-noise displacement. Honours prefers-reduced-motion.',
      props: {
        scale: {
          type: 'number', default: 18,
          controls: 'Displacement strength: how far lines wobble from where they were drawn. Low is a careful hand, high is a scribble.',
          range: [0, 40], sweep: [0, 6, 12, 18, 28, 40],
          breaks: { above: 'Past ~30 thin strokes break apart into fragments.' },
          cost: 'one displacement filter',
        },
        baseFrequency: {
          type: 'number', default: 0.03,
          controls: 'Wobble frequency: low is a slow, wavy hand; high is a nervous jitter.',
          range: [0.005, 0.1], sweep: [0.005, 0.015, 0.03, 0.06, 0.1],
          cost: 'none',
        },
        speed: {
          type: 'number', default: 1.2, unit: 's',
          controls: 'How often the noise is re-seeded: the boil rate of the line.',
          range: [0.3, 3],
          unswept: 'motion: under reduced motion the re-seeding stops, as designed, so no still frame shows it',
        },
        animate: {
          type: 'boolean', default: true,
          controls: 'Whether the line boils (re-seeds) or holds one wobble.',
          unswept: 'motion: under reduced motion it holds one wobble, as designed, so no still frame shows it',
        },
      },
      signature: {
        within: 'filter',
        requires: ['feTurbulence', 'feDisplacementMap'],
        why: 'a turbulence map feeding a displacement map is the wobble recipe itself',
      },
      snippet:
        "container.innerHTML = UISquiggleWobble.wrap(\n  '<circle cx=\"100\" cy=\"100\" r=\"60\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/>',\n  { scale: 18, speed: 1.2 }\n);",
      preview(container, props) {
        const p = props || {};
        const art =
          '<circle cx="100" cy="100" r="58" fill="none" stroke="currentColor" stroke-width="3"/>' +
          '<path d="M60 105 L88 132 L142 74" fill="none" stroke="currentColor" stroke-width="3"/>';
        container.innerHTML = wrap(art, {
          scale: p.scale, baseFrequency: p.baseFrequency, speed: p.speed, animate: p.animate,
        });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const stage = document.createElement('div');
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-scale="6">Subtle</button>' +
          '<button class="ui-demo-ctl" data-scale="18" aria-pressed="true">Default</button>' +
          '<button class="ui-demo-ctl" data-scale="34">Wild</button>';

        const art =
          '<circle cx="100" cy="100" r="58" fill="none" stroke="currentColor" stroke-width="3"/>' +
          '<path d="M60 105 L88 132 L142 74" fill="none" stroke="currentColor" stroke-width="3"/>';

        function render(scale) {
          stage.innerHTML = wrap(art, { scale: scale });
        }

        controls.addEventListener('click', function (e) {
          const scale = e.target.dataset && e.target.dataset.scale;
          if (!scale) return;
          render(Number(scale));
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.scale === scale ? 'true' : 'false');
          });
        });

        container.appendChild(controls);
        container.appendChild(stage);
        render(18);
        return { destroy() { stage.innerHTML = ''; } };
      },
    });
  }
})(window);
