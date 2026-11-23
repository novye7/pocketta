(() => {
  "use strict";
  const VERSION = "0.8.0";
  if (globalThis.__chatgptUIExportSVG?.version === VERSION) return;
  const NS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";
  const CJK_FALLBACKS = ['"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Noto Sans CJK SC"'];
  const CLASSIC_GENERIC = /^(sans-serif|serif|monospace|cursive|fantasy)$/i;
  const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

  const number = value => Math.round(value * 1000) / 1000;
  const px = value => Number.parseFloat(value) || 0;

  // Keeps the page's own font resolution in browsers and adds concrete CJK
  // names for design tools that cannot resolve system keywords.
  function fontStack(family) {
    const parts = String(family || "sans-serif").split(",").map(part => part.trim()).filter(Boolean);
    // Insert before the trailing classic generic, so Latin and monospace
    // families earlier in the stack still win for their own glyphs.
    const generic = parts.findLastIndex(part => CLASSIC_GENERIC.test(part));
    const at = generic < 0 ? parts.length : generic;
    return [...parts.slice(0, at), ...CJK_FALLBACKS, ...parts.slice(at)].join(", ");
  }

  function gradientStops(value) {
    const stops = [];
    let depth = 0;
    let current = "";
    for (const character of value) {
      if (character === "(") depth++;
      else if (character === ")") depth--;
      if (character === "," && depth === 0) { stops.push(current); current = ""; continue; }
      current += character;
    }
    stops.push(current);
    return stops.map(stop => stop.trim());
  }

  function parseGradient(value) {
    const match = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/is.exec(value.trim());
    if (!match) return null;
    const [, repeating, kind, body] = match;
    const parts = gradientStops(body);
    // The first argument is a direction/shape only when it looks like one;
    // otherwise it is already the first colour stop.
    const isHead = /^\s*(to\s|-?[\d.]+(deg|grad|rad|turn)\b|circle\b|ellipse\b|closest-|farthest-|at\s|from\s|in\s)/i.test(parts[0]);
    const head = isHead ? parts.shift() : "";
    const stops = [];
    for (const part of parts) {
      const stop = /^(.*?)(?:\s+([\d.]+%|[\d.]+px))?$/.exec(part.trim());
      if (!stop) return null;
      stops.push({ color: stop[1].trim(), offset: stop[2] });
    }
    if (!stops.length) return null;
    const resolved = [];
    let previous = 0;
    for (let index = 0; index < stops.length; index++) {
      const explicit = stops[index].offset;
      let offset = explicit === undefined ? null : (explicit.endsWith("%") ? Number.parseFloat(explicit) / 100 : null);
      if (offset === null) {
        const remaining = stops.length - 1 - index;
        const next = stops[index + 1]?.offset;
        const target = next === undefined ? 1 : (next.endsWith("%") ? Number.parseFloat(next) / 100 : 1);
        offset = remaining === 0 ? 1 : previous + (target - previous) / (remaining + 1);
      }
      offset = Math.min(1, Math.max(offset, previous));
      resolved.push({ color: stops[index].color, offset });
      previous = offset;
    }
    if (kind === "linear") {
      const angle = /(-?[\d.]+)deg/.exec(head);
      let degrees = 180;
      if (angle) degrees = Number.parseFloat(angle[1]);
      else {
        const side = /to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?/.exec(head);
        if (side) {
          const [, first, second] = side;
          const corner = { "right": 90, "left": 270, "top": 0, "bottom": 180 };
          if (second) {
            const horizontal = ["left", "right"].includes(first) ? first : second;
            const vertical = ["top", "bottom"].includes(first) ? first : second;
            degrees = { "top right": 45, "top left": 315, "bottom right": 135, "bottom left": 225 }[`${vertical} ${horizontal}`] ?? 180;
          } else degrees = corner[first] ?? 180;
        }
      }
      return { kind, repeating: Boolean(repeating), degrees, stops: resolved };
    }
    const at = /at\s+(-?[\d.]+%|-?[\d.]+px)?\s*(-?[\d.]+%|-?[\d.]+px)?/.exec(head);
    const position = value => value === undefined ? 0.5 : value.endsWith("%") ? Number.parseFloat(value) / 100 : null;
    return {
      kind, repeating: Boolean(repeating), stops: resolved,
      cx: position(at?.[1]), cy: position(at?.[2]),
      shape: /\bcircle\b/.test(head) ? "circle" : "ellipse"
    };
  }

  function boxShadowParts(value) {
    if (!value || value === "none") return [];
    return gradientStops(value).map(shadow => {
      const inset = /\binset\b/.test(shadow);
      const color = shadow.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b/i);
      const lengths = shadow.replace(color?.[0] || "", "").replace(/\binset\b/, "").trim().split(/\s+/).filter(Boolean).map(Number.parseFloat);
      const [dx = 0, dy = 0, blur = 0, spread = 0] = lengths;
      return { inset, color: color?.[0] || "rgba(0, 0, 0, 0.5)", dx, dy, blur, spread };
    });
  }

  function render({ scene, config, ambient = "transparent", surface = "page", outline = false, signal }) {
    const Theme = globalThis.__chatgptUIExportTheme;
    const check = () => {
      if (signal?.aborted) throw new DOMException("导出已取消", "AbortError");
    };
    check();
    const geo = Theme.geometry(scene.width, scene.height, config.canvas);
    const { width, height } = geo;
    const root = document.createElementNS(NS, "svg");
    root.setAttribute("xmlns", NS);
    root.setAttribute("xmlns:xlink", XLINK);
    root.setAttribute("width", String(number(width)));
    root.setAttribute("height", String(number(height)));
    root.setAttribute("viewBox", `0 0 ${number(width)} ${number(height)}`);
    const language = (scene.root.node?.closest("[lang]")?.getAttribute("lang")) || document.documentElement.lang;
    if (language) root.setAttribute("lang", language);
    const defs = document.createElementNS(NS, "defs");
    root.append(defs);
    let counter = 0;
    const create = (name, attrs, parent = root) => {
      const node = document.createElementNS(NS, name);
      for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
      parent.append(node);
      return node;
    };
    const nextId = prefix => `${prefix}-${++counter}`;

    // ---- paint helpers ----
    const resolve = value => {
      const parsed = Theme.resolveColor(value);
      return parsed || TRANSPARENT;
    };
    const paint = (value, name = "fill") => {
      const parsed = resolve(value);
      // Alpha lives only in the opacity attribute; putting it in the colour too
      // would apply it twice.
      const opacity = name === "stop-color" ? "stop-opacity" : `${name}-opacity`;
      return { [name]: Theme.formatOpaque(parsed), ...(parsed.a < 1 ? { [opacity]: number(parsed.a) } : {}) };
    };
    // Fills a colourless slot with a value the palette can still reach.
    const paintGradient = (value, box, parent) => {
      const gradient = parseGradient(value);
      if (!gradient) return null;
      const id = nextId("ui-gradient");
      const node = gradient.kind === "linear"
        ? create("linearGradient", { id, gradientUnits: "userSpaceOnUse", ...Theme.gradientLine(box, gradient.degrees) }, defs)
        : create("radialGradient", {
          id, gradientUnits: "objectBoundingBox",
          cx: number(gradient.cx), cy: number(gradient.cy), r: number(gradient.shape === "circle" ? 0.5 : 0.7071)
        }, defs);
      if (gradient.repeating) node.setAttribute("spreadMethod", "repeat");
      for (const stop of gradient.stops) create("stop", { offset: number(stop.offset), ...paint(stop.color, "stop-color") }, node);
      return `url(#${id})`;
    };
    const radius = (value, size) => {
      if (!/^-?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px|%)?$/i.test(value)) {
        throw new Error("SVG 暂不支持这个圆角表达式，请使用 PNG。");
      }
      return value.endsWith("%") ? px(value) * size / 100 : px(value);
    };
    const rounded = (box, style, inset = 0) => {
      const x = box.x + inset;
      const y = box.y + inset;
      const w = Math.max(0, box.width - inset * 2);
      const h = Math.max(0, box.height - inset * 2);
      const keys = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
      const radii = keys.map(key => {
        const parts = String(style[key] || "0").split(" ");
        return [
          Math.max(0, radius(parts[0], box.width)),
          Math.max(0, radius(parts[1] || parts[0], box.height))
        ];
      });
      // CSS Backgrounds §4.5: overlapping corner radii share ONE reduction
      // factor, across both axes and all four corners. Independent half-width /
      // half-height clamps turn a large circular radius into an ellipse.
      const fit = (length, sum) => sum ? length / sum : 1;
      const factor = Math.min(1,
        fit(box.width, radii[0][0] + radii[1][0]),
        fit(box.width, radii[3][0] + radii[2][0]),
        fit(box.height, radii[0][1] + radii[3][1]),
        fit(box.height, radii[1][1] + radii[2][1]));
      // Border centre lines and inset rings derive from the resolved outer
      // corners, so resolve overlap before subtracting the inset.
      const corners = radii.map(pair => pair.map(value => Math.max(0, value * factor - inset)));
      const [[a, b], [c, d], [e, f], [g, i]] = corners;
      // Elliptical arcs, as CSS corners are; a zero radius degrades to a line.
      const arc = (rx, ry, tx, ty) => rx && ry ? `A${number(rx)} ${number(ry)} 0 0 1 ${number(tx)} ${number(ty)}` : `L${number(tx)} ${number(ty)}`;
      return `M${number(x + a)} ${number(y)}H${number(x + w - c)}${arc(c, d, x + w, y + d)}V${number(y + h - f)}${arc(e, f, x + w - e, y + h)}H${number(x + g)}${arc(g, i, x, y + h - i)}V${number(y + b)}${arc(a, b, x + a, y)}Z`;
    };

    // A CSS border is the area between two rounded boxes. Stroking an
    // elliptical centre line does not produce those inner and outer ellipses.
    const ring = (box, style, width) => rounded(box, style) +
      (box.width > width * 2 && box.height > width * 2 ? rounded(box, style, width) : "");

    function shadowPaths(box, style, parent, inset) {
      for (const shadow of boxShadowParts(style["box-shadow"]).reverse()) {
        if (shadow.inset !== inset) continue;
        if (shadow.inset) {
          // The common inset ring (`0 0 0 Npx inset`) is drawn exactly; anything
          // with an offset or blur needs a blur pass, which this renderer leaves
          // to the PNG path.
          if (shadow.dx || shadow.dy || shadow.blur) throw new Error("SVG 暂不支持这个内阴影效果，请使用 PNG。");
          if (shadow.spread <= 0) continue;
          create("path", {
            d: ring(box, style, shadow.spread), "fill-rule": "evenodd", ...paint(shadow.color)
          }, parent);
          continue;
        }
        const pad = Math.abs(shadow.dx) + Math.abs(shadow.dy) + shadow.blur * 3 + shadow.spread * 2 + 2;
        const filterId = nextId("ui-shadow");
        const filter = create("filter", {
          id: filterId, filterUnits: "userSpaceOnUse",
          x: number(box.x - pad), y: number(box.y - pad),
          width: number(box.width + pad * 2), height: number(box.height + pad * 2)
        }, defs);
        create("feGaussianBlur", { stdDeviation: shadow.blur ? number(shadow.blur / 2) : 0 }, filter);
        create("path", {
          d: rounded({ x: box.x + shadow.dx, y: box.y + shadow.dy, width: box.width, height: box.height }, style, -shadow.spread),
          ...paint(shadow.color), filter: `url(#${filterId})`
        }, parent);
      }
    }

    function boxPaint(box, style, parent) {
      shadowPaths(box, style, parent, false);
      // CSS paints the colour first, then the image layers from last to first.
      const background = resolve(style["background-color"]);
      if (background.a > 0) create("path", { d: rounded(box, style), ...paint(style["background-color"]) }, parent);
      if (style["background-image"] && style["background-image"] !== "none") {
        for (const layer of gradientStops(style["background-image"]).reverse()) {
          if (layer === "none") continue;
          const fill = paintGradient(layer, box, parent);
          if (!fill) throw new Error("SVG 暂不支持这个背景图案，请使用 PNG。");
          create("path", { d: rounded(box, style), fill }, parent);
        }
      }
      const edges = ["top", "right", "bottom", "left"];
      const widths = edges.map(edge => px(style[`border-${edge}-width`]));
      const colors = edges.map(edge => style[`border-${edge}-color`]);
      const styles = edges.map(edge => style[`border-${edge}-style`]);
      const dash = (width, value) => value === "dashed" ? `${number(width * 3)} ${number(width * 2)}` : value === "dotted" ? `${number(width)} ${number(width)}` : undefined;
      if (widths.every(width => width === widths[0]) && colors.every(color => color === colors[0]) && styles.every(style => style === styles[0])) {
        if (widths[0] && !["none", "hidden"].includes(styles[0])) {
          create("path", styles[0] === "solid" ? {
            d: ring(box, style, widths[0]), "fill-rule": "evenodd", ...paint(colors[0])
          } : {
            d: rounded(box, style, widths[0] / 2), fill: "none", ...paint(colors[0], "stroke"),
            "stroke-width": widths[0], "stroke-dasharray": dash(widths[0], styles[0])
          }, parent);
        }
      } else {
        const { x, y, width: w, height: h } = box;
        const lines = [
          `M${number(x)} ${number(y + widths[0] / 2)}H${number(x + w)}`,
          `M${number(x + w - widths[1] / 2)} ${number(y)}V${number(y + h)}`,
          `M${number(x)} ${number(y + h - widths[2] / 2)}H${number(x + w)}`,
          `M${number(x + widths[3] / 2)} ${number(y)}V${number(y + h)}`
        ];
        edges.forEach((edge, index) => {
          if (!widths[index] || ["none", "hidden"].includes(styles[index])) return;
          create("path", {
            d: lines[index], fill: "none", ...paint(colors[index], "stroke"),
            "stroke-width": widths[index], "stroke-dasharray": dash(widths[index], styles[index])
          }, parent);
        });
      }
      const outlineWidth = px(style["outline-width"]);
      if (outlineWidth && !["none", "hidden"].includes(style["outline-style"])) {
        const offset = px(style["outline-offset"]);
        create("path", {
          d: rounded({ x: box.x - offset, y: box.y - offset, width: box.width + offset * 2, height: box.height + offset * 2 }, style, outlineWidth / 2),
          fill: "none", ...paint(style["outline-color"], "stroke"), "stroke-width": outlineWidth,
          "stroke-dasharray": dash(outlineWidth, style["outline-style"])
        }, parent);
      }
      shadowPaths(box, style, parent, true);
    }

    // ---- text ----
    const metricsContext = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas").getContext("2d");
    const metricsCache = new Map();
    function fontMetrics(style, sample) {
      const key = `${style["font-style"]} ${style["font-weight"]} ${style["font-size"]} ${style["font-family"]}`;
      if (!metricsCache.has(key)) {
        metricsContext.font = key;
        const measured = metricsContext.measureText(sample || "Hg");
        metricsCache.set(key, {
          ascent: measured.fontBoundingBoxAscent ?? px(style["font-size"]) * 0.8,
          descent: measured.fontBoundingBoxDescent ?? px(style["font-size"]) * 0.2
        });
      }
      return metricsCache.get(key);
    }

    function textLines(runs) {
      const lines = [];
      for (const run of runs) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.baseline - run.baseline) < 0.75) {
          line.runs.push(run);
          continue;
        }
        lines.push({ baseline: run.baseline, runs: [run] });
      }
      return lines;
    }

    // Outlined text: one shared path per distinct glyph, placed with <use>.
    const Outline = globalThis.__chatgptUIExportOutline;
    const glyphIds = new Map();
    function outlinedLine(line, characters, baseline, style, parent) {
      const group = create("g", { ...paint(style.color), "aria-label": characters.join("").trim() }, parent);
      line.runs.forEach((run, index) => {
        if (!characters[index].trim()) return;
        const glyph = Outline.glyph(style, characters[index]);
        if (glyph.empty) return;
        if (glyph.image) {
          create("image", {
            x: number(run.x + glyph.x), y: number(baseline + glyph.y), width: glyph.width, height: glyph.height,
            href: glyph.image, "xlink:href": glyph.image
          }, group);
          return;
        }
        if (!glyphIds.has(glyph)) {
          glyphIds.set(glyph, nextId("ui-glyph"));
          create("path", { id: glyphIds.get(glyph), d: glyph.d }, defs);
        }
        const href = `#${glyphIds.get(glyph)}`;
        create("use", { href, "xlink:href": href, x: number(run.x), y: number(baseline) }, group);
      });
    }

    function textNode(record, parent) {
      const style = record.style;
      if (!record.runs.length) return;
      const lineHeight = style["line-height"] === "normal" ? null : px(style["line-height"]);
      const metrics = fontMetrics(style, record.text);
      const contentHeight = metrics.ascent + metrics.descent;
      const halfLeading = lineHeight === null ? 0 : Math.max(0, (lineHeight - contentHeight) / 2);
      const transform = style["text-transform"];
      const attribute = family => ({ "font-family": family, "font-size": px(style["font-size"]), "font-weight": style["font-weight"], "font-style": style["font-style"] });
      for (const line of textLines(record.runs)) {
        const tallest = line.runs.reduce((value, run) => Math.max(value, run.height), 0);
        const isLineBox = lineHeight !== null && Math.abs(tallest - lineHeight) < 1;
        // The range rect can be the line box (which includes half-leading) or the
        // text content box, depending on the engine, so the baseline is derived
        // from whichever one it is.
        const baseline = line.runs[0].baseline - metrics.descent - (isLineBox ? halfLeading : 0);
        let text = line.runs.map(run => run.text).join("");
        if (transform === "uppercase") text = text.toUpperCase();
        else if (transform === "lowercase") text = text.toLowerCase();
        else if (transform === "capitalize") text = text.replace(/(^|\s)(\S)/g, (all, space, letter) => space + letter.toUpperCase());
        if (outline) {
          // Case changes can alter the character count; fall back to the source.
          const characters = Array.from(text);
          outlinedLine(line, characters.length === line.runs.length ? characters : line.runs.map(run => run.text), baseline, style, parent);
          continue;
        }
        const positions = line.runs.map(run => number(run.x)).join(" ");
        const node = create("text", {
          ...paint(style.color), "xml:space": "preserve",
          ...attribute(fontStack(style["font-family"])),
          x: Array.from(text).length === line.runs.length ? positions : number(line.runs[0].x),
          y: number(baseline),
          "letter-spacing": style["letter-spacing"] !== "normal" ? style["letter-spacing"] : undefined,
          "font-feature-settings": style["font-feature-settings"] !== "normal" ? style["font-feature-settings"] : undefined,
          direction: style.direction === "rtl" ? "rtl" : undefined
        }, parent);
        node.textContent = text;
      }
    }

    // ---- inline SVG icons ----
    const PRESENTATION = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "clip-rule", "color"];
    function icon(record, parent) {
      const copy = record.copy;
      const box = record.rect;
      const view = (record.node.getAttribute("viewBox") || `0 0 ${box.width} ${box.height}`).trim().split(/[ ,]+/).map(Number);
      const scale = Math.min(box.width / view[2], box.height / view[3]);
      const x = box.x + (box.width - view[2] * scale) / 2 - view[0] * scale;
      const y = box.y + (box.height - view[3] * scale) / 2 - view[1] * scale;
      const group = create("g", { transform: `translate(${number(x)} ${number(y)}) scale(${number(scale)})` }, parent);
      const targets = new Map([...copy.querySelectorAll("[id]")].map(node => [node.id, node]));
      const value = (node, key, inherited) => {
        const css = node.style?.getPropertyValue(key);
        let resolved = css || node.getAttribute(key);
        if (resolved && (resolved === "currentcolor" || resolved === "currentColor")) resolved = inherited;
        return resolved;
      };
      const draw = (node, destination, inheritedColor, chain = []) => {
        if (node.nodeType !== Node.ELEMENT_NODE || ["defs", "title", "desc", "style"].includes(node.localName)) return;
        if (["foreignObject", "filter", "mask", "image", "text"].includes(node.localName)) throw new Error("SVG 图标包含暂不支持的内容，请使用 PNG。");
        const current = value(node, "color", inheritedColor) || inheritedColor;
        if (node.localName === "use") {
          const href = node.getAttribute("href") || node.getAttributeNS(XLINK, "href");
          if (!href?.startsWith("#") || chain.includes(href) || chain.length > 8) throw new Error("SVG 图标引用无效。");
          const target = targets.get(href.slice(1));
          if (!target) throw new Error("SVG 图标定义缺失。");
          const useGroup = create("g", {}, destination);
          for (const key of PRESENTATION) {
            const resolved = value(node, key, current);
            if (resolved) useGroup.setAttribute(key, String(resolved));
          }
          if (target.localName === "symbol") for (const child of target.children) draw(child, useGroup, current, [...chain, href]);
          else draw(target, useGroup, current, [...chain, href]);
          return;
        }
        if (!["svg", "g", "symbol", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(node.localName)) {
          throw new Error("SVG 图标形状暂不支持。");
        }
        const shapes = ["svg", "symbol"].includes(node.localName) ? "g" : node.localName;
        const out = create(shapes, {}, destination);
        for (const key of ["d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "x2", "y1", "y2", "points", "transform"]) {
          const raw = node.getAttribute(key);
          if (raw !== null) out.setAttribute(key, raw);
        }
        for (const key of PRESENTATION) {
          const resolved = value(node, key, current);
          if (resolved) out.setAttribute(key, String(resolved));
        }
        for (const child of node.children) draw(child, out, current, chain);
      };
      for (const key of PRESENTATION) {
        const resolved = value(copy, key, record.style.color);
        if (resolved) group.setAttribute(key, String(resolved));
      }
      for (const child of copy.children) draw(child, group, record.style.color);
    }

    function control(record, parent) {
      const box = record.rect;
      const style = record.style;
      const size = Math.min(box.width, box.height);
      const accent = globalThis.__chatgptUIExportTheme.resolveColor(style["accent-color"]) ? style["accent-color"] : style.color;
      const attrs = { ...paint(record.checked ? accent : "rgb(255, 255, 255)"), stroke: "#999999", "stroke-width": 1 };
      if (record.control === "radio") {
        create("circle", { cx: number(box.x + box.width / 2), cy: number(box.y + box.height / 2), r: number(Math.max(0, size / 2 - 1)), ...attrs }, parent);
        return;
      }
      create("rect", { x: number(box.x + 0.5), y: number(box.y + 0.5), width: number(Math.max(0, box.width - 1)), height: number(Math.max(0, box.height - 1)), rx: 3, ...attrs }, parent);
      if (record.checked) {
        create("path", { d: `M${number(box.x + box.width * 0.2)} ${number(box.y + box.height * 0.5)}l${number(box.width * 0.2)} ${number(box.height * 0.2)}l${number(box.width * 0.4)} ${number(-box.height * 0.4)}`, fill: "none", stroke: "#ffffff", "stroke-width": 1.5 }, parent);
      }
    }

    // ---- walk ----
    function draw(record, parent) {
      switch (record.kind) {
        case "text": return textNode(record, parent);
        case "pseudo": return boxPaint(record.rect, record.style, parent);
        case "icon": return icon(record, parent);
        default: break;
      }
      const style = record.style;
      if (style.transform !== "none") throw new Error("SVG 暂不支持 CSS 变换，请使用 PNG。");
      if (style.filter !== "none" || style["backdrop-filter"] !== "none" || style["mix-blend-mode"] !== "normal") throw new Error("SVG 暂不支持滤镜或混合效果，请使用 PNG。");
      const group = create("g", { opacity: Number(style.opacity) !== 1 ? style.opacity : undefined }, parent);
      if (record.media === "image") {
        const href = record.copy.getAttribute("src");
        const fit = style["object-fit"];
        create("image", {
          x: number(record.rect.x), y: number(record.rect.y), width: number(record.rect.width), height: number(record.rect.height),
          href, "xlink:href": href,
          preserveAspectRatio: fit === "contain" ? "xMidYMid meet" : fit === "cover" ? "xMidYMid slice" : "none"
        }, group);
      } else if (record.media === "control") {
        control(record, group);
      } else {
        boxPaint(record.rect, style, group);
        let target = group;
        if (record.clip) {
          const clip = create("clipPath", { id: nextId("ui-clip"), clipPathUnits: "userSpaceOnUse" }, defs);
          create("path", { d: rounded(record.rect, style) }, clip);
          target = create("g", { "clip-path": `url(#${clip.id})` }, group);
        }
        for (const child of record.children) draw(child, target);
      }
    }

    if (ambient && ambient !== "transparent" && surface !== "transparent") {
      create("rect", { x: 0, y: 0, width: number(width), height: number(height), ...paint(ambient) });
    }
    const clipUrl = Theme.paintSVG({ create, defs, root }, geo, config.canvas, nextId("ui-canvas"));
    // The clip is in canvas coordinates, so it sits outside the translated group.
    const clipped = clipUrl ? create("g", { "clip-path": clipUrl }) : root;
    const content = create("g", { transform: `translate(${number(geo.content.x)} ${number(geo.content.y)})` }, clipped);
    const { root: sceneRoot } = scene;
    const outer = create("g", {}, content);
    // The root paints its own box (border, radius, background) too. Its rects
    // are already measured in the transformed frame, so its transform is dropped.
    draw({ ...sceneRoot, style: { ...sceneRoot.style, transform: "none" } }, outer);
    check();
    const xml = new XMLSerializer().serializeToString(root).replace(/[^\x00-\x7f]/gu, character => `&#x${character.codePointAt(0).toString(16)};`);
    return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, width, height };
  }

  globalThis.__chatgptUIExportSVG = Object.freeze({ version: VERSION, render, parseGradient, boxShadowParts, fontStack });
})();
