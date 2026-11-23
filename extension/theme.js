(() => {
  "use strict";
  const VERSION = "0.8.0";
  if (globalThis.__chatgptUIExportTheme?.version === VERSION) return;

  const STORAGE_KEY = "chatgpt-ui-export.presets";
  const SHADOWS = {
    none: null,
    soft: { y: 4, blur: 16, alpha: 0.1 },
    medium: { y: 8, blur: 28, alpha: 0.16 },
    strong: { y: 16, blur: 48, alpha: 0.24 }
  };
  // The ambient surface colour of the chat page, per theme. The first entry that
  // resolves wins; the literals keep exports sane if ChatGPT renames its tokens.
  const SURFACE_TOKENS = ["--color-surface-canvas", "--main-surface-primary", "--surface-1"];
  const SURFACE_FALLBACK = { light: "#fcfcfc", dark: "#0d0d0d" };
  const COLOR_PROPERTIES = [
    "color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "outline-color", "text-decoration-color", "caret-color", "fill", "stroke", "column-rule-color", "accent-color"
  ];
  const TOKEN_PATTERN = /([a-z-]+)\(|#[0-9a-f]{3,8}\b/gi;
  const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "light-dark", "device-cmyk"]);

  const number = (value, fallback) => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
  const rgbKey = (r, g, b) => `${r},${g},${b}`;
  const hex = (r, g, b) => `#${[r, g, b].map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;

  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  probe.canvas.width = 1;
  probe.canvas.height = 1;
  const colorCache = new Map();
  const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;

  function parseHex(value) {
    const digits = value.slice(1);
    const sizes = { 3: 1, 4: 1, 6: 2, 8: 2 };
    const size = sizes[digits.length];
    if (!size) return null;
    const parts = [];
    for (let index = 0; index < digits.length; index += size) {
      const chunk = digits.slice(index, index + size);
      parts.push(Number.parseInt(size === 1 ? chunk + chunk : chunk, 16));
    }
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] / 255 : 1 };
  }

  const RGB_PATTERN = /^rgba?\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*(?:[,/]\s*(-?[\d.]+)(%)?\s*)?\)$/;
  const SRGB_PATTERN = /^color\(\s*srgb\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*(-?[\d.]+)(%)?\s*)?\)$/;
  const channel = value => clamp(Math.round(value), 0, 255);
  const alphaOf = (value, percent) => value === undefined ? 1 : clamp(Number.parseFloat(value) / (percent ? 100 : 1), 0, 1);

  function samplePixel(color) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data;
  }

  // Resolves any CSS colour (including oklab/color-mix/lab) to plain sRGB channels.
  // Computed styles are almost always rgb()/rgba(), which are parsed exactly; the
  // canvas is only the fallback, because its premultiplied 8-bit store loses
  // precision on translucent colours.
  function resolveColor(value) {
    if (!value || typeof value !== "string") return null;
    const key = value.trim().toLowerCase();
    if (!key || key === "none") return null;
    if (colorCache.has(key)) return colorCache.get(key);
    let result = null;
    let match;
    if (HEX_PATTERN.test(key)) {
      result = parseHex(key);
    } else if (key === "transparent") {
      result = { r: 0, g: 0, b: 0, a: 0 };
    } else if ((match = RGB_PATTERN.exec(key))) {
      result = { r: channel(match[1]), g: channel(match[2]), b: channel(match[3]), a: alphaOf(match[4], match[5]) };
    } else if ((match = SRGB_PATTERN.exec(key))) {
      result = { r: channel(match[1] * 255), g: channel(match[2] * 255), b: channel(match[3] * 255), a: alphaOf(match[4], match[5]) };
    } else if (CSS.supports?.("color", key) !== false) {
      try {
        const [r, g, b, a] = samplePixel(key);
        result = { r, g, b, a: a / 255 };
        // Read the channels again from an opaque copy when the colour is
        // translucent, so they are not rounded by premultiplication.
        const opaque = `rgb(from ${key} r g b / 1)`;
        if (a > 0 && a < 255 && CSS.supports?.("color", opaque)) {
          const [r2, g2, b2, a2] = samplePixel(opaque);
          if (a2 === 255) Object.assign(result, { r: r2, g: g2, b: b2 });
        }
      } catch { result = null; }
    }
    colorCache.set(key, result);
    return result;
  }

  const formatColor = ({ r, g, b, a = 1 }) => a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a)})`;
  const formatOpaque = ({ r, g, b }) => hex(r, g, b);

  function mapColor(value, palette) {
    if (!palette || !value) return value;
    const source = resolveColor(value);
    if (!source || source.a === 0) return value;
    const target = resolveColor(palette[rgbKey(source.r, source.g, source.b)]);
    if (!target) return value;
    return formatColor({ r: target.r, g: target.g, b: target.b, a: source.a * target.a });
  }

  // Rewrites every colour token inside a value list (gradients, shadows), while
  // leaving url(...) payloads and unparsable tokens untouched.
  function mapColorList(value, palette) {
    if (!palette || !value || !value.includes("(")) return value;
    let output = "";
    let index = 0;
    while (index < value.length) {
      const character = value[index];
      if (character === "#") {
        const token = /^#[0-9a-f]{3,8}/i.exec(value.slice(index));
        if (token) { output += mapColor(token[0], palette); index += token[0].length; continue; }
        output += character; index++; continue;
      }
      TOKEN_PATTERN.lastIndex = index;
      const match = TOKEN_PATTERN.exec(value);
      if (!match || match.index !== index) { output += character; index++; continue; }
      const name = (match[1] || "").toLowerCase();
      if (!match[1] || !COLOR_FUNCTIONS.has(name)) { output += match[0]; index += match[0].length; continue; }
      if (name === "url") { output += match[0]; index += match[0].length; continue; }
      let depth = 0;
      let end = index + match[0].length - 1;
      for (; end < value.length; end++) {
        if (value[end] === "(") depth++;
        else if (value[end] === ")" && --depth === 0) break;
      }
      if (end >= value.length) { output += value.slice(index); break; }
      const inner = value.slice(index + match[0].length, end);
      const replacement = mapColor(inner, palette);
      output += replacement === inner ? `${match[0]}${inner})` : replacement;
      index = end + 1;
    }
    return output;
  }

  function scaleRadius(value, factor) {
    if (!factor || factor === 1 || !value) return value;
    return String(value).replace(/(-?[\d.]+)(px|rem|em)?/g, (whole, amount, unit) => `${round(number(amount, 0) * factor, 2)}${unit || "px"}`);
  }

  function cleanPalette(input) {
    if (!input || typeof input !== "object") return {};
    const palette = {};
    for (const [key, value] of Object.entries(input)) {
      const parts = String(key).split(",").map(Number);
      if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) continue;
      const target = resolveColor(value);
      if (!target) continue;
      palette[rgbKey(parts[0], parts[1], parts[2])] = hex(target.r, target.g, target.b);
    }
    return palette;
  }

  function defaults() {
    return {
      mode: "page",
      palette: {},
      font: "",
      radius: 1,
      canvas: { padding: 0, background: { type: "none", color: "#ffffff", from: "#ffffff", to: "#e5e5e5", angle: 180 }, radius: 0, shadow: "none" }
    };
  }

  function normalize(input) {
    const base = defaults();
    const raw = input && typeof input === "object" ? input : {};
    const canvas = raw.canvas && typeof raw.canvas === "object" ? raw.canvas : {};
    const background = canvas.background && typeof canvas.background === "object" ? canvas.background : {};
    const type = ["none", "solid", "gradient"].includes(background.type) ? background.type : "none";
    const color = value => resolveColor(value) ? String(value).trim() : undefined;
    return {
      mode: ["page", "light", "dark"].includes(raw.mode) ? raw.mode : base.mode,
      palette: cleanPalette(raw.palette),
      font: typeof raw.font === "string" ? raw.font.trim().slice(0, 240) : "",
      radius: clamp(number(raw.radius, 1), 0, 3),
      canvas: {
        padding: clamp(Math.round(number(canvas.padding, 0)), 0, 160),
        background: {
          type,
          color: color(background.color) || base.canvas.background.color,
          from: color(background.from) || base.canvas.background.from,
          to: color(background.to) || base.canvas.background.to,
          angle: clamp(Math.round(number(background.angle, 180)), 0, 360)
        },
        radius: clamp(Math.round(number(canvas.radius, 0)), 0, 200),
        shadow: SHADOWS[canvas.shadow] ? canvas.shadow : "none"
      }
    };
  }

  const isPlain = theme => !theme.palette || !Object.keys(theme.palette).length;
  const isDefault = theme => theme.mode === "page" && isPlain(theme) && !theme.font && theme.radius === 1 &&
    !theme.canvas.padding && theme.canvas.background.type === "none" && !theme.canvas.radius && theme.canvas.shadow === "none";

  // Reads the ambient chat surface colour for a theme. A forced theme is resolved
  // on a hidden, childless copy of the ancestor that paints the surface, so the
  // page's own token rules decide the colour and the live page is not restyled.
  function ambientBackground(mode, source) {
    let surface = null;
    for (let node = source; node; node = node.parentElement) {
      const parsed = resolveColor(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.a > 0) { surface = node; break; }
    }
    if (mode === "page") {
      return surface ? formatColor(resolveColor(getComputedStyle(surface).backgroundColor)) : SURFACE_FALLBACK.light;
    }
    const rooted = !surface || surface === document.body || surface === document.documentElement;
    const probe = rooted ? document.createElement("div") : surface.cloneNode(false);
    if (rooted && surface) probe.className = surface.className;
    probe.removeAttribute("id");
    probe.setAttribute("data-theme", mode);
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed!important;left:-20000px!important;top:0!important;width:1px!important;height:1px!important;visibility:hidden!important;pointer-events:none!important;";
    (rooted ? document.body : surface.parentElement).append(probe);
    try {
      const style = getComputedStyle(probe);
      const direct = resolveColor(style.backgroundColor);
      if (direct && direct.a > 0) return formatColor(direct);
      for (const token of SURFACE_TOKENS) {
        const parsed = resolveColor(style.getPropertyValue(token).trim());
        if (parsed && parsed.a > 0) return formatColor(parsed);
      }
      return SURFACE_FALLBACK[mode];
    } finally {
      probe.remove();
    }
  }

  const shadowCSS = shadow => shadow ? `0 ${shadow.y}px ${shadow.blur}px rgba(0, 0, 0, ${shadow.alpha})` : "none";

  // Output geometry: content box plus padding plus room for the shadow bleed.
  function geometry(width, height, canvas) {
    const shadow = SHADOWS[canvas.shadow];
    const bleed = shadow ? Math.ceil(shadow.blur + Math.abs(shadow.y)) : 0;
    const pad = canvas.padding;
    const card = { x: bleed, y: bleed, width: width + pad * 2, height: height + pad * 2 };
    return {
      shadow,
      bleed,
      card,
      radius: Math.min(canvas.radius, card.width / 2, card.height / 2),
      content: { x: card.x + pad, y: card.y + pad, width, height },
      width: card.width + bleed * 2,
      height: card.height + bleed * 2
    };
  }

  // The CSS gradient line for a box, in the box's own coordinate space: it runs
  // through the centre at the given angle and ends where the corners project.
  const gradientLine = (box, angle) => {
    const radians = angle * Math.PI / 180;
    const dx = Math.sin(radians);
    const dy = -Math.cos(radians);
    const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return { x1: round(cx - dx * half, 3), y1: round(cy - dy * half, 3), x2: round(cx + dx * half, 3), y2: round(cy + dy * half, 3) };
  };

  function cardPath(context, { x, y, width, height }, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
  }

  function fillCard(context, box, canvas, { withShadow = true } = {}) {
    const background = canvas.background;
    if (background.type === "none") return false;
    const shadow = SHADOWS[canvas.shadow];
    context.save();
    if (withShadow && shadow) {
      context.shadowColor = `rgba(0, 0, 0, ${shadow.alpha})`;
      context.shadowBlur = shadow.blur;
      context.shadowOffsetY = shadow.y;
    }
    context.fillStyle = background.type === "gradient"
      ? (() => {
        const { x1, y1, x2, y2 } = gradientLine(box, background.angle);
        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, background.from);
        gradient.addColorStop(1, background.to);
        return gradient;
      })()
      : background.color;
    cardPath(context, box, Math.min(canvas.radius, box.width / 2, box.height / 2));
    context.fill();
    context.restore();
    return true;
  }

  // SVG counterpart of fillCard: appends defs and returns the paint order nodes.
  function paintSVG({ create, defs, root }, geo, canvas, id) {
    const background = canvas.background;
    const painted = background.type !== "none";
    let filterId = null;
    if (painted && geo.shadow) {
      filterId = `${id}-shadow`;
      const filter = create("filter", { id: filterId, x: "-40%", y: "-40%", width: "180%", height: "180%", filterUnits: "objectBoundingBox" }, defs);
      create("feDropShadow", {
        dx: 0, dy: geo.shadow.y, stdDeviation: round(geo.shadow.blur / 2, 2), "flood-color": "#000000", "flood-opacity": geo.shadow.alpha
      }, filter);
    }
    if (painted) {
      const fill = background.type === "gradient" ? `url(#${id}-paint)` : background.color;
      if (background.type === "gradient") {
        const gradient = create("linearGradient", { id: `${id}-paint`, gradientUnits: "userSpaceOnUse", ...gradientLine(geo.card, background.angle) }, defs);
        create("stop", { offset: "0", "stop-color": background.from }, gradient);
        create("stop", { offset: "1", "stop-color": background.to }, gradient);
      }
      create("rect", {
        x: geo.card.x, y: geo.card.y, width: geo.card.width, height: geo.card.height,
        rx: geo.radius || undefined, fill, filter: filterId ? `url(#${filterId})` : undefined
      }, root);
    }
    if (!geo.radius) return null;
    const clip = create("clipPath", { id: `${id}-clip`, clipPathUnits: "userSpaceOnUse" }, defs);
    create("rect", { x: geo.card.x, y: geo.card.y, width: geo.card.width, height: geo.card.height, rx: geo.radius }, clip);
    return `url(#${id}-clip)`;
  }

  // Distinct colours in a component, with the role they are mostly used for.
  function collectColors(nodes, styleOf) {
    const roles = new Map();
    const order = ["background", "text", "border", "fill", "stroke", "shadow"];
    const record = (value, role, property) => {
      const parsed = resolveColor(value);
      if (!parsed || parsed.a === 0) return;
      const key = rgbKey(parsed.r, parsed.g, parsed.b);
      const entry = roles.get(key) || { key, color: hex(parsed.r, parsed.g, parsed.b), alpha: parsed.a, count: 0, roles: new Set(), properties: new Set() };
      entry.count++;
      entry.roles.add(role);
      entry.properties.add(property);
      entry.alpha = Math.max(entry.alpha, parsed.a);
      roles.set(key, entry);
    };
    for (const node of nodes) {
      const style = styleOf(node);
      for (const property of COLOR_PROPERTIES) {
        const value = style.getPropertyValue(property);
        if (!value || value === "none") continue;
        const role = property === "color" ? "text" : property === "fill" || property === "stroke" ? property : property.includes("border") ? "border" : property === "background-color" ? "background" : null;
        if (role) record(value, role, property);
      }
      for (const property of ["background-image", "box-shadow", "text-shadow"]) {
        const value = style.getPropertyValue(property);
        if (!value || value === "none" || !value.includes("(")) continue;
        const matches = value.match(/(?:rgba?|hsla?|oklab|oklch|lab|lch|color|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b/gi) || [];
        for (const token of matches) record(token, property === "background-image" ? "background" : "shadow", property);
      }
    }
    return [...roles.values()]
      .map(entry => ({ ...entry, role: order.find(role => entry.roles.has(role)) || "background", roles: undefined }))
      .sort((a, b) => b.count - a.count);
  }

  const storage = () => (typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null);
  const readPresets = async () => {
    const area = storage();
    if (!area) return {};
    const stored = await area.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY];
    return value && typeof value === "object" ? value : {};
  };
  const writePresets = async presets => {
    const area = storage();
    if (area) await area.set({ [STORAGE_KEY]: presets });
    return presets;
  };
  const savePreset = async (name, theme) => {
    const presets = await readPresets();
    presets[String(name).trim().slice(0, 40)] = normalize(theme);
    return writePresets(presets);
  };
  const deletePreset = async name => {
    const presets = await readPresets();
    delete presets[name];
    return writePresets(presets);
  };

  globalThis.__chatgptUIExportTheme = Object.freeze({
    version: VERSION,
    SHADOWS, SURFACE_FALLBACK, defaults, normalize, isPlain, isDefault,
    resolveColor, formatColor, formatOpaque, mapColor, mapColorList, rgbKey, scaleRadius,
    ambientBackground, shadowCSS, geometry, gradientLine, cardPath, fillCard, paintSVG,
    collectColors, readPresets, savePreset, deletePreset
  });
})();
