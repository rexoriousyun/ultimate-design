/**
 * LED matrix — text rendered as a grid of lit dots, like a departure board.
 *
 * The trick that makes this cheap: do not build a font. Draw the text to an offscreen canvas
 * with `fillText`, read it back, and sample it on a grid — the browser's own glyph rasteriser
 * becomes the bitmap source, so every font, weight and language you have works for free.
 *
 * Hand-rolling a 5x7 character map is the usual approach and it is a trap: it locks you to
 * ASCII, to one face, and to a lot of data. Sampling the rasteriser is a dozen lines and
 * handles Hangul.
 *
 * Two details decide whether it reads as a board rather than as a blurry screenshot:
 *
 *   - **Unlit dots are drawn too, dimly.** A grid with only the lit cells looks like a
 *     dissolve. The dark cells are what make it hardware.
 *   - **Sample the cell centre, not its corner, and threshold hard.** Averaging the cell gives
 *     you antialiased grey dots, which is a photo of a board rather than a board.
 *
 * Under prefers-reduced-motion the scroll stops and the text sits still. If it does not fit,
 * it is truncated rather than silently clipped — `overflowing` says so, because a departure
 * board that quietly drops the destination is worse than one that says nothing.
 *
 * Usage: const board = UILedMatrix.mount(canvasEl, { text: 'NOW BOARDING' });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  let scratch = null;

  /**
   * Samples `text` into a boolean grid using the browser's own text rasteriser.
   * @returns {{cols: number, rows: number, on: boolean[]}}
   */
  function sample(text, rows, opts) {
    const o = opts || {};
    const font = o.font || '700 %hpx system-ui, sans-serif';
    if (!scratch) scratch = document.createElement('canvas');

    // One offscreen pixel per LED. The rasteriser does the glyph work; this only reads it.
    const px = 1;
    const height = rows * px;
    const ctx0 = scratch.getContext('2d');
    ctx0.font = font.replace('%h', String(Math.round(rows * 0.82)));
    const width = Math.max(1, Math.ceil(ctx0.measureText(text).width) + 2);

    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.font = font.replace('%h', String(Math.round(rows * 0.82)));
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 1, height / 2);

    const data = ctx.getImageData(0, 0, width, height).data;
    const cols = width;
    const on = new Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Centre sample and a hard threshold. Averaging the cell yields antialiased greys,
        // which reads as a photograph of a board rather than as a board.
        const i = (y * width + x) * 4 + 3;
        on[y * cols + x] = data[i] > 110;
      }
    }
    return { cols, rows, on };
  }

  function mount(canvas, opts) {
    const o = opts || {};
    const text = o.text == null ? 'NOW BOARDING' : o.text;
    const rows = o.rows == null ? 9 : o.rows;
    const dot = o.dot == null ? 5 : o.dot;
    const gap = o.gap == null ? 2 : o.gap;
    const lit = o.lit || '#ffb703';
    const unlit = o.unlit || 'rgba(255,255,255,0.07)';
    const background = o.background || '#0d0f0c';
    const speed = o.speed == null ? 26 : o.speed;
    const scroll = o.scroll == null ? true : o.scroll;

    const grid = sample(text, rows, o);
    const cell = dot + gap;
    let offset = 0;
    let raf = null;
    let last = 0;

    const visibleCols = () => Math.max(1, Math.floor((canvas.clientWidth || 320) / cell));
    const overflowing = grid.cols > visibleCols();

    function paint() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 320;
      const cssH = rows * cell;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cssW, cssH);

      const cols = Math.ceil(cssW / cell);
      const span = overflowing && scroll ? grid.cols + cols : grid.cols;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const sx = ((x + Math.floor(offset)) % span + span) % span;
          const isOn = sx < grid.cols && grid.on[y * grid.cols + sx];
          // Unlit cells are drawn too — without them this reads as a dissolve, not hardware.
          ctx.fillStyle = isOn ? lit : unlit;
          ctx.beginPath();
          ctx.arc(x * cell + dot / 2, y * cell + dot / 2, dot / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function tick(now) {
      if (now - last > 1000 / speed) { offset += 1; last = now; paint(); }
      raf = requestAnimationFrame(tick);
    }

    paint();
    if (scroll && overflowing && !REDUCED()) raf = requestAnimationFrame(tick);

    let ro;
    if (window.ResizeObserver) { ro = new ResizeObserver(paint); ro.observe(canvas); }

    return {
      /** True when the text is wider than the board. The caller has to say so in text. */
      get overflowing() { return overflowing; },
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ro) ro.disconnect();
      },
    };
  }

  global.UILedMatrix = { mount, sample };

  if (global.UI) {
    global.UI.define({
      id: 'led-matrix',
      primitive: 'canvas',
      label: 'LED matrix',
      source: 'recipes/web/led-matrix.js',
      export: 'UILedMatrix',
      description:
        'Departure-board text as lit dots, sampled from the browser’s own glyph rasteriser — every font and language for free, no bitmap font.',
      props: {
        text: {
          type: 'string', default: 'NOW BOARDING',
          controls: 'The message on the board. Any font and language works, because the browser draws the glyphs.',
          sweep: ['NOW BOARDING', 'GATE 12', 'DELAYED 25 MIN'],
          cost: 'one offscreen draw per change',
        },
        rows: {
          type: 'number', default: 9,
          controls: 'Dots per character height: resolution. Few rows read as chunky hardware, many as a smooth sign.',
          range: [5, 16], sweep: [5, 7, 9, 12, 16],
          breaks: { below: 'Under ~6 rows letters lose their counters and stop being legible.' },
          cost: 'linear in dots',
        },
        dot: {
          type: 'number', default: 5, unit: 'px',
          controls: 'Dot size: the scale of the board on the page.',
          range: [2, 10], sweep: [2, 3, 5, 7, 10],
          cost: 'none',
        },
        scroll: {
          type: 'boolean', default: true,
          controls: 'Whether text that does not fit scrolls across like a ticker.',
          unswept: 'motion: under reduced motion the board stops scrolling, as designed, so no still frame shows it',
        },
      },
      snippet:
        "const board = UILedMatrix.mount(canvasEl, {\n  text: 'NOW BOARDING · GATE 12',\n  rows: 9,\n});\n\nif (board.overflowing) { /* the full string must also exist as text */ }",
      preview(container, props) {
        const p = props || {};
        const cv = document.createElement('canvas');
        // The text is the content, and a canvas holds none — so it is named, not hidden.
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', p.text || 'NOW BOARDING');
        cv.style.cssText = 'width:100%;display:block;border-radius:6px';
        container.appendChild(cv);
        const board = mount(cv, { text: p.text, rows: p.rows, dot: p.dot, scroll: p.scroll });
        return { destroy() { board.destroy(); container.innerHTML = ''; } };
      },
      demo(container) {
        const made = [];
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:grid;gap:10px';
        container.appendChild(wrap);
        // Latin and Hangul from the same code path — the argument for sampling the rasteriser
        // instead of shipping a 5x7 character map.
        ['NOW BOARDING · GATE 12', '도토리 · 다람쥐', '2026'].forEach((text) => {
          const cv = document.createElement('canvas');
          cv.setAttribute('role', 'img');
          cv.setAttribute('aria-label', text);
          cv.style.cssText = 'width:100%;display:block;border-radius:6px';
          wrap.appendChild(cv);
          made.push(mount(cv, { text, rows: 9 }));
        });
        return { destroy() { made.forEach((m) => m.destroy()); container.innerHTML = ''; } };
      },
    });
  }
})(window);
