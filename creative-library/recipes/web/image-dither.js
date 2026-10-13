/**
 * Floyd–Steinberg dithering — reduce an image to few colours without banding.
 *
 * The reason a recipe exists for this rather than a one-line threshold: plain quantisation
 * produces flat posterised bands, and dithering hides them by pushing each pixel's rounding
 * error into its not-yet-processed neighbours, in the fixed 7/16, 3/16, 5/16, 1/16 pattern.
 * That error diffusion is the entire algorithm and the part that is easy to get subtly wrong
 * — the weights must be applied to the *unprocessed* neighbours only, or the error feeds back
 * and the image crawls toward black.
 *
 * Static: there is nothing to animate, so there is no reduced-motion branch.
 *
 * Usage: UIImageDither.apply(canvasEl, { levels: 2 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  /**
   * Dithers whatever is already painted on the canvas, in place.
   * @param {HTMLCanvasElement} canvas
   * @param {{levels?: number, mono?: boolean}} [opts]
   */
  function apply(canvas, opts) {
    const o = opts || {};
    const levels = Math.max(2, o.levels == null ? 2 : o.levels);
    const mono = o.mono == null ? true : o.mono;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) return;

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const step = 255 / (levels - 1);

    if (mono) {
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = g;
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < (mono ? 1 : 3); c++) {
          const old = d[i + c];
          const next = Math.round(old / step) * step;
          const err = old - next;
          d[i + c] = next;
          if (mono) { d[i + 1] = next; d[i + 2] = next; }
          // Forward only: the four unprocessed neighbours, in the classic weights.
          spread(d, w, h, x + 1, y, c, err * 7 / 16, mono);
          spread(d, w, h, x - 1, y + 1, c, err * 3 / 16, mono);
          spread(d, w, h, x, y + 1, c, err * 5 / 16, mono);
          spread(d, w, h, x + 1, y + 1, c, err * 1 / 16, mono);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function spread(d, w, h, x, y, c, amount, mono) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    const v = Math.max(0, Math.min(255, d[i + c] + amount));
    d[i + c] = v;
    if (mono) { d[i] = v; d[i + 1] = v; d[i + 2] = v; }
  }

  global.UIImageDither = { apply };

  if (global.UI) {
    /** A generated source, so the recipe ships no asset and the ramp is exercised end to end. */
    function paintSource(canvas, w, h) {
      const ctx = canvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#0b1d12');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(w * 0.3, h * 0.4, Math.min(w, h) * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, h); ctx.lineTo(w * 0.35, h * 0.5); ctx.lineTo(w * 0.6, h * 0.72);
      ctx.lineTo(w * 0.85, h * 0.42); ctx.lineTo(w, h * 0.66); ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    }

    function make(container, levels, mono, label) {
      const fig = document.createElement('figure');
      fig.style.cssText = 'margin:0;display:grid;gap:0.35rem';
      const canvas = document.createElement('canvas');
      canvas.width = 220; canvas.height = 150;
      canvas.style.cssText = 'width:220px;height:150px;display:block;image-rendering:pixelated;border-radius:6px';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', label);
      fig.appendChild(canvas);
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      cap.style.cssText = 'font-size:0.8rem;color:#1a1a1a';
      fig.appendChild(cap);
      container.appendChild(fig);
      paintSource(canvas, 220, 150);
      if (levels) apply(canvas, { levels: levels, mono: mono });
    }

    global.UI.define({
      id: 'image-dither',
      primitive: 'canvas',
      label: 'Image dither',
      source: 'recipes/web/image-dither.js',
      export: 'UIImageDither',
      description: 'Floyd–Steinberg error diffusion — few colours, no banding. Operates in place on a canvas.',
      props: {
        levels: {
          type: 'number', default: 2,
          controls: 'Colours per channel. 2 is the classic 1-bit look; more levels approach the original image.',
          range: [2, 8], sweep: [2, 3, 4, 6, 8],
          breaks: { below: 'Below 2 there is nothing to dither between; it is clamped to 2.' },
          cost: 'one pass over every pixel',
        },
        mono: {
          type: 'boolean', default: true,
          controls: 'Greyscale first (newspaper, e-ink) or dither each channel (a few-colour retro photo).',
          sweep: [false, true],
          cost: 'none',
        },
      },
      snippet:
        "// Paint or drawImage onto the canvas first, then:\nUIImageDither.apply(canvasEl, { levels: 2, mono: true });",
      preview(container, props) {
        const p = props || {};
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:1rem;flex-wrap:wrap';
        container.appendChild(row);
        make(row, p.levels == null ? 2 : p.levels, p.mono == null ? true : p.mono, 'Dithered');
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:1rem;flex-wrap:wrap';
        container.appendChild(row);
        make(row, 0, true, 'Source');
        make(row, 2, true, '2 levels');
        make(row, 4, true, '4 levels');
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
