/**
 * Hit grid — a canvas cell grid that reflows by arithmetic instead of breakpoints, and
 * resolves which cell the pointer is over without hit-testing anything.
 *
 * The technique is the index arithmetic. Given a cell pitch, the columns that fit are
 * `floor((w + gap) / (cell + gap))`, and the cell under a pointer is
 * `floor(offsetX / (cell + gap))` — one division per axis, no per-cell loop, no event
 * listeners on individual elements. That is what makes a grid of ten thousand cells cost the
 * same to interrogate as a grid of ten, and it is the reason to draw a grid on a canvas at
 * all rather than as DOM nodes.
 *
 * The original pen tested the pointer against every cell's bounds on every mousemove, at 1000
 * cells. That works and is the version worth replacing: the loop is doing by search what one
 * division already knows.
 *
 * "Responsive without media queries" falls out of the same arithmetic — the column count is a
 * function of the measured container, so the grid reflows at every width rather than at three
 * of them. Set `cell` and the breakpoints stop existing.
 *
 * This differs from `heatmap-grid` and `led-matrix`, which draw fixed-shape grids from data.
 * Here the shape is derived from the box and the interesting part is the inverse mapping back
 * from a coordinate to a cell.
 *
 * There is no animation loop at all, so prefers-reduced-motion needs no branch: the grid paints
 * once and repaints only when the pointer moves or the container resizes.
 *
 * Ported from https://codepen.io/rexoriousyun/pen/OQwoXQ
 *
 * Usage: const grid = UIHitGrid.mount(canvasEl, { cell: 40, gap: 10 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function mount(canvas, opts) {
    const o = opts || {};
    const cell = o.cell == null ? 40 : o.cell;
    const gap = o.gap == null ? 10 : o.gap;
    const lineWidth = o.lineWidth == null ? 3 : o.lineWidth;
    const stroke = o.stroke || '#2f9e4f';
    const fill = o.fill || 'rgba(47,158,79,0.45)';
    const onHover = typeof o.onHover === 'function' ? o.onHover : null;

    const ctx = canvas.getContext('2d');
    const pitch = cell + gap;
    let w = 1;
    let h = 1;
    let cols = 0;
    let rows = 0;
    let active = -1;   // flat index of the hovered cell, -1 for none
    let ro = null;

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The last cell needs no trailing gap, hence the + gap on the numerator.
      cols = Math.max(1, Math.floor((w + gap) / pitch));
      rows = Math.max(1, Math.floor((h + gap) / pitch));
    }

    /** Coordinate to flat index, by division. -1 when the point lands in a gap. */
    function indexAt(x, y) {
      const col = Math.floor(x / pitch);
      const row = Math.floor(y / pitch);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
      // Inside the cell rather than the gutter that follows it.
      if (x - col * pitch > cell || y - row * pitch > cell) return -1;
      return row * cols + col;
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;

      // Centre the block of cells in whatever box it was given, so the leftover from the
      // division reads as symmetric margin instead of a gap on one side.
      const offsetX = (w - (cols * pitch - gap)) / 2;
      const offsetY = (h - (rows * pitch - gap)) / 2;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          const x = offsetX + col * pitch;
          const y = offsetY + row * pitch;
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          if (i === active) {
            ctx.fillStyle = fill;
            ctx.fill();
          }
          ctx.stroke();
        }
      }
    }

    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      const offsetX = (w - (cols * pitch - gap)) / 2;
      const offsetY = (h - (rows * pitch - gap)) / 2;
      const next = indexAt(e.clientX - rect.left - offsetX, e.clientY - rect.top - offsetY);
      if (next === active) return;   // only repaint when the answer changed
      active = next;
      draw();
      if (onHover) onHover(active === -1 ? null : { index: active, col: active % cols, row: Math.floor(active / cols) });
    }

    function onPointerLeave() {
      if (active === -1) return;
      active = -1;
      draw();
      if (onHover) onHover(null);
    }

    function onResize() {
      size();
      active = -1;
      draw();
    }

    size();
    draw();

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    if (window.ResizeObserver) {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }

    return {
      cellCount: function () { return cols * rows; },
      destroy: function () {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
      },
    };
  }

  global.UIHitGrid = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'hit-grid',
      primitive: 'canvas',
      label: 'Hit grid',
      source: 'recipes/web/hit-grid.js',
      export: 'UIHitGrid',
      description:
        'Canvas cell grid whose column count is arithmetic rather than breakpoints, and which resolves the hovered cell by division instead of a hit-test loop.',
      harvested_from: 'https://codepen.io/rexoriousyun/pen/OQwoXQ',
      props: {
        cell: {
          type: 'number', default: 40, unit: 'px',
          controls: 'Cell pitch. The column count follows from it and the container width, so this one number replaces breakpoints.',
          range: [16, 96], sweep: [16, 24, 40, 64, 96],
          cost: 'linear in cells to draw; hover lookup is one division at any size',
        },
        gap: {
          type: 'number', default: 10, unit: 'px',
          controls: 'Space between cells; also part of the pitch the column count is computed from.',
          range: [0, 24], sweep: [0, 4, 10, 16, 24],
          cost: 'none',
        },
        lineWidth: {
          type: 'number', default: 3, unit: 'px',
          controls: 'Cell outline weight: light reads as a calendar, heavy as a board.',
          range: [1, 6], sweep: [1, 2, 3, 4, 6],
          cost: 'none',
        },
      },
      snippet:
        "const grid = UIHitGrid.mount(canvasEl, {\n  cell: 40,\n  gap: 10,\n  onHover: (c) => console.log(c && c.col, c && c.row),\n});\n\ngrid.destroy();",
      preview(container, props) {
        const p = props || {};
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#f4faf6;border-radius:8px';
        container.appendChild(canvas);
        const grid = mount(canvas, { cell: p.cell, gap: p.gap, lineWidth: p.lineWidth });
        return { destroy: grid.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-cell="20">20px</button>' +
          '<button class="ui-demo-ctl" data-cell="40" aria-pressed="true">40px</button>' +
          '<button class="ui-demo-ctl" data-cell="72">72px</button>';

        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#f4faf6;border-radius:8px';

        const readout = document.createElement('p');
        readout.style.cssText = 'margin:8px 0 0;font:12px ui-monospace,monospace;color:#555';
        readout.textContent = 'hover the grid';

        container.appendChild(controls);
        container.appendChild(canvas);
        container.appendChild(readout);

        function report(c) {
          readout.textContent = c ? `col ${c.col} · row ${c.row} · index ${c.index}` : 'hover the grid';
        }

        let grid = mount(canvas, { cell: 40, onHover: report });
        controls.addEventListener('click', function (e) {
          const cell = e.target.dataset && e.target.dataset.cell;
          if (!cell) return;
          grid.destroy();
          grid = mount(canvas, { cell: Number(cell), onHover: report });
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.cell === cell ? 'true' : 'false');
          });
        });

        return { destroy: function () { grid.destroy(); } };
      },
    });
  }
})(window);
