/**
 * Scratch-to-reveal — an opaque canvas layer erased by pointer movement.
 *
 * The whole technique is one line: `globalCompositeOperation = 'destination-out'`, which makes
 * every subsequent draw punch a hole in what is already there instead of painting on top.
 * People reach for pixel manipulation or a mask element and both are slower and worse.
 *
 * Two details that decide whether it feels right:
 *   - Draw a *line* between the previous and current pointer position, not a dot at each
 *     event. Pointer events are sampled, so dots leave a dotted trail on a fast swipe.
 *   - Track progress by sampling the alpha channel on a coarse grid (every 8th pixel), not
 *     every pixel. Full sampling on every move is the thing that makes these janky.
 *
 * Accessibility: a scratch surface is a pointer-only gesture, so it ships with a real button
 * that reveals everything. Without one, the content is unreachable by keyboard — and the
 * button is not a fallback, it is the primary path for most people.
 *
 * No animation loop, so no reduced-motion branch.
 *
 * Usage: const s = UIScratchOff.mount(containerEl, { onComplete });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function mount(container, opts) {
    const o = opts || {};
    const width = o.width == null ? 320 : o.width;
    const height = o.height == null ? 140 : o.height;
    const radius = o.radius == null ? 22 : o.radius;
    const threshold = o.threshold == null ? 0.55 : o.threshold;
    const cover = o.cover || '#9aa3ab';

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;width:${width}px;height:${height}px;` +
      'border-radius:10px;overflow:hidden;background:#14532d;color:#ffffff';

    const prize = document.createElement('div');
    prize.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;' +
      'font-size:1.5rem;font-weight:700;letter-spacing:0.04em';
    prize.textContent = o.text || 'YOU WIN';
    wrap.appendChild(prize);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = 'position:absolute;inset:0;touch-action:none;cursor:crosshair';
    // Pointer-only by nature: the button below is how everyone else gets there.
    canvas.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cover;
    ctx.fillRect(0, 0, width, height);
    // 4.7:1 against the cover. Worth stating why it is hardcoded rather than eyeballed:
    // `contrast-minimum` reads computed styles off the DOM, and text painted into a canvas has
    // none — so the gate cannot see this string at all. It was 2.2:1 when first written and
    // nothing in the pipeline would ever have said so.
    ctx.fillStyle = '#2f363c';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scratch here', width / 2, height / 2 + 5);

    let drawing = false;
    let last = null;
    let done = false;

    function erasedRatio() {
      // Coarse grid: every 8th pixel is plenty to drive a threshold, and cheap enough to run
      // on pointer move without dropping frames.
      const data = ctx.getImageData(0, 0, width, height).data;
      let clear = 0;
      let seen = 0;
      for (let i = 3; i < data.length; i += 4 * 8) {
        seen++;
        if (data[i] < 40) clear++;
      }
      return seen === 0 ? 0 : clear / seen;
    }

    function revealAll() {
      if (done) return;
      done = true;
      ctx.clearRect(0, 0, width, height);
      canvas.style.display = 'none';
      if (typeof o.onComplete === 'function') o.onComplete();
    }

    function erase(x, y) {
      // destination-out: draws remove instead of add. The entire recipe.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = radius * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (last) {
        // A stroked segment, not a dot — pointer events are sampled and a fast swipe would
        // otherwise leave gaps.
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      last = { x: x, y: y };
      ctx.globalCompositeOperation = 'source-over';
      if (erasedRatio() >= threshold) revealAll();
    }

    function at(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onDown(e) { drawing = true; last = null; const p = at(e); erase(p.x, p.y); canvas.setPointerCapture(e.pointerId); }
    function onMove(e) { if (!drawing || done) return; const p = at(e); erase(p.x, p.y); }
    function onUp() { drawing = false; last = null; }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = o.revealLabel || 'Reveal';
    button.style.cssText = 'margin-top:0.75rem;font:inherit;min-height:44px;padding:0.5rem 1rem;' +
      'border:1px solid #6b6b6b;border-radius:6px;background:#ffffff;color:#1a1a1a;cursor:pointer';
    button.addEventListener('click', revealAll);

    container.appendChild(wrap);
    container.appendChild(button);

    return {
      reveal: revealAll,
      destroy() {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (button.parentNode) button.parentNode.removeChild(button);
      },
    };
  }

  global.UIScratchOff = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'scratch-off',
      primitive: 'canvas',
      label: 'Scratch off',
      source: 'recipes/web/scratch-off.js',
      export: 'UIScratchOff',
      description: 'Reveal-by-erasing via destination-out compositing, with a keyboard-reachable Reveal button as the real path.',
      props: {
        radius: {
          type: 'number', default: 22, unit: 'px',
          controls: 'Brush size of the scratch: small makes it a careful reveal, large a quick swipe.',
          range: [8, 48],
          unswept: 'acts only while someone scratches; the sweep has no pointer',
        },
        threshold: {
          type: 'number', default: 0.55,
          controls: 'Share of the surface that must be cleared before the rest reveals itself.',
          range: [0.3, 0.9],
          unswept: 'acts only after scratching; the sweep has no pointer',
        },
        width: {
          type: 'number', default: 320, unit: 'px',
          controls: 'Width of the card.',
          range: [160, 480], sweep: [160, 240, 320, 400, 480],
          cost: 'alpha sampling grows with area (every 8th pixel)',
        },
        height: {
          type: 'number', default: 140, unit: 'px',
          controls: 'Height of the card.',
          range: [80, 240], sweep: [80, 110, 140, 180, 240],
          cost: 'as width',
        },
      },
      snippet:
        "const card = UIScratchOff.mount(containerEl, {\n  text: 'YOU WIN',\n  threshold: 0.55,\n  onComplete: () => console.log('revealed'),\n});\n\ncard.reveal();",
      preview(container, props) {
        const p = props || {};
        const s = mount(container, {
          radius: p.radius, threshold: p.threshold, width: p.width, height: p.height,
        });
        return { destroy: s.destroy };
      },
      demo(container) {
        const s = mount(container, {});
        return { destroy: s.destroy };
      },
    });
  }
})(window);
