/**
 * Liquid-glass panel — a frosted, refractive surface. backdrop-filter does the frosting;
 * an feTurbulence -> feGaussianBlur -> feDisplacementMap chain warps the panel so the
 * blurred backdrop bends like thick glass rather than sitting flat, and a pointer-tracked
 * highlight follows the cursor.
 *
 * Ported from ui-master's React LiquidGlass.jsx. Changes:
 *   - No framework; --mx/--my are set directly on the element as the React version did.
 *   - The pointer highlight is a progressive enhancement: it is decorative, and on a
 *     device with no pointer the panel still renders correctly at its resting state.
 *   - `backdrop-filter` is unsupported in some engines; the background colour is applied
 *     unconditionally so the panel stays a legible surface rather than becoming
 *     transparent where the filter is dropped.
 *
 * Usage: const panel = UILiquidGlass.mount(el, { blur: 12 }); panel.destroy();
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  /**
   * @param {HTMLElement} el   Element to turn into a glass panel. Its children sit above.
   * @param {object} [opts]    blur, distortion, radius
   */
  function mount(el, opts) {
    const o = opts || {};
    const blur = o.blur == null ? 12 : o.blur;
    const distortion = o.distortion == null ? 14 : o.distortion;
    const radius = o.radius == null ? 20 : o.radius;
    const id = 'liquid-glass-' + ++seq;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    defs.innerHTML =
      '<filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.03" numOctaves="2" seed="7" result="noise"/>' +
        '<feGaussianBlur in="noise" stdDeviation="2" result="softNoise"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="softNoise" scale="' + distortion + '" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>';
    el.parentNode.insertBefore(defs, el);

    el.style.position = 'relative';
    el.style.borderRadius = radius + 'px';
    el.style.overflow = 'hidden';
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '50%');

    const surface = document.createElement('div');
    surface.setAttribute('aria-hidden', 'true');
    surface.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'backdrop-filter:blur(' + blur + 'px);-webkit-backdrop-filter:blur(' + blur + 'px);' +
      'filter:url(#' + id + ');' +
      'background:color-mix(in oklch, var(--surface, #ffffff) 45%, transparent);' +
      'border:1px solid color-mix(in oklch, var(--fg, #1a1a1a) 12%, transparent);' +
      'box-shadow:inset 0 1px 0 color-mix(in oklch, white 45%, transparent);';

    const highlight = document.createElement('div');
    highlight.setAttribute('aria-hidden', 'true');
    highlight.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'background:radial-gradient(circle at var(--mx) var(--my), color-mix(in oklch, white 38%, transparent), transparent 45%);';

    // The panel's own content has to be lifted into its own positioned layer. CSS paints
    // in-flow content *before* positioned descendants regardless of DOM order, so without
    // this the frosted surface covers the very text it is a backdrop for — no amount of
    // reordering insertBefore calls fixes it.
    const content = document.createElement('div');
    content.style.cssText = 'position:relative;z-index:1;';
    while (el.firstChild) content.appendChild(el.firstChild);

    el.appendChild(surface);
    el.appendChild(highlight);
    el.appendChild(content);

    function onMove(e) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width) * 100 + '%');
      el.style.setProperty('--my', ((e.clientY - rect.top) / rect.height) * 100 + '%');
    }
    el.addEventListener('pointermove', onMove);

    return {
      destroy() {
        el.removeEventListener('pointermove', onMove);
        if (surface.parentNode) surface.parentNode.removeChild(surface);
        if (highlight.parentNode) highlight.parentNode.removeChild(highlight);
        if (defs.parentNode) defs.parentNode.removeChild(defs);
        // Put the content back where it was, so destroy() really is an undo.
        while (content.firstChild) el.appendChild(content.firstChild);
        if (content.parentNode) content.parentNode.removeChild(content);
      },
    };
  }

  global.UILiquidGlass = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'liquid-glass',
      primitive: 'svg',
      label: 'Liquid glass',
      source: 'recipes/web/liquid-glass.js',
      export: 'UILiquidGlass',
      description: 'Frosted panel: backdrop blur warped by a noise displacement map, with a pointer-tracked highlight.',
      props: {
        blur: {
          type: 'number', default: 12, unit: 'px',
          controls: 'Frosting: how much the backdrop is blurred. Low is clear glass, high is frosted.',
          range: [0, 24], sweep: [0, 4, 12, 24],
          breaks: { above: 'Swept: past ~12px the preview backdrop is already fully smoothed, so more blur changes nothing visible; the useful ceiling depends on how fine the backdrop is.' },
          cost: 'backdrop-filter repaints with everything behind the panel',
        },
        distortion: {
          type: 'number', default: 14,
          controls: 'How much the glass bends what is behind it: thickness, read as refraction.',
          range: [0, 40], sweep: [0, 7, 14, 28, 40],
          cost: 'a displacement filter on the panel',
        },
        radius: {
          type: 'number', default: 20, unit: 'px',
          controls: 'Corner radius of the panel.',
          range: [0, 40], sweep: [0, 10, 20, 40],
          cost: 'none',
        },
      },
      signature: {
        within: 'filter',
        requires: ['feTurbulence', 'feGaussianBlur', 'feDisplacementMap'],
        why: 'noise, softened, then displacing the source is the refraction chain this recipe encapsulates',
      },
      snippet:
        "const panel = UILiquidGlass.mount(cardEl, { blur: 12, distortion: 14 });\n// …later\npanel.destroy();",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        // Stripes over the gradient: blurring a smooth gradient changes nothing visible, so a
        // backdrop with edges is what lets `blur` be seen (and swept) at all.
        stage.style.cssText =
          'position:relative;height:200px;padding:24px;' +
          'background:repeating-linear-gradient(90deg,rgba(255,255,255,.45) 0 6px,transparent 6px 20px),' +
          'linear-gradient(120deg,#3b5bdb,#c2255c 60%,#f08c00);';
        const panel = document.createElement('div');
        panel.style.cssText = 'width:220px;height:130px;padding:16px;color:#1a1a1a;font-weight:600;';
        panel.textContent = 'Move the pointer across this panel.';
        stage.appendChild(panel);
        container.appendChild(stage);
        const glass = mount(panel, { blur: p.blur, distortion: p.distortion, radius: p.radius });
        return { destroy: glass.destroy };
      },
      demo(container) {
        const stage = document.createElement('div');
        stage.style.cssText =
          'position:relative;height:200px;padding:24px;' +
          'background:linear-gradient(120deg,#3b5bdb,#c2255c 60%,#f08c00);';

        const panel = document.createElement('div');
        // Dark ink, not white: the frosted surface lightens whatever is behind it, so white
        // label text lands on a light panel and fails contrast — visible immediately in
        // `npm run render`, which is what that screenshot is for.
        panel.style.cssText = 'width:220px;height:130px;padding:16px;color:#1a1a1a;font-weight:600;';
        panel.textContent = 'Move the pointer across this panel.';
        stage.appendChild(panel);
        container.appendChild(stage);

        const glass = mount(panel, { blur: 12 });
        return { destroy: glass.destroy };
      },
    });
  }
})(window);
