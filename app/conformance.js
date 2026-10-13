// Evaluated in the page by app/preview.py when the project has a design-system/ folder.
// Collects the colours and font families the page may use and reports visible elements
// that use anything else. Allowed:
// - custom properties in stylesheets loaded from design-system/ (light and dark alike);
// - declared exceptions: custom properties named --ds-override-* in any stylesheet;
// - colours the user chose in the studio's Edit mode (studio-edits*.css).
// Returns null when no design-system stylesheet is loaded (the unloaded-files check
// reports that).
//
// When the system ships components (design-system/components/components.css, `ds-<name>`
// classes), it also reports look-alikes: an element with a box of its own (a fill, a
// border or a shadow) whose class names one of those components but isn't it
// (`invoice-card` when the system has `ds-card`), and filled buttons that aren't
// `ds-button`. Plain layout wrappers (no box) and parts inside the real component pass.
// `componentsCss`: the text of the component library, passed in by app/preview.py
// (fetching it here would log a 404 as a page problem when there is none).
//
// With `palette` (a page's Wada combination, as hex values; app/palette.py) the allowed
// colours are those instead of a design system's, the exceptions are --palette-override-*,
// and fonts and components are not checked.
(componentsCss, palette = null) => {
  const all = [...document.styleSheets];
  const sheets = all.filter((s) => (s.href || "").includes("/design-system/"));
  if (!palette && !sheets.length) return null;
  const OVERRIDE = palette ? "--palette-override-" : "--ds-override-";

  const probe = document.createElement("div");
  probe.style.display = "none";
  document.body.append(probe);
  const resolve = (value) => {
    probe.style.color = "";
    probe.style.color = value;
    return probe.style.color ? getComputedStyle(probe).color : null;
  };

  const colors = new Set();
  const fonts = new Set();
  // mode: "system" takes every custom property, "overrides" only --ds-override-*,
  // "edits" the colour declarations themselves.
  const collect = (rules, mode) => {
    for (const rule of rules) {
      if (rule.cssRules) collect(rule.cssRules, mode); // @media, @supports
      if (!rule.style) continue;
      for (const prop of rule.style) {
        if (mode === "edits") {
          if (/color$/.test(prop)) {
            const value = resolve(rule.style.getPropertyValue(prop).trim());
            if (value) colors.add(value);
          }
          continue;
        }
        if (!prop.startsWith(mode === "overrides" ? OVERRIDE : "--")) continue;
        const raw = rule.style.getPropertyValue(prop).trim();
        if (CSS.supports("color", raw)) {
          colors.add(resolve(raw));
        } else if (raw.startsWith("var(")) {
          const value = resolve(`var(${prop})`);
          if (value) colors.add(value);
        }
        if (/font|family/i.test(prop) && !/size|weight|leading|height/i.test(prop)) {
          for (const family of raw.split(",")) fonts.add(family.trim().replace(/^["']|["']$/g, "").toLowerCase());
        }
      }
    }
  };
  for (const hex of palette || []) colors.add(resolve(hex));
  for (const sheet of all) {
    const href = sheet.href || "";
    const mode = !palette && href.includes("/design-system/") ? "system"
      : href.includes("studio-edits") ? "edits" : "overrides";
    try {
      collect(sheet.cssRules, mode);
    } catch {
      /* cross-origin sheet: cannot be read */
    }
  }
  probe.remove();

  const offColors = new Map();
  const offFonts = new Map();
  const note = (map, key, el) => {
    const entry = map.get(key) || { value: key, count: 0, example: "" };
    entry.count += 1;
    if (!entry.example) entry.example = (el.innerText || el.tagName.toLowerCase()).trim().slice(0, 30);
    map.set(key, entry);
  };
  const visible = (c) => c && !/rgba\([^)]*,\s*0\)$/.test(c) && c !== "transparent";

  for (const el of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const used = [];
    if (ownText) used.push(s.color);
    used.push(s.backgroundColor);
    if (parseFloat(s.borderTopWidth) > 0) used.push(s.borderTopColor);
    for (const c of used) if (visible(c) && !colors.has(c)) note(offColors, c, el);
    if (ownText && fonts.size) {
      const family = s.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (!fonts.has(family)) note(offFonts, family, el);
    }
  }
  const top = (map) => [...map.values()].sort((a, b) => b.count - a.count);

  // ---- Look-alikes of the system's components ----
  const names = componentsCss
    ? [...new Set([...componentsCss.matchAll(/\.ds-([a-z][a-z0-9]*)(?![a-z0-9_-]*__)/g)].map((m) => m[1]))]
    : [];
  const boxed = (el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    return (bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(bg)) || parseFloat(s.borderTopWidth) > 0
      || parseFloat(s.borderLeftWidth) > 0 || s.boxShadow !== "none";
  };
  const imitations = new Map();
  const noteImitation = (key, name, el) => {
    const entry = imitations.get(key) || { key, name, count: 0, example: (el.innerText || "").trim().slice(0, 30) };
    entry.count += 1;
    imitations.set(key, entry);
  };
  for (const name of names) {
    for (const el of document.body.querySelectorAll("[class]")) {
      if (!el.checkVisibility() || el.closest(`[class*="ds-${name}"]`)) continue;
      const own = [...el.classList].find((c) => !c.startsWith("ds-") && c.split(/[-_]+/).includes(name));
      if (own && boxed(el)) noteImitation(`.${own}`, name, el);
    }
    if (name === "button") {
      for (const el of document.body.querySelectorAll("button, a[href]")) {
        if (!el.checkVisibility() || [...el.classList].some((c) => c.startsWith("ds-")) || el.closest("[class*='ds-']")) continue;
        const s = getComputedStyle(el);
        const filled = s.backgroundColor !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(s.backgroundColor);
        if (filled) noteImitation(`<${el.tagName.toLowerCase()}>`, name, el);
      }
    }
  }
  return { colors: top(offColors), fonts: top(offFonts), systemColors: colors.size, imitations: top(imitations) };
}
