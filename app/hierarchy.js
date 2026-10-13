// Evaluated in the page by app/preview.py for design projects. The design declares its
// order of importance with data-priority="1" (most important), "2", "3"...; this measures
// how much each marked element actually stands out and reports where the page disagrees
// with the declaration. Comparisons stay inside one [data-option] section (options are
// alternatives, not rivals), or the whole page.
//
// Prominence is a heuristic from rendered styles, not an eye-tracking model:
//   score = text size x weight x text contrast x fill x outline x position
// - text: the largest-scoring visible text in the element (its own or a descendant's,
//   except text inside a nested marked element);
//   an element without text (an image, a box) uses sqrt(area) / 6 instead
// - weight: font-weight / 400, clamped to 0.8-1.6
// - text contrast: 0.4 + 0.6 x min(1, (ratio - 1) / 14)
// - fill: 1 + min(1, (ratio - 1) / 10) for a solid background that differs from what is
//   behind it (a filled button, a dark card); outline: 1.15 for a visible border instead
// - position: 1 above the fold, else fold / top, but at least 0.4
// A lower priority must score clearly less (a 10% margin) than every higher priority in
// its scope, and no unmarked text may rival priority 1.
() => {
  const MARGIN = 1.1;
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // The background behind an element (its ancestors composited); null over an image.
  const behind = (el) => {
    const chain = [];
    for (let n = el.parentElement; n; n = n.parentElement) chain.push(n);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const n of chain.reverse()) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };
  const visible = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent).join("").trim();
  const fold = innerHeight;

  // One piece of text: size, weight, contrast against what is behind it.
  function textMeasure(el) {
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const color = parse(s.color);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const own = parse(s.backgroundColor);
    const base = behind(el);
    if (base) bg = own && own.a > 0 && s.backgroundImage === "none" ? over(own, base) : base;
    const fg = color ? (color.a < 1 ? over(color, bg) : color) : { r: 0, g: 0, b: 0, a: 1 };
    const contrast = base ? ratio(fg, bg) : 7; // over an image: assume readable
    const score = size * Math.min(1.6, Math.max(0.8, weight / 400))
      * (0.4 + 0.6 * Math.min(1, (contrast - 1) / 14));
    return { size: Math.round(size), weight, contrast: Math.round(contrast * 10) / 10, score };
  }

  function measure(el) {
    // Text inside a nested marked element belongs to that element, not to this one.
    const mine = (n) => !el.hasAttribute("data-priority") || n.closest("[data-priority]") === el;
    const leaves = [el, ...el.querySelectorAll("*")]
      .filter((n) => ownText(n) && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(n.tagName) && visible(n) && mine(n));
    const rect = el.getBoundingClientRect();
    let text = null;
    for (const leaf of leaves) {
      const m = textMeasure(leaf);
      if (!text || m.score > text.score) text = m;
    }
    const s = getComputedStyle(el);
    const base = behind(el);
    const fillColor = parse(s.backgroundColor);
    let fill = 1, fillRatio = null, outline = 1;
    if (base && fillColor && fillColor.a > 0.5 && s.backgroundImage === "none") {
      fillRatio = ratio(over(fillColor, base), base);
      if (fillRatio > 1.1) fill = 1 + Math.min(1, (fillRatio - 1) / 10);
    }
    const border = parse(s.borderTopColor);
    if (fill === 1 && base && border && border.a > 0 && parseFloat(s.borderTopWidth) >= 1
        && ratio(over(border, base), base) >= 3) outline = 1.15;
    const top = rect.top + scrollY;
    const position = top <= fold ? 1 : Math.max(0.4, fold / top);
    const core = text ? text.score : Math.sqrt(rect.width * rect.height) / 6;
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt")
      || el.tagName.toLowerCase()).trim().replace(/\s+/g, " ").slice(0, 40);
    return {
      label, tag: el.tagName.toLowerCase(),
      score: Math.round(core * fill * outline * position * 10) / 10,
      text, fillRatio: fillRatio && Math.round(fillRatio * 10) / 10, outline: outline > 1,
      belowFold: top > fold, area: text ? null : Math.round(rect.width) + "x" + Math.round(rect.height),
    };
  }

  const marked = [...document.querySelectorAll("[data-priority]")];
  if (!marked.length) return { missing: true, invalid: [], violations: [], unmarked: [] };

  const invalid = [];
  const items = [];
  for (const el of marked) {
    const raw = el.getAttribute("data-priority");
    const priority = Number(raw);
    if (!Number.isInteger(priority) || priority < 1) {
      invalid.push(`data-priority="${raw}" on <${el.tagName.toLowerCase()}>`);
      continue;
    }
    if (!visible(el)) continue; // a closed menu or another state: not on screen now
    items.push({ el, priority, scope: el.closest("[data-option]"), ...measure(el) });
  }

  const violations = [];
  for (const low of items) {
    // The most important element in the same scope that `low` rivals.
    const rivalled = items.filter((high) => high.scope === low.scope && high.priority < low.priority
      && low.score * MARGIN > high.score).sort((a, b) => a.priority - b.priority)[0];
    if (rivalled) violations.push({ high: rivalled, low });
  }

  // Unmarked text that stands out as much as priority 1.
  const unmarked = [];
  const firsts = items.filter((i) => i.priority === 1);
  if (firsts.length) {
    for (const el of document.body.querySelectorAll("*")) {
      if (!ownText(el) || el.closest("[data-priority]") || ["SCRIPT", "STYLE", "NOSCRIPT", "TITLE"].includes(el.tagName)
          || !visible(el)) continue;
      const scope = el.closest("[data-option]");
      const first = firsts.filter((f) => f.scope === scope).sort((a, b) => a.score - b.score)[0];
      if (!first) continue;
      const m = measure(el);
      if (m.score * MARGIN > first.score) unmarked.push({ item: m, first });
    }
    unmarked.sort((a, b) => b.item.score - a.item.score);
  }

  const strip = ({ el, scope, ...rest }) => rest;
  return {
    missing: false, invalid,
    violations: violations.map(({ high, low }) => ({ high: strip(high), low: strip(low),
      high_priority: high.priority, low_priority: low.priority })),
    unmarked: unmarked.map(({ item, first }) => ({ item, first: strip(first) })),
  };
}
