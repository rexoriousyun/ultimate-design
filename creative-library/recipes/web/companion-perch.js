/**
 * Companion perch — place a decorative sprite inside real layout, in whitespace it found
 * rather than a corner you nominated.
 *
 * Ported from Dotori (flambed-squirrel): src/lib/squirrel.js and
 * src/components/mascot/SquirrelLayer.jsx. The **method** is ported; the squirrel art is not.
 * Those sprites are that product's brand, and what generalises is the rule about where a
 * companion is allowed to stand.
 *
 * The usual mascot is `position: fixed; bottom: 16px; right: 16px`, which is easy and wrong in
 * two ways: it covers whatever is in that corner, and it sits outside the composition so it
 * never looks like it belongs to the page. This measures the page instead — it ranks the
 * on-screen components by how much genuinely blank interior they have and perches fully
 * inside the roomiest one.
 *
 * ## The four decisions worth copying
 *
 * **Probe the layout, don't guess it.** A point counts as free only when
 * `elementFromPoint` resolves to the host or a blank structural child. Any text node, control,
 * image or inline element under the probe disqualifies it. Six rows are sampled up the
 * sprite's body, spaced tighter than a line of text — probing three heights lets all three
 * land in the gaps between lines while the body covers the lines themselves.
 *
 * **One strict pass, then sit it out.** The original prototype loosened the clearance test
 * until some placement succeeded. This does not, and that is the single most important line
 * in the port: on a text-dense card the loosest pass always "succeeds" by putting the sprite
 * on top of the text, which is the one thing the design forbids. If nothing has room for a
 * whole body, no companion appears. A decoration that covers content has negative value.
 *
 * **Seed the randomness from a placement key.** Same key, same perch. Without this the sprite
 * hops on every re-render and every resize tick, which reads as a bug rather than as life.
 * The key is whatever should make it move — route, tab, open modal.
 *
 * **It is decoration, and the markup says so.** `aria-hidden`, `pointer-events: none`, and a
 * z-index below the nav and every overlay, so it can never intercept a click or be read out
 * as content. A mascot that steals a click is a defect with a mascot on it.
 *
 * Under prefers-reduced-motion the sprite is placed and still — no bob, no blink, no entrance.
 * Placement is layout, not animation, so the companion survives; only the idling stops.
 *
 * Usage: const c = UICompanionPerch.mount(pageEl, { key: location.pathname });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const SPRITE_SIZE = 64;
  const PAD = 10;

  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  // ---------------------------------------------------------------------------
  // Pure placement. No DOM in here — the probe is injected — so the part that decides
  // *where* it lands is testable without a browser.
  // ---------------------------------------------------------------------------

  /** FNV-1a over the key, then an LCG seeded from it. Same key always yields the same perch. */
  function makeRng(key) {
    let h = 2166136261;
    const s = String(key);
    for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
    return function (n) {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h % Math.max(n, 1);
    };
  }

  /** A host too small to contain a whole sprite is rejected before it is ever probed. */
  function isViableHost(rect, spriteSize) {
    const size = spriteSize == null ? SPRITE_SIZE : spriteSize;
    return rect.width >= size + 86 && rect.height >= size + 26;
  }

  // Offsets above the foot line, and across the body. Spaced closer than a line of text.
  const ROWS = [0, 12, 24, 36, 48, 58];

  /**
   * Score one host by how many of seven evenly spaced footholds along its bottom edge are
   * clear. `free(x, y)` reports whether a viewport point resolves to blank space in this host.
   * @returns {{spots: number[], score: number}|null} null when nothing fits.
   */
  function scoreHost(rect, free, viewportH, opts) {
    const o = opts || {};
    const size = o.spriteSize == null ? SPRITE_SIZE : o.spriteSize;
    const pad = o.pad == null ? PAD : o.pad;
    const topGuard = o.topGuard == null ? 70 : o.topGuard;
    const cols = [8, size / 2, size - 8];

    const yb = Math.min(rect.bottom, viewportH) - pad - 4;
    if (yb - size < Math.max(rect.top, topGuard)) return null;
    const span = rect.width - pad * 2 - size;
    if (span < 4) return null;

    const spots = [];
    for (let i = 0; i < 7; i++) {
      const x = rect.left + pad + (i / 6) * span;
      const clear = ROWS.every((dy) => cols.every((dx) => free(x + dx, yb - dy)));
      if (clear) spots.push(x);
    }
    if (spots.length === 0) return null;

    // Bigger, emptier components win — but width stops counting past 900px, so a full-bleed
    // container cannot out-score a genuinely roomy card.
    return { spots: spots, score: spots.length * Math.sqrt(Math.min(rect.width, 900) * rect.height) };
  }

  /** Rank every candidate. Empty means "no companion on this screen", never "place it anyway". */
  function rankHosts(candidates, free, viewportH, opts) {
    const scored = [];
    candidates.forEach((c) => {
      const s = scoreHost(c.rect, (x, y) => free(c, x, y), viewportH, opts);
      if (s) scored.push({ spots: s.spots, score: s.score, host: c });
    });
    return scored.sort((a, b) => b.score - a.score);
  }

  /** Clamp a chosen foothold so the sprite stays fully inside its host. */
  function placeAt(rect, x, viewportH, opts) {
    const o = opts || {};
    const size = o.spriteSize == null ? SPRITE_SIZE : o.spriteSize;
    const pad = o.pad == null ? PAD : o.pad;
    return {
      left: Math.round(Math.min(Math.max(x, rect.left + pad), rect.right - size - pad)),
      top: Math.round(Math.min(rect.bottom, viewportH) - size - pad - 4),
    };
  }

  /** Pick `count` perches: the first from among the top few so it varies, the rest best-first,
   * and never twice in the same component. */
  function choosePerches(ranked, count, rnd) {
    const pool = ranked.slice();
    const out = [];
    for (let k = 0; k < count && pool.length > 0; k++) {
      const idx = k === 0 ? rnd(Math.min(3, pool.length)) : 0;
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // DOM half.
  // ---------------------------------------------------------------------------

  const BLOCKING_TAGS = /^(img|svg|input|select|textarea|button|span|a|b|strong|em|code|circle|rect|path|text|polyline|line)$/i;

  /** A point is free only if it resolves to the host or to a blank structural child. */
  function probeFree(host, x, y, vw, vh, topGuard) {
    if (x < 1 || y < topGuard || x > vw - 2 || y > vh - 2) return false;
    try {
      let el = document.elementFromPoint(x, y);
      while (el && el !== document.body) {
        if (el === host) return true;
        if (BLOCKING_TAGS.test(el.tagName)) return false;
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && n.textContent.trim()) return false;
        }
        el = el.parentElement;
      }
      return false;
    } catch {
      return false;
    }
  }

  const DEFAULT_SPRITE =
    '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">' +
      '<ellipse cx="32" cy="58" rx="17" ry="4" fill="rgba(0,0,0,0.16)"/>' +
      '<path d="M44 46c8-6 12-16 8-25-3-7-11-8-15-3-3 4-2 9 1 11" fill="#b4762f"/>' +
      '<circle cx="32" cy="36" r="18" fill="#c98a3d"/>' +
      '<circle cx="32" cy="20" r="13" fill="#d99b4e"/>' +
      '<circle cx="23" cy="10" r="5" fill="#c98a3d"/>' +
      '<circle cx="41" cy="10" r="5" fill="#c98a3d"/>' +
      '<circle cx="26" cy="20" r="2.4" fill="#2b1c0c"/>' +
      '<circle cx="38" cy="20" r="2.4" fill="#2b1c0c"/>' +
      '<path d="M29 26q3 3 6 0" stroke="#2b1c0c" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  let stylesInjected = false;
  function ensureStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.textContent =
      '@keyframes ui-perch-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}' +
      // Deliberately no opacity ramp. Dotori's original faded in from 0, which means that on
      // every route change the companion is invisible for a beat — and a screenshot or a
      // first paint catches it half-there, looking like a rendering bug rather than an
      // entrance. Settling into place reads the same and is never absent.
      '@keyframes ui-perch-enter{from{transform:translateY(6px) scale(0.94)}to{transform:none}}' +
      '.ui-perch{position:absolute;pointer-events:none;z-index:39}' +
      '.ui-perch-inner{animation:ui-perch-enter .6s ease-out both}' +
      '.ui-perch-sprite{animation:ui-perch-bob 2.4s ease-in-out infinite}' +
      // Placement is layout, not animation — the companion stays, the idling stops.
      '@media (prefers-reduced-motion: reduce){.ui-perch-inner,.ui-perch-sprite{animation:none}}';
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /**
   * @param {Element} container  The region to search for hosts and to position within.
   * @param {object} [opts] key, hostSelector, count, spriteSize, pad, settleMs, sprite, topGuard
   */
  function mount(container, opts) {
    const o = opts || {};
    const hostSelector = o.hostSelector || '[data-perch], .card';
    const spriteSize = o.spriteSize == null ? SPRITE_SIZE : o.spriteSize;
    const pad = o.pad == null ? PAD : o.pad;
    const count = o.count == null ? 1 : o.count;
    const settleMs = o.settleMs == null ? 350 : o.settleMs;
    const topGuard = o.topGuard == null ? 0 : o.topGuard;
    const sprite = o.sprite || DEFAULT_SPRITE;
    let key = o.key == null ? 'default' : o.key;

    ensureStyles();
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    container.appendChild(layer);

    let timer = null;
    let resizeTimer = null;
    let lastCount = 0;

    function place() {
      layer.innerHTML = '';
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const box = container.getBoundingClientRect();

      const candidates = [];
      container.querySelectorAll(hostSelector).forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (!isViableHost(rect, spriteSize)) return;
        candidates.push({ el: el, rect: rect, mode: el.getAttribute('data-perch') || 'default' });
      });

      // A modal owns the screen: perch inside it and ignore the page behind.
      const modals = candidates.filter((c) => c.mode === 'modal');
      const pool = modals.length > 0 ? modals : candidates.filter((c) => c.mode !== 'modal');

      const placeOpts = { spriteSize: spriteSize, pad: pad, topGuard: topGuard };
      const ranked = rankHosts(
        pool,
        (host, x, y) => probeFree(host.el, x, y, vw, vh, topGuard),
        vh,
        placeOpts,
      );

      lastCount = 0;
      if (ranked.length === 0) return;

      const rnd = makeRng(key);
      choosePerches(ranked, count, rnd).forEach((p) => {
        const at = placeAt(p.host.rect, p.spots[rnd(p.spots.length)], vh, placeOpts);
        const el = document.createElement('div');
        el.className = 'ui-perch';
        // Host rects are viewport-relative; the layer is positioned within the container.
        el.style.left = `${at.left - box.left}px`;
        el.style.top = `${at.top - box.top}px`;
        el.style.width = `${spriteSize}px`;
        el.style.height = `${spriteSize}px`;
        if (rnd(2) === 1) el.style.transform = 'scaleX(-1)';
        el.innerHTML =
          `<div class="ui-perch-inner"><div class="ui-perch-sprite">${sprite}</div></div>`;
        layer.appendChild(el);
        lastCount++;
      });
    }

    // Placed at once so nothing flashes empty, then again after the settle window, because a
    // route or tab transition mid-flight measures where a card *was*.
    place();
    if (settleMs > 0) timer = setTimeout(place, settleMs);

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(place, 200);
    }
    window.addEventListener('resize', onResize);

    return {
      /** Re-place under a new key — a route change, a tab switch, an opened modal. */
      update(nextKey) {
        if (nextKey != null) key = nextKey;
        place();
      },
      /** How many perched last time. Zero is a valid, deliberate answer. */
      get placed() { return lastCount; },
      destroy() {
        clearTimeout(timer);
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      },
    };
  }

  global.UICompanionPerch = {
    mount,
    // The pure half, exported so the placement rules can be tested and reused without the DOM.
    makeRng, isViableHost, scoreHost, rankHosts, placeAt, choosePerches,
    SPRITE_SIZE, PAD, DEFAULT_SPRITE,
  };

  if (global.UI) {
    function stage(container, props) {
      const p = props || {};
      const page = document.createElement('div');
      page.style.cssText =
        'display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;' +
        'padding:12px;background:#f6f7f6;border-radius:10px';
      page.innerHTML =
        '<div class="card" style="background:#fff;border:1px solid #d6dbd6;border-radius:8px;' +
          'padding:12px;min-height:150px"><h4 style="margin:0 0 6px;font-size:0.95rem">Dense card</h4>' +
          '<p style="margin:0;font-size:0.8rem;color:#3d443d">Text all the way down, line after ' +
          'line, leaving no gap tall enough for a whole body to stand in. Nothing perches here, ' +
          'and that is the correct answer rather than a failure.</p></div>' +
        '<div class="card" style="background:#fff;border:1px solid #d6dbd6;border-radius:8px;' +
          'padding:12px;min-height:150px"><h4 style="margin:0 0 6px;font-size:0.95rem">Roomy card</h4>' +
          '<p style="margin:0;font-size:0.8rem;color:#3d443d">One short line.</p></div>' +
        '<div class="card" style="background:#fff;border:1px solid #d6dbd6;border-radius:8px;' +
          'padding:12px;min-height:150px"><h4 style="margin:0 0 6px;font-size:0.95rem">Empty card</h4></div>';
      container.appendChild(page);

      const companion = mount(page, {
        key: p.key == null ? 'demo' : p.key,
        count: p.count,
        spriteSize: p.spriteSize,
        pad: p.pad,
        // Measured immediately: the demo builds its own layout synchronously, so there is no
        // transition to wait out.
        settleMs: 0,
      });
      return { page, companion };
    }

    global.UI.define({
      id: 'companion-perch',
      primitive: 'svg',
      label: 'Companion perch',
      source: 'recipes/web/companion-perch.js',
      export: 'UICompanionPerch',
      description:
        'Places a decorative sprite in whitespace it measured inside real components — and places none at all rather than covering text.',
      props: {
        count: {
          type: 'number', default: 1,
          controls: 'How many companions may perch. Each needs a component with a whole body\'s worth of free space, so fewer may appear.',
          range: [0, 3], sweep: [0, 1, 2, 3],
          breaks: { above: 'Swept: the preview layout has room for two; a third finds no free space and sits out, as designed.' },
          cost: 'one layout probe pass per companion',
        },
        spriteSize: {
          type: 'number', default: 64, unit: 'px',
          controls: 'Size of the companion. Bigger needs more whitespace, so it perches less often.',
          range: [32, 96], sweep: [32, 48, 64, 96],
          cost: 'none',
        },
        pad: {
          type: 'number', default: 10, unit: 'px',
          controls: 'Clearance kept from text and controls around the perch.',
          range: [0, 24], sweep: [0, 10, 24],
          cost: 'none',
        },
        key: {
          type: 'string', default: 'demo',
          controls: 'A stable name for the placement, so the same page puts the companion in the same spot each visit.',
          sweep: ['demo', 'about', 'pricing'],
          cost: 'none',
        },
      },
      snippet:
        "const companion = UICompanionPerch.mount(pageEl, {\n  key: location.pathname,   // same key, same perch — no hopping on re-render\n  hostSelector: '[data-perch], .card',\n  count: 1,\n});\n\ncompanion.update(location.pathname);  // route changed\ncompanion.destroy();",
      preview(container, props) {
        const { companion } = stage(container, props);
        return { destroy() { companion.destroy(); container.innerHTML = ''; } };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-key="a" aria-pressed="true">Key A</button>' +
          '<button class="ui-demo-ctl" data-key="b">Key B</button>' +
          '<button class="ui-demo-ctl" data-key="c">Key C</button>';
        container.appendChild(controls);

        const { companion } = stage(container, { key: 'a' });

        controls.addEventListener('click', (e) => {
          const k = e.target.dataset && e.target.dataset.key;
          if (!k) return;
          companion.update(k);
          controls.querySelectorAll('.ui-demo-ctl').forEach((b) => {
            b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false');
          });
        });

        return { destroy() { companion.destroy(); container.innerHTML = ''; } };
      },
    });
  }
})(window);
