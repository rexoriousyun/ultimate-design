/**
 * VHS / glitch — chromatic aberration, scanlines and torn bands over whatever is on the canvas.
 *
 * The effect people reach for a WebGL shader to get, done with three `getImageData` passes.
 * Worth having as a recipe because the naive version — random noise and a hue shift — looks
 * like static, not like tape. What reads as VHS is specifically:
 *
 *   - **Per-channel horizontal offset.** Red pushed one way, blue the other, green left alone.
 *     That is chromatic aberration, and it is doing most of the work. Offsetting all three
 *     together just blurs.
 *   - **Torn bands, not per-pixel noise.** A few horizontal slabs displaced by a few pixels
 *     each, with hard edges. Tape damage is structured; noise is not.
 *   - **Scanlines with a gap, drawn last.** Every other row darkened, over the top of the
 *     displacement so the lines stay straight while the picture tears underneath.
 *
 * The ordering matters and is the part that is easy to get wrong: tear first, split channels
 * second, scanlines last. Any other order and the scanlines tear with the image, which reads
 * as a broken screen rather than a bad tape.
 *
 * Under prefers-reduced-motion it paints one glitched frame and stops. The look survives; the
 * flicker — which is the part that is genuinely unpleasant for photosensitive viewers — does
 * not.
 *
 * Usage: const g = UIVhsGlitch.mount(canvasEl, { paint: drawMyScene });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  function rng(seed) {
    let s = (seed | 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }

  /**
   * Applies the effect in place to whatever is already painted.
   * @param {HTMLCanvasElement} canvas
   * @param {{split?: number, bands?: number, tear?: number, scanline?: number, seed?: number}} [opts]
   */
  function apply(canvas, opts) {
    const o = opts || {};
    const split = o.split == null ? 4 : o.split;
    const bands = o.bands == null ? 5 : o.bands;
    const tear = o.tear == null ? 14 : o.tear;
    const scanline = o.scanline == null ? 0.22 : o.scanline;
    const rand = rng(o.seed == null ? 1 : o.seed);

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w < 2 || h < 2) return;

    const src = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const s = src.data;
    const d = out.data;

    // 1. Torn bands — a few slabs shifted sideways, hard-edged.
    const shiftForRow = new Int16Array(h);
    for (let b = 0; b < bands; b++) {
      const top = Math.floor(rand() * h);
      const depth = Math.max(2, Math.floor(rand() * (h / 12)));
      const dx = Math.round((rand() * 2 - 1) * tear);
      for (let y = top; y < Math.min(h, top + depth); y++) shiftForRow[y] = dx;
    }

    // 2. Per-channel offset, sampled through the tear. Red and blue pull apart; green holds
    //    the image together, which is why the result still reads as a picture.
    for (let y = 0; y < h; y++) {
      const rowShift = shiftForRow[y];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const sampleAt = (dx) => {
          const sx = Math.min(w - 1, Math.max(0, x + rowShift + dx));
          return (y * w + sx) * 4;
        };
        d[i] = s[sampleAt(split)];
        d[i + 1] = s[sampleAt(0) + 1];
        d[i + 2] = s[sampleAt(-split) + 2];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);

    // 3. Scanlines last, so they stay straight while the picture tears underneath.
    ctx.fillStyle = `rgba(0,0,0,${scanline})`;
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  }

  function mount(canvas, opts) {
    const o = opts || {};
    const paint = typeof o.paint === 'function' ? o.paint : defaultScene;
    let raf = null;
    let frame = 0;

    function draw() {
      const ctx = canvas.getContext('2d');
      paint(ctx, canvas.width, canvas.height);
      apply(canvas, { ...o, seed: frame + 1 });
    }

    function tick() {
      // Tape damage is not smooth — re-seeding every frame reads as strobing. Roughly eight
      // times a second is the rate that reads as a bad tape rather than a broken monitor.
      const next = Math.floor(performance.now() / 120);
      if (next !== frame) { frame = next; draw(); }
      raf = requestAnimationFrame(tick);
    }

    draw();
    if (!REDUCED()) tick();

    return {
      destroy() { if (raf !== null) cancelAnimationFrame(raf); raf = null; },
    };
  }

  /** A stand-in scene, so the recipe ships no asset and the channel split has edges to bite. */
  function defaultScene(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b1d33');
    g.addColorStop(1, '#14532d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.4, Math.min(w, h) * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6f1e7';
    ctx.font = `800 ${Math.round(h * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('PLAY', w / 2, h * 0.82);
  }

  global.UIVhsGlitch = { mount, apply, defaultScene };

  if (global.UI) {
    global.UI.define({
      id: 'vhs-glitch',
      primitive: 'canvas',
      label: 'VHS glitch',
      source: 'recipes/web/vhs-glitch.js',
      export: 'UIVhsGlitch',
      description:
        'Chromatic aberration, torn bands and scanlines over any canvas — the tape look, in three getImageData passes and no shader.',
      props: {
        split: {
          type: 'number', default: 4, unit: 'px',
          controls: 'Chromatic aberration: how far red and blue are pushed apart. This does most of the tape look.',
          range: [0, 12], sweep: [0, 2, 4, 8, 12],
          cost: 'one getImageData pass',
        },
        bands: {
          type: 'number', default: 5,
          controls: 'How many torn horizontal slabs: a clean signal at 0, a damaged tape at many.',
          range: [0, 12], sweep: [0, 3, 5, 8, 12],
          cost: 'none',
        },
        tear: {
          type: 'number', default: 14, unit: 'px',
          controls: 'How far each torn slab is displaced sideways.',
          range: [0, 40], sweep: [0, 7, 14, 24, 40],
          cost: 'none',
        },
        scanline: {
          type: 'number', default: 0.22,
          controls: 'Darkness of the scanlines drawn over everything: faint CRT texture or heavy bars.',
          range: [0, 0.6], sweep: [0, 0.1, 0.22, 0.4, 0.6],
          cost: 'one pass',
        },
      },
      snippet:
        "const glitch = UIVhsGlitch.mount(canvasEl, {\n  paint: (ctx, w, h) => { /* draw your scene */ },\n  split: 4,\n});\n\n// Or apply once to whatever is already painted:\nUIVhsGlitch.apply(canvasEl, { split: 6, bands: 8 });",
      preview(container, props) {
        const p = props || {};
        const cv = document.createElement('canvas');
        cv.width = 460; cv.height = 240;
        cv.setAttribute('aria-hidden', 'true');
        cv.style.cssText = 'width:100%;max-width:460px;display:block;border-radius:8px';
        container.appendChild(cv);
        const g = mount(cv, { split: p.split, bands: p.bands, tear: p.tear, scanline: p.scanline });
        return { destroy() { g.destroy(); container.innerHTML = ''; } };
      },
      demo(container) {
        const cv = document.createElement('canvas');
        cv.width = 460; cv.height = 240;
        cv.setAttribute('aria-hidden', 'true');
        cv.style.cssText = 'width:100%;max-width:460px;display:block;border-radius:8px';
        container.appendChild(cv);
        const g = mount(cv, {});
        return { destroy() { g.destroy(); container.innerHTML = ''; } };
      },
    });
  }
})(window);
