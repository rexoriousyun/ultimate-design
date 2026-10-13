/**
 * Spirograph — hypotrochoid and epitrochoid curves, the toy as a parametric equation.
 *
 * Pure maths, no assets, no animation, and endlessly generative: two radii and a pen offset
 * describe every pattern the plastic toy could make and a great many it could not. Good for
 * empty states, loading art, generated avatars, and section dividers that are never twice the
 * same without ever being random.
 *
 * The equations are the recipe:
 *
 *     hypotrochoid (pen inside the rolling circle)
 *       x = (R − r)·cos t + d·cos((R − r)/r · t)
 *       y = (R − r)·sin t − d·sin((R − r)/r · t)
 *
 *     epitrochoid (rolling outside) is the same with (R + r) and a sign flip.
 *
 * The part that is not in the equations, and is the reason this is worth copying:
 *
 *   - **How long to run t.** The curve closes after `2π · r / gcd(R, r)` — compute it, do not
 *     guess a big number. Guessing low leaves the figure visibly unfinished; guessing high
 *     redraws the same path many times, which on a translucent stroke silently darkens it.
 *   - **Step count scales with path length**, not a fixed 1,000. A large R with a small r is a
 *     long path, and a fixed step count turns its curves into visible polygons.
 *
 * Static by nature, so there is no reduced-motion branch — nothing moves.
 *
 * Usage: UISpirograph.draw(canvasEl, { R: 120, r: 47, d: 70 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }

  /**
   * The curve as points, in a coordinate space centred on (0, 0).
   * @param {{R?: number, r?: number, d?: number, epi?: boolean, quality?: number}} [opts]
   * @returns {Array<[number, number]>}
   */
  function points(opts) {
    const o = opts || {};
    const R = o.R == null ? 120 : o.R;
    const r = o.r == null ? 47 : o.r;
    const d = o.d == null ? 70 : o.d;
    const epi = !!o.epi;
    const quality = o.quality == null ? 1 : o.quality;

    // Closes after this many turns. Computed, not guessed: too few leaves the figure
    // unfinished, too many redraws the same path and darkens a translucent stroke.
    const turns = r / gcd(R, r);
    const total = Math.PI * 2 * turns;
    const base = epi ? R + r : R - r;
    const ratio = base / r;

    // Steps follow path length rather than a fixed count, or a long path polygonises.
    const steps = Math.max(200, Math.round((Math.abs(base) + Math.abs(d)) * turns * 0.9 * quality));

    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * total;
      const x = base * Math.cos(t) + (epi ? -d : d) * Math.cos(ratio * t);
      const y = base * Math.sin(t) - d * Math.sin(ratio * t);
      out.push([x, y]);
    }
    return out;
  }

  /** Paints one curve, centred and scaled to fit the canvas. */
  function draw(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = o.width == null ? canvas.clientWidth || 320 : o.width;
    const cssH = o.height == null ? canvas.clientHeight || 320 : o.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, cssW, cssH); }
    else ctx.clearRect(0, 0, cssW, cssH);

    const pts = points(o);
    let max = 0;
    for (const [x, y] of pts) max = Math.max(max, Math.abs(x), Math.abs(y));
    const scale = (Math.min(cssW, cssH) / 2 - 8) / (max || 1);

    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(scale, scale);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.restore();

    ctx.strokeStyle = o.color || '#14532d';
    ctx.globalAlpha = o.opacity == null ? 0.85 : o.opacity;
    ctx.lineWidth = o.lineWidth == null ? 1 : o.lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
    return { points: pts.length, turns: r_turns(o) };
  }

  function r_turns(o) {
    const R = o.R == null ? 120 : o.R;
    const r = o.r == null ? 47 : o.r;
    return r / gcd(R, r);
  }

  global.UISpirograph = { draw, points, gcd };

  if (global.UI) {
    global.UI.define({
      id: 'spirograph',
      primitive: 'canvas',
      label: 'Spirograph',
      source: 'recipes/web/spirograph.js',
      export: 'UISpirograph',
      description:
        'Hypotrochoid and epitrochoid curves from two radii and a pen offset — generative art with no randomness and no assets.',
      props: {
        R: {
          type: 'number', default: 120,
          controls: 'Radius of the fixed ring: with r it sets how many petals the figure has (R / gcd(R, r)).',
          range: [60, 160], sweep: [60, 90, 120, 140, 160],
          cost: 'path length, and so steps, grows with R / gcd(R, r)',
        },
        r: {
          type: 'number', default: 47,
          controls: 'Radius of the rolling circle: small r against R gives many fine loops, near R few broad ones.',
          range: [10, 100], sweep: [10, 30, 47, 70, 100],
          cost: 'as R',
        },
        d: {
          type: 'number', default: 70,
          controls: 'Pen offset from the rolling centre: small is a gentle rosette, past r the curve loops back on itself.',
          range: [10, 120], sweep: [10, 40, 70, 100, 120],
          cost: 'none',
        },
        epi: {
          type: 'boolean', default: false,
          controls: 'Roll outside the ring (epitrochoid, an open flower) instead of inside (hypotrochoid, a dense star).',
          sweep: [false, true],
          cost: 'none',
        },
      },
      snippet:
        "UISpirograph.draw(canvasEl, { R: 120, r: 47, d: 70, color: 'var(--accent)' });\n\n// Or take the points and render them however you like:\nconst pts = UISpirograph.points({ R: 96, r: 35, d: 84 });",
      preview(container, props) {
        const p = props || {};
        const cv = document.createElement('canvas');
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', `Spirograph curve, R ${p.R ?? 120}, r ${p.r ?? 47}, offset ${p.d ?? 70}`);
        cv.style.cssText = 'width:300px;height:300px;display:block';
        container.appendChild(cv);
        draw(cv, { R: p.R, r: p.r, d: p.d, epi: p.epi, width: 300, height: 300 });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap';
        container.appendChild(row);
        // Four parameter sets, no randomness — the same four every time, which is what makes
        // this usable for a generated avatar keyed on an id.
        [
          { R: 120, r: 47, d: 70, color: '#14532d' },
          { R: 120, r: 84, d: 90, color: '#2f9e4f' },
          { R: 96, r: 35, d: 84, epi: true, color: '#b45309' },
          { R: 130, r: 29, d: 110, color: '#1d4ed8' },
        ].forEach((cfg, i) => {
          const cv = document.createElement('canvas');
          cv.setAttribute('role', 'img');
          cv.setAttribute('aria-label', `Spirograph curve ${i + 1} of 4`);
          cv.style.cssText = 'width:150px;height:150px;display:block';
          row.appendChild(cv);
          draw(cv, { ...cfg, width: 150, height: 150 });
        });
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
