/**
 * Halftone — render an image as a grid of dots whose radius tracks local darkness.
 *
 * The technique is a downsample plus a redraw: read the average luminance of each cell, then
 * draw one dot per cell sized by that average. The detail that makes it look like print rather
 * than like a bad mosaic is the 45-degree screen angle — a straight grid reads as pixelation,
 * and rotating the lattice is the entire difference.
 *
 * Sampling one pixel per cell instead of averaging is the common shortcut and it aliases
 * badly on anything with fine detail, which is exactly the kind of image people halftone.
 *
 * Static, so no reduced-motion branch.
 *
 * Usage: UIHalftone.apply(canvasEl, { cell: 8, angle: 45 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  /**
   * Replaces whatever is on the canvas with its halftone.
   * @param {HTMLCanvasElement} canvas
   * @param {{cell?: number, angle?: number, ink?: string, paper?: string, invert?: boolean}} [opts]
   */
  function apply(canvas, opts) {
    const o = opts || {};
    const cell = Math.max(2, o.cell == null ? 8 : o.cell);
    const angle = (o.angle == null ? 45 : o.angle) * Math.PI / 180;
    const ink = o.ink || '#0b1d12';
    const paper = o.paper || '#ffffff';
    const invert = !!o.invert;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) return;

    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.ceil(Math.sqrt(w * w + h * h) / cell) + 1;

    // Walk the ROTATED lattice, not the pixel grid — the 45-degree screen is what reads as
    // print instead of as pixelation.
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const cx = (i * cos - j * sin) * cell + w / 2;
        const cy = (i * sin + j * cos) * cell + h / 2;
        if (cx < -cell || cx > w + cell || cy < -cell || cy > h + cell) continue;

        // Average the cell rather than sampling its centre; a point sample aliases.
        let sum = 0;
        let n = 0;
        const x0 = Math.max(0, Math.floor(cx - cell / 2));
        const x1 = Math.min(w, Math.ceil(cx + cell / 2));
        const y0 = Math.max(0, Math.floor(cy - cell / 2));
        const y1 = Math.min(h, Math.ceil(cy + cell / 2));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const p = (y * w + x) * 4;
            sum += 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
            n++;
          }
        }
        if (n === 0) continue;
        const lum = sum / n / 255;
        const darkness = invert ? lum : 1 - lum;
        const r = (darkness * cell) / 1.6;
        if (r < 0.25) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  global.UIHalftone = { apply };

  if (global.UI) {
    function paintSource(canvas, w, h) {
      const ctx = canvas.getContext('2d');
      const g = ctx.createRadialGradient(w * 0.35, h * 0.35, 5, w * 0.5, h * 0.5, w * 0.75);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#111111');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.moveTo(0, h); ctx.lineTo(w * 0.4, h * 0.45); ctx.lineTo(w * 0.62, h * 0.7);
      ctx.lineTo(w * 0.85, h * 0.38); ctx.lineTo(w, h * 0.62); ctx.lineTo(w, h);
      ctx.closePath(); ctx.fill();
    }

    function make(row, cell, angle, label, invert) {
      const fig = document.createElement('figure');
      fig.style.cssText = 'margin:0;display:grid;gap:0.35rem';
      const canvas = document.createElement('canvas');
      canvas.width = 220; canvas.height = 150;
      canvas.style.cssText = 'width:220px;height:150px;display:block;border-radius:6px';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', label);
      fig.appendChild(canvas);
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      cap.style.cssText = 'font-size:0.8rem;color:#1a1a1a';
      fig.appendChild(cap);
      row.appendChild(fig);
      paintSource(canvas, 220, 150);
      if (cell) apply(canvas, { cell: cell, angle: angle, invert: invert });
    }

    global.UI.define({
      id: 'halftone',
      primitive: 'canvas',
      label: 'Halftone',
      source: 'recipes/web/halftone.js',
      export: 'UIHalftone',
      description: 'Print-style dot screen on a rotated lattice, with each dot sized by its cell average.',
      props: {
        cell: {
          type: 'number',
          default: 8,
          unit: 'px',
          controls: 'Dot pitch. Sets how coarse the screen reads — the single knob between "a printed image" and "a pattern of circles".',
          range: [2, 32],
          sweep: [2, 3, 4, 6, 8, 12, 16, 24, 32],
          breaks: {
            below: 'Clamped to 2 in apply(). Near 2 the radius falls under the 0.25px cull and light cells drop out rather than shrink.',
            above: 'Past ~32 on the 220x150 preview source there are too few cells to carry the image.',
          },
          cost: 'none — the per-cell average reads every source pixel exactly once at any cell size',
        },
        angle: {
          type: 'number',
          default: 45,
          unit: 'deg',
          controls: 'Screen angle. At 0 the lattice is axis-aligned and reads as pixelation; rotating it is the entire difference between print and mosaic.',
          range: [0, 90],
          sweep: [0, 15, 30, 45, 60, 75],
          // The lattice is square, so these render identically. The sweep asserts it.
          identical: [[0, 90]],
          cost: 'none',
        },
        invert: {
          type: 'boolean',
          default: false,
          controls: 'Swaps ink for paper — dot radius tracks lightness instead of darkness.',
          sweep: [false, true],
          cost: 'none',
        },
      },
      snippet:
        "// Paint or drawImage onto the canvas first, then:\nUIHalftone.apply(canvasEl, { cell: 8, angle: 45, ink: '#0b1d12' });",
      preview(container, props) {
        const p = props || {};
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:1rem;flex-wrap:wrap';
        container.appendChild(row);
        // Every declared prop is forwarded: the sweep found invert declared here and dropped.
        make(row, p.cell == null ? 8 : p.cell, p.angle == null ? 45 : p.angle, 'Halftone', !!p.invert);
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:1rem;flex-wrap:wrap';
        container.appendChild(row);
        make(row, 0, 0, 'Source');
        make(row, 6, 45, 'cell 6, 45°');
        make(row, 11, 15, 'cell 11, 15°');
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
