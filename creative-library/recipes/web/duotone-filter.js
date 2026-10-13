/**
 * Duotone — map an image's luminance onto two brand colours.
 *
 * Two primitives, and the first one is the one people skip: feColorMatrix with the luminance
 * coefficients (0.2126 / 0.7152 / 0.0722) collapses the image to grey *by perceived
 * brightness*. Averaging the channels instead — the naive greyscale — makes greens too dark
 * and blues too light, and the duotone inherits the error as blotches.
 *
 * feComponentTransfer then remaps that single grey ramp per channel with a two-stop table,
 * which is a linear interpolation between the shadow colour and the highlight colour.
 *
 * Usage: container.innerHTML = UIDuotoneFilter.wrap(imgMarkup, { shadow:'#14532d', highlight:'#e8f5ea' });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  function channels(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  }

  function wrap(inner, opts) {
    const o = opts || {};
    const shadow = channels(o.shadow || '#14532d');
    const highlight = channels(o.highlight || '#e8f5ea');
    const width = o.width == null ? 260 : o.width;
    const height = o.height == null ? 170 : o.height;
    const id = 'duotone-' + ++seq;

    const funcs = ['R', 'G', 'B']
      .map((ch, i) => '<feFunc' + ch + ' type="table" tableValues="' + shadow[i] + ' ' + highlight[i] + '"/>')
      .join('');

    return (
      '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"' +
      ' role="img" aria-label="' + (o.label || 'Duotone image') + '">' +
      '<defs><filter id="' + id + '" color-interpolation-filters="sRGB">' +
        // Perceived brightness, not a channel average — the part that makes greens behave.
        '<feColorMatrix type="matrix" values="' +
          '0.2126 0.7152 0.0722 0 0 ' +
          '0.2126 0.7152 0.0722 0 0 ' +
          '0.2126 0.7152 0.0722 0 0 ' +
          '0 0 0 1 0"/>' +
        '<feComponentTransfer>' + funcs + '</feComponentTransfer>' +
      '</filter></defs>' +
      '<g filter="url(#' + id + ')">' + inner + '</g>' +
      '</svg>'
    );
  }

  global.UIDuotoneFilter = { wrap };

  if (global.UI) {
    // A generated stand-in rather than a bundled photo: a recipe should not ship an asset, and
    // a gradient with shapes exercises the luminance ramp end to end.
    let artSeq = 0;
    function ART() {
      // Unique per call: three copies on one page sharing one gradient id means two of them
      // reference an element that is not theirs, and duplicate ids are invalid besides.
      const gid = 'dt-src-' + ++artSeq;
      return (
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#ff5f6d"/><stop offset="0.5" stop-color="#8bd3dd"/>' +
          '<stop offset="1" stop-color="#12232e"/></linearGradient></defs>' +
        '<rect width="260" height="170" fill="url(#' + gid + ')"/>' +
        '<circle cx="80" cy="70" r="38" fill="#ffe066"/>' +
        '<path d="M0 170 L90 90 L150 140 L210 80 L260 130 L260 170 Z" fill="#0b3d2e"/>'
      );
    }

    global.UI.define({
      id: 'duotone-filter',
      primitive: 'svg',
      label: 'Duotone filter',
      source: 'recipes/web/duotone-filter.js',
      export: 'UIDuotoneFilter',
      description: 'Two-colour image treatment via true luminance plus a two-stop transfer table.',
      props: {
        shadow: {
          type: 'color', default: '#14532d',
          controls: 'The colour the darkest tones become. Usually the darker brand colour.',
          sweep: ['#14532d', '#1e1b4b', '#7f1d1d'],
          cost: 'none — one filter, run by the renderer',
        },
        highlight: {
          type: 'color', default: '#e8f5ea',
          controls: 'The colour the lightest tones become. Usually a pale brand tint, or white for contrast.',
          sweep: ['#e8f5ea', '#fef3c7', '#ffffff'],
          cost: 'none',
        },
      },
      signature: {
        within: 'filter',
        requires: ['feColorMatrix[type="matrix"]', 'feComponentTransfer'],
        why: 'a luminance matrix feeding a per-channel transfer table is the duotone recipe',
      },
      snippet:
        "container.innerHTML = UIDuotoneFilter.wrap(\n  '<image href=\"/photo.jpg\" width=\"260\" height=\"170\"/>',\n  { shadow: '#14532d', highlight: '#e8f5ea' }\n);",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = wrap(ART(), { shadow: p.shadow, highlight: p.highlight });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:flex;gap:0.75rem;flex-wrap:wrap">' +
          wrap(ART(), { shadow: '#14532d', highlight: '#e8f5ea', width: 200, height: 130 }) +
          wrap(ART(), { shadow: '#2b1055', highlight: '#ffd6a5', width: 200, height: 130 }) +
          wrap(ART(), { shadow: '#0b1d33', highlight: '#7fd8ff', width: 200, height: 130 }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
