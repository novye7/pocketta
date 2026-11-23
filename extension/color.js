(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__chatgptUIExportColor?.version === VERSION) return;

  // The page surface, used when nothing behind the component paints a colour.
  const SURFACE_FALLBACK = "#fcfcfc";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
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

  // The nearest opaque background behind a component: the page colour a
  // "page" export fills in.
  function ambientBackground(source) {
    for (let node = source; node; node = node.parentElement) {
      const parsed = resolveColor(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.a > 0) return formatColor(parsed);
    }
    return SURFACE_FALLBACK;
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

  globalThis.__chatgptUIExportColor = Object.freeze({
    version: VERSION, resolveColor, formatColor, formatOpaque, ambientBackground, gradientLine
  });
})();
