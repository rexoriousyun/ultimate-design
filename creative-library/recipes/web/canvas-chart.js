/**
 * Canvas 2D chart module — data-driven line/bar renderer.
 * Usage:
 *   const chart = UICanvasChart.mount(canvasEl, {
 *     type: 'line' | 'bar',
 *     data: [{ label: 'Mon', value: 12 }, ...],
 *     color: '#2f9e4f',
 *     grid: '#e5e7eb',
 *     text: '#6b7280',
 *   });
 *   chart.update(newData);
 *   chart.destroy();
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function mount(canvas, opts) {
    const state = {
      type: opts.type || 'line',
      data: opts.data || [],
      color: opts.color || '#2f9e4f',
      grid: opts.grid || 'rgba(0,0,0,0.08)',
      text: opts.text || '#6b7280',
      padding: opts.padding || { top: 16, right: 16, bottom: 28, left: 36 },
    };
    const ctx = canvas.getContext('2d');
    let ro;

    function size() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: rect.width, h: rect.height };
    }

    function draw() {
      const { w, h } = size();
      ctx.clearRect(0, 0, w, h);
      const { top, right, bottom, left } = state.padding;
      const plotW = w - left - right;
      const plotH = h - top - bottom;
      const data = state.data;
      if (!data.length || plotW <= 0 || plotH <= 0) return;

      const max = Math.max(...data.map((d) => d.value), 1);
      const min = Math.min(0, ...data.map((d) => d.value));
      const range = max - min || 1;
      const yFor = (v) => top + plotH - ((v - min) / range) * plotH;
      const xFor = (i) =>
        left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

      // gridlines + y labels
      ctx.strokeStyle = state.grid;
      ctx.fillStyle = state.text;
      ctx.font = '11px var(--font-mono, ui-monospace, monospace)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const steps = 4;
      for (let s = 0; s <= steps; s++) {
        const v = min + (range * s) / steps;
        const y = yFor(v);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotW, y);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillText(Math.round(v).toString(), left - 8, y);
      }

      // x labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      data.forEach((d, i) => {
        ctx.fillText(d.label, xFor(i), top + plotH + 8);
      });

      if (state.type === 'bar') {
        const bw = Math.max(4, (plotW / data.length) * 0.55);
        ctx.fillStyle = state.color;
        data.forEach((d, i) => {
          const x = xFor(i) - bw / 2;
          const y = yFor(d.value);
          const zero = yFor(0);
          ctx.fillRect(x, Math.min(y, zero), bw, Math.abs(zero - y) || 1);
        });
      } else {
        ctx.strokeStyle = state.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        data.forEach((d, i) => {
          const x = xFor(i);
          const y = yFor(d.value);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = state.color;
        data.forEach((d, i) => {
          const x = xFor(i);
          const y = yFor(d.value);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    draw();
    if (window.ResizeObserver) {
      ro = new ResizeObserver(draw);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', draw);
    }

    return {
      update(data) {
        state.data = data;
        draw();
      },
      setType(type) {
        state.type = type;
        draw();
      },
      destroy() {
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', draw);
      },
    };
  }

  global.UICanvasChart = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'canvas-chart',
      primitive: 'canvas',
      label: 'Canvas chart',
      source: 'recipes/web/canvas-chart.js',
      export: 'UICanvasChart',
      description: 'Data-driven 2D chart (line or bar), DPR-aware, resizes with its container.',
      props: {
        type: {
          type: 'enum', values: ['line', 'bar'], default: 'line',
          controls: 'Line for a trend over an ordered axis, bar for comparing separate amounts.',
          sweep: ['line', 'bar'],
          cost: 'none',
        },
        data: {
          type: 'array', items: { label: 'string', value: 'number' },
          controls: 'The series: labels on the x axis, values scaled to the tallest.',
          sweep: [
            [{ label: 'Mon', value: 42 }, { label: 'Tue', value: 58 }, { label: 'Wed', value: 35 }],
            [{ label: 'Mon', value: 12 }, { label: 'Tue', value: 26 }, { label: 'Wed', value: 48 }, { label: 'Thu', value: 20 }],
          ],
          cost: 'linear in points; redraws on resize',
        },
        color: {
          type: 'color', default: 'var(--accent)',
          controls: 'Series colour. Accepts a CSS variable, so the chart follows the page\'s theme.',
          sweep: ['#2f9e4f', '#c2255c', '#3b5bdb'],
          cost: 'none',
        },
      },
      snippet:
        "const chart = UICanvasChart.mount(canvasEl, {\n  type: 'line',\n  data: [\n    { label: 'Mon', value: 42 },\n    { label: 'Tue', value: 58 },\n  ],\n  color: 'var(--accent)',\n});\n\nchart.update(newData);\nchart.setType('bar');",
      preview(container, props) {
        const p = props || {};
        const wrap = document.createElement('div');
        wrap.style.width = '100%';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:100%;height:220px;display:block';
        wrap.appendChild(canvas);
        container.appendChild(wrap);

        // The declared `data` prop is used when given; the sweep found preview() ignoring it.
        const data = Array.isArray(p.data) && p.data.length ? p.data : [
          { label: 'Mon', value: 42 }, { label: 'Tue', value: 58 }, { label: 'Wed', value: 35 },
          { label: 'Thu', value: 71 }, { label: 'Fri', value: 64 }, { label: 'Sat', value: 22 },
          { label: 'Sun', value: 30 },
        ];
        const chart = mount(canvas, { type: p.type || 'line', data: data, color: p.color });
        return { destroy: chart.destroy };
      },
      demo(container) {
        const DATASETS = {
          a: [{ label: 'Mon', value: 42 }, { label: 'Tue', value: 58 }, { label: 'Wed', value: 35 }, { label: 'Thu', value: 71 }, { label: 'Fri', value: 64 }, { label: 'Sat', value: 22 }, { label: 'Sun', value: 30 }],
          b: [{ label: 'Mon', value: 12 }, { label: 'Tue', value: 26 }, { label: 'Wed', value: 48 }, { label: 'Thu', value: 20 }, { label: 'Fri', value: 55 }, { label: 'Sat', value: 40 }, { label: 'Sun', value: 61 }],
        };
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-act="line" aria-pressed="true">Line</button>' +
          '<button class="ui-demo-ctl" data-act="bar" aria-pressed="false">Bar</button>' +
          '<button class="ui-demo-ctl" data-act="shuffle">Shuffle data</button>';
        const canvasWrap = document.createElement('div');
        canvasWrap.style.width = '100%';
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '220px';
        canvas.style.display = 'block';
        canvasWrap.appendChild(canvas);
        container.appendChild(controls);
        container.appendChild(canvasWrap);

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const chart = mount(canvas, { type: 'line', data: DATASETS.a, color: accent });
        let toggled = false;

        controls.addEventListener('click', (e) => {
          const act = e.target.dataset.act;
          if (!act) return;
          if (act === 'line' || act === 'bar') {
            chart.setType(act);
            controls.querySelectorAll('.ui-demo-ctl').forEach((b) => b.setAttribute('aria-pressed', b.dataset.act === act ? 'true' : 'false'));
          } else if (act === 'shuffle') {
            toggled = !toggled;
            chart.update(toggled ? DATASETS.b : DATASETS.a);
          }
        });

        return { destroy: chart.destroy };
      },
    });
  }
})(window);
