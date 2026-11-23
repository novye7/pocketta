(() => {
  "use strict";
  const VERSION = "0.8.0";
  if (globalThis.__chatgptUIExportCapture?.version === VERSION) return;

  const MAX_NODES = 8_000;
  const MAX_CHARACTERS = 120_000;
  const MAX_EMBEDDED_NODES = 16_000;
  const STYLE_PROPERTIES = [
    "display", "visibility", "opacity", "position", "overflow-x", "overflow-y", "box-sizing",
    "background-color", "background-image", "box-shadow", "color", "outline-color", "outline-width", "outline-style", "outline-offset",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-feature-settings", "font-variation-settings",
    "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent", "text-transform", "text-decoration-color", "text-decoration-line",
    "white-space", "word-break", "overflow-wrap", "direction", "writing-mode", "tab-size",
    "transform", "filter", "backdrop-filter", "mix-blend-mode", "object-fit", "object-position", "z-index", "color-scheme",
    "accent-color", "caret-color", "list-style-type", "list-style-position"
  ];
  const SKIP_TAGS = new Set(["script", "style", "link", "meta", "base", "template", "source", "option", "title", "desc", "noscript"]);
  const UNSUPPORTED_TAGS = new Set(["canvas", "iframe", "audio", "video", "object", "embed"]);
  const COLOR_PROPERTIES = new Set([
    "color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "outline-color", "text-decoration-color", "caret-color", "fill", "stroke", "accent-color", "column-rule-color",
    "-webkit-text-fill-color", "-webkit-text-stroke-color", "text-emphasis-color"
  ]);
  const COLOR_LIST_PROPERTIES = new Set([
    "background-image", "box-shadow", "text-shadow", "outline", "border", "border-top", "border-right", "border-bottom", "border-left"
  ]);

  function assertActive(signal) {
    if (signal?.aborted) throw new DOMException("导出已取消", "AbortError");
  }

  // Long loops pause for the page now and then. The pause is taken when time
  // is up rather than every so many nodes, because nested timers are clamped to
  // 4 ms each and used to add up to a third of a large export.
  function pacer(signal) {
    let last = performance.now();
    return {
      due: () => performance.now() - last > 16,
      async rest() {
        await (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0)));
        last = performance.now();
        assertActive(signal);
      }
    };
  }

  function bounded(promise, signal, ms, message) {
    return new Promise((resolve, reject) => {
      const abort = () => finish(reject, new DOMException("导出已取消", "AbortError"));
      const timer = setTimeout(() => finish(reject, new Error(message)), ms);
      const finish = (settle, value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        settle(value);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  function blobAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取图片资源。"));
      reader.readAsDataURL(blob);
    });
  }

  // Custom colours are applied to resolved values, so they work for every theme
  // and for both renderers. Font and radius overrides are applied to the staged
  // clone itself, because they change layout.
  // Null when no colour is replaced, so the common case skips the lookup.
  const mapperFor = config => {
    const Theme = globalThis.__chatgptUIExportTheme;
    if (Theme.isPlain(config)) return null;
    return (property, value) => {
      if (COLOR_PROPERTIES.has(property)) return Theme.mapColor(value, config.palette);
      if (COLOR_LIST_PROPERTIES.has(property)) return Theme.mapColorList(value, config.palette);
      return value;
    };
  };

  const styleRecord = (style, map) => {
    const record = {};
    for (const property of STYLE_PROPERTIES) {
      const value = style.getPropertyValue(property);
      record[property] = map ? map(property, value) : value;
    }
    return record;
  };

  const MONOSPACE = /mono|courier|consolas|menlo|monaco/i;
  const RADIUS_PROPERTIES = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];

  // Applies layout-affecting overrides to the staged clone. Every value is read
  // before any is written, so one element's override cannot skew another's read.
  function applyOverrides(copies, config) {
    const Theme = globalThis.__chatgptUIExportTheme;
    const edits = [];
    for (const copy of copies) {
      if (!(copy instanceof HTMLElement)) continue;
      const style = getComputedStyle(copy);
      const values = [];
      if (config.font && !MONOSPACE.test(style.fontFamily)) values.push(["font-family", config.font]);
      if (config.radius !== 1) {
        for (const property of RADIUS_PROPERTIES) {
          const value = style.getPropertyValue(property);
          if (value && !/^0(px)?( 0(px)?)?$/.test(value)) values.push([property, Theme.scaleRadius(value, config.radius)]);
        }
      }
      if (values.length) edits.push({ copy, values });
    }
    for (const { copy, values } of edits) for (const [property, value] of values) copy.style.setProperty(property, value, "important");
  }

  // Places a hidden copy of the component next to it and applies the theme to
  // the copy, so tokens, fonts and radii resolve in the component's real
  // context while the component itself is left alone.
  function stage(source, clone, copies, config, rect) {
    if (!source.parentElement) throw new Error("组件当前不在页面中，无法应用主题。");
    if (config.mode !== "page") {
      // ChatGPT re-declares its tokens on every [data-theme] element, and
      // nested blocks (code surfaces) carry their own copy of the attribute.
      clone.setAttribute("data-theme", config.mode);
      for (const node of copies) if (node !== clone && node.hasAttribute("data-theme")) node.setAttribute("data-theme", config.mode);
    }
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
    // Tells component detection that this is not part of the conversation.
    clone.setAttribute("data-ui-export-staged", "");
    for (const node of copies) node.removeAttribute("id");
    Object.assign(clone.style, {
      position: "absolute", left: "0px", top: "0px", width: `${rect.width}px`,
      opacity: "0", pointerEvents: "none", margin: "0px"
    });
    source.parentElement.append(clone);
    // Overlay the clone exactly on the source, so sticky and scroll-dependent
    // descendants settle where the visible ones are.
    const placed = clone.getBoundingClientRect();
    clone.style.left = `${rect.left - placed.left}px`;
    clone.style.top = `${rect.top - placed.top}px`;
    applyOverrides(copies, config);
  }

  /**
   * Clones the component, resolves the requested theme and embeds its assets.
   * Without `scene` the clone is fully styled for the PNG renderer. With
   * `scene: true` the measured scene feeds the SVG renderer, and the clone is
   * styled only where that renderer reads it: inline icons.
   *
   * With theme.mode === "page" the live DOM is measured and the page is never
   * mutated. Any other mode appends the clone as the source parent's last child
   * with a `data-theme` attribute: ChatGPT's own tokens re-resolve in place, so
   * the clone keeps its inherited context, container queries and layout, and
   * only colours change.
   */
  async function build(source, { theme, signal, scene: wantScene = true } = {}) {
    assertActive(signal);
    const Theme = globalThis.__chatgptUIExportTheme;
    if (!Theme) throw new Error("请重新加载扩展后重试。");
    const config = Theme.normalize(theme);
    const rect = source.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (!width || !height) throw new Error("组件当前没有可导出的尺寸。");

    const originalRootStyle = getComputedStyle(source);
    const rootChrome = {
      opacity: originalRootStyle.opacity, zIndex: originalRootStyle.zIndex,
      position: originalRootStyle.position, transform: originalRootStyle.transform
    };
    const clone = source.cloneNode(true);
    const originals = [source, ...source.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    if (originals.length > MAX_NODES || copies.length !== originals.length) throw new Error("选取内容过多，请缩小选取范围。");
    if (originals.some(node => node.shadowRoot)) throw new Error("暂不支持包含 Shadow DOM 的组件。");
    if (originals.some(node => UNSUPPORTED_TAGS.has(node.localName))) throw new Error("暂不支持 Canvas、媒体或 iframe，请缩小选取范围后重试。");

    // "Staged" exports measure a hidden clone placed next to the component.
    const themed = config.mode !== "page" || Boolean(config.font) || config.radius !== 1;
    if (themed) stage(source, clone, copies, config, rect);
    const pace = pacer(signal);
    const map = mapperFor(config);
    const detached = { done: false };
    const detach = () => {
      if (detached.done) return;
      detached.done = true;
      clone.remove();
    };
    // Styles and geometry come from the clone when a theme is forced, and from
    // the live component otherwise.
    const readNode = (node, index) => themed ? copies[index] : node;
    const styleAt = (index, pseudo = null) => getComputedStyle(readNode(originals[index], index), pseudo);

    try {
      const { inlineAsset } = await embedAssets({ originals, copies, signal, pace });
      assertActive(signal);
      const origin = themed ? clone.getBoundingClientRect() : rect;
      const size = { width: Math.ceil(origin.width), height: Math.ceil(origin.height) };
      // Only the SVG renderer reads the scene, so its limits must not stop a PNG.
      const scene = wantScene ? await buildScene({ source, clone, themed, map, pace, origin, ...size }) : null;
      assertActive(signal);
      const rules = await exportStyles({ originals, copies, map, styleAt, inlineAsset, rootChrome, width: origin.width, height: origin.height, pace, vector: wantScene });
      detach();
      return {
        scene, clone, originals, copies, rules, width: size.width, height: size.height, config, signal,
        ambient: Theme.ambientBackground(config.mode, source), detach
      };
    } catch (error) {
      detach();
      throw error;
    }
  }

  // ---- assets -------------------------------------------------------------

  async function embedAssets({ originals, copies, signal, pace }) {
    const assetCache = new Map();
    const spriteCache = new Map();
    const allowedProtocols = new Set(["https:", "http:", "blob:"]);
    let embedded = originals.length;

    async function inlineUse(original, copy, contextDocument = document, baseURL = document.baseURI, chain = []) {
      const href = original.getAttribute("href") || original.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href) return;
      const url = new URL(href, baseURL);
      if (!url.hash || chain.length >= 8 || chain.includes(url.href)) throw new Error("SVG 图标引用无效或层级过深。");
      const key = url.href;
      const id = decodeURIComponent(url.hash.slice(1));
      url.hash = "";
      const base = new URL(baseURL);
      base.hash = "";
      let spriteDocument = contextDocument;
      if (!href.startsWith("#") && url.href !== base.href) {
        if (!allowedProtocols.has(url.protocol)) throw new Error("不支持的 SVG 图标地址。");
        if (!spriteCache.has(url.href)) {
          spriteCache.set(url.href, (async () => {
            const response = await bounded(fetch(url.href, { credentials: "same-origin", signal }), signal, 10_000, "加载 SVG 图标超时。");
            if (!response.ok) throw new Error("无法读取 SVG 图标。");
            const text = await bounded(response.text(), signal, 10_000, "读取 SVG 图标超时。");
            if (text.length > 2_000_000) throw new Error("SVG 图集过大。");
            const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
            if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") throw new Error("SVG 图集格式无效。");
            return parsed;
          })());
        }
        try {
          spriteDocument = await spriteCache.get(url.href);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          throw new Error("无法嵌入 SVG 图标，请检查资源访问权限后重试。");
        }
      }
      assertActive(signal);
      const target = spriteDocument.getElementById(id);
      const ownerSVG = copy.ownerSVGElement;
      if (!target || !ownerSVG || target.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("未找到 SVG 图标定义。");
      if (target.matches("script,style,foreignObject,image") || target.querySelector("script,style,foreignObject,image")) throw new Error("这个 SVG 图标包含暂不支持的内容。");
      const definition = document.importNode(target, true);
      embedded += definition.querySelectorAll("*").length + 1;
      if (embedded > MAX_EMBEDDED_NODES) throw new Error("SVG 图标内容过多，请缩小选取范围。");
      for (const node of [definition, ...definition.querySelectorAll("*")]) {
        for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      }
      const definitionId = `ui-export-svg-${embedded}`;
      definition.setAttribute("id", definitionId);
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.append(definition);
      ownerSVG.append(defs);
      copy.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      copy.setAttribute("href", `#${definitionId}`);
      const nestedSources = [...(target.localName === "use" ? [target] : []), ...target.querySelectorAll("use")];
      const nestedCopies = [...(definition.localName === "use" ? [definition] : []), ...definition.querySelectorAll("use")];
      for (let i = 0; i < nestedSources.length; i++) {
        await inlineUse(nestedSources[i], nestedCopies[i], spriteDocument, url.href, [...chain, key]);
      }
    }

    async function inlineAsset(url) {
      if (url.startsWith("data:")) return url;
      const absolute = new URL(url, document.baseURI);
      if (!allowedProtocols.has(absolute.protocol)) throw new Error("组件包含暂不支持的图片地址。");
      if (!assetCache.has(absolute.href)) {
        assetCache.set(absolute.href, (async () => {
          try {
            const response = await bounded(fetch(absolute.href, { credentials: "same-origin", signal }), signal, 10_000, "加载图片超时。");
            if (!response.ok) throw new Error("HTTP error");
            const blob = await bounded(response.blob(), signal, 10_000, "读取图片超时。");
            if (!blob.type.startsWith("image/") || blob.size > 10_000_000) throw new Error("Unsupported image");
            return await bounded(blobAsDataURL(blob), signal, 10_000, "读取图片超时。");
          } catch (error) {
            if (error.name === "AbortError") throw error;
            throw new Error("无法嵌入组件中的图片（可能受跨域限制），请缩小范围后重试。");
          }
        })());
      }
      return assetCache.get(absolute.href);
    }

    for (let index = 0; index < originals.length; index++) {
      const original = originals[index];
      const copy = copies[index];
      for (const attribute of [...copy.attributes]) if (/^on/i.test(attribute.name)) copy.removeAttribute(attribute.name);
      if (original instanceof HTMLImageElement) {
        if (!original.complete || !original.naturalWidth) throw new Error("图片尚未加载完成，请稍后重试。");
        copy.src = await inlineAsset(original.currentSrc || original.src);
        copy.removeAttribute("srcset");
        copy.removeAttribute("sizes");
        copy.removeAttribute("loading");
      }
      if (original instanceof HTMLInputElement) {
        copy.setAttribute("value", original.value);
        copy.toggleAttribute("checked", original.checked);
      }
      if (original instanceof HTMLTextAreaElement) copy.textContent = original.value;
      if (original instanceof HTMLOptionElement) copy.toggleAttribute("selected", original.selected);
      if (original instanceof SVGElement && original.localName === "use") await inlineUse(original, copy);
      if (original instanceof SVGElement && original.localName === "image") {
        const href = original.getAttribute("href") || original.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (href) {
          copy.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
          copy.setAttribute("href", await inlineAsset(href));
        }
      }
      assertActive(signal);
      if (pace.due()) await pace.rest();
    }
    // The export can be opened as a document, where image-mode script limits no
    // longer apply, so active behaviour is stripped from the snapshot itself.
    for (const node of copies) {
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name) || ["autofocus", "action", "formaction"].includes(attribute.name)) node.removeAttribute(attribute.name);
      }
      if (node.localName === "a") {
        node.removeAttribute("href");
        node.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      }
      if (node.localName === "form") node.setAttribute("inert", "");
    }
    return { inlineAsset };
  }

  // ---- scene --------------------------------------------------------------

  async function buildScene({ source, clone, themed, map, pace, width, height, origin }) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let characters = 0;
    const relRect = node => {
      const box = node.getBoundingClientRect();
      return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
    };

    function sceneText(measured, copy, style, container) {
      const runs = [];
      const range = document.createRange();
      for (const part of segmenter.segment(measured.data)) {
        if (++characters > MAX_CHARACTERS) throw new Error("SVG 文字过多，请缩小范围或使用 PNG。");
        range.setStart(measured, part.index);
        range.setEnd(measured, part.index + part.segment.length);
        const box = range.getBoundingClientRect();
        // Collapsed white space and line breaks have no box; visible spaces do,
        // and are kept so the exported text stays readable and searchable.
        if (!box.width || !box.height) continue;
        runs.push({
          text: part.segment.trim() ? part.segment : " ", x: box.left - origin.left, baseline: box.bottom - origin.top,
          width: box.width, height: box.height
        });
      }
      if (!runs.some(run => run.text.trim())) return;
      container.push({ kind: "text", text: measured.data, node: measured, copy, style, runs });
    }

    function scenePseudo(which, measured, copy, container) {
      const style = getComputedStyle(measured, which);
      if (["none", "normal"].includes(style.content)) return;
      if (!['""', "''"].includes(style.content)) throw new Error("SVG 暂不支持伪元素文字，请使用 PNG。");
      if (!["absolute", "fixed"].includes(style.position)) return;
      const number = value => Number.parseFloat(value) || 0;
      const left = style.left === "auto" ? 0 : number(style.left);
      const top = style.top === "auto" ? 0 : number(style.top);
      const boxWidth = style.width === "auto" ? measured.clientWidth - left - number(style.right) : number(style.width);
      const boxHeight = style.height === "auto" ? measured.clientHeight - top - number(style.bottom) : number(style.height);
      container.push({
        kind: "pseudo", which, node: measured, copy,
        rect: {
          x: measured.getBoundingClientRect().left - origin.left + measured.clientLeft + left,
          y: measured.getBoundingClientRect().top - origin.top + measured.clientTop + top,
          width: boxWidth, height: boxHeight
        },
        style: styleRecord(style, map), children: []
      });
    }

    async function walk(measured, copy, container) {
      if (pace.due()) await pace.rest();
      const measuredChildren = [...measured.childNodes];
      const copyChildren = [...copy.childNodes];
      for (let index = 0; index < measuredChildren.length; index++) {
        const child = measuredChildren[index];
        const childCopy = copyChildren[index] || child;
        if (child.nodeType === Node.TEXT_NODE) {
          // Text takes the style of the element that holds it, which was read on the way down.
          if (child.data.trim()) sceneText(child, childCopy, container.style, container.children);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const style = getComputedStyle(child);
        if (SKIP_TAGS.has(child.localName) || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) continue;
        const record = {
          kind: "element", tag: child.localName, node: child, copy: childCopy,
          rect: relRect(child), style: styleRecord(style, map), children: []
        };
        container.children.push(record);
        if (child instanceof SVGSVGElement) {
          record.kind = "icon";
          continue;
        }
        const box = child.getBoundingClientRect();
        if (!box.width || !box.height) {
          await walk(child, childCopy, record);
          continue;
        }
        if (child instanceof HTMLImageElement) {
          record.media = "image";
        } else if (child instanceof HTMLInputElement) {
          if (!["checkbox", "radio"].includes(child.type)) throw new Error("SVG 暂不支持这个输入控件，请使用 PNG。");
          record.media = "control";
          record.checked = child.checked;
          record.control = child.type;
        } else if (child instanceof HTMLSelectElement || child instanceof HTMLTextAreaElement) {
          throw new Error("SVG 暂不支持这个表单控件，请使用 PNG。");
        } else {
          record.clip = [record.style["overflow-x"], record.style["overflow-y"]]
            .some(value => ["hidden", "clip", "scroll", "auto"].includes(value));
          scenePseudo("::before", child, childCopy, record.children);
          await walk(child, childCopy, record);
          scenePseudo("::after", child, childCopy, record.children);
        }
      }
    }

    // A forced theme is measured on the in-page clone; otherwise the live
    // component is measured and the detached clone only supplies embedded assets.
    const measuredRoot = themed ? clone : source;
    const rootStyle = styleRecord(getComputedStyle(measuredRoot), map);
    // The staged clone is hidden with opacity 0; the export uses the source's.
    if (themed) rootStyle.opacity = getComputedStyle(source).opacity;
    const root = {
      kind: "element", tag: source.localName, node: source, copy: clone, clip: false,
      rect: { x: 0, y: 0, width: origin.width, height: origin.height }, style: rootStyle, children: []
    };
    root.clip = [rootStyle["overflow-x"], rootStyle["overflow-y"]].some(value => ["hidden", "clip", "scroll", "auto"].includes(value));
    scenePseudo("::before", measuredRoot, clone, root.children);
    await walk(measuredRoot, clone, root);
    scenePseudo("::after", measuredRoot, clone, root.children);
    return { root, width, height, themed };
  }

  // ---- styles -------------------------------------------------------------

  // Logical properties repeat their physical counterparts.
  const LOGICAL = /(^|-)(block|inline)(-|$)|-(start|end)-(start|end)-radius$/;
  // Resolved values that follow each box's own size or position. They stay on
  // the element; everything else is shared between elements that match.
  const OWN = new Set([
    "width", "height", "top", "right", "bottom", "left", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "transform-origin", "perspective-origin"
  ]);
  const FROZEN = "animation:none!important;transition:none!important;";
  const URLS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;
  let propertyNames = null;
  // Enumerating a computed style is several times slower than reading it by
  // name, and every element lists the same properties, so the list is made once.
  function properties() {
    propertyNames ||= [...getComputedStyle(document.documentElement)]
      .filter(name => !name.startsWith("--") && !name.startsWith("animation") && !name.startsWith("transition") && !LOGICAL.test(name));
    return propertyNames;
  }

  // Freezes the clone's resolved styles and returns the style sheet that goes
  // with it into the PNG.
  async function exportStyles({ originals, copies, map, styleAt, inlineAsset, rootChrome, width, height, pace, vector }) {
    const names = properties();
    // Local SVG fragment references are preserved; other assets are embedded.
    const embed = async value => {
      for (const match of [...value.matchAll(URLS)]) {
        const url = (match[1] ?? match[2] ?? match[3]).trim();
        if (!url.startsWith("#")) value = value.replace(match[0], `url("${await inlineAsset(url)}")`);
      }
      return value;
    };
    const declarationsOf = async style => {
      let shared = "";
      let own = "";
      for (const property of names) {
        let value = style.getPropertyValue(property);
        if (value.includes("url(")) value = await embed(value);
        if (map) value = map(property, value);
        if (OWN.has(property)) own += `${property}:${value};`;
        else shared += `${property}:${value};`;
      }
      return { shared, own };
    };
    // Every resolved style is read before any is written: freezing a parent
    // first would change what its descendants resolve to.
    const styles = new Array(copies.length);
    const pseudoRules = [];
    for (let index = 0; index < copies.length; index++) {
      if (pace.due()) await pace.rest();
      // The SVG renderer measures the page itself and reads resolved styles only from inline icons.
      if (vector && !(originals[index] instanceof SVGElement)) continue;
      styles[index] = await declarationsOf(styleAt(index));
      if (vector) continue;
      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyle = styleAt(index, pseudo);
        if (["none", "normal"].includes(pseudoStyle.content)) continue;
        const { shared, own } = await declarationsOf(pseudoStyle);
        pseudoRules.push(`[data-ui-export-node="${index}"]${pseudo}{${shared}${own}${FROZEN}}`);
      }
    }
    const root = copies[0];
    root.remove();
    for (const name of ["inert", "aria-hidden", "data-ui-export-staged"]) root.removeAttribute(name);
    if (vector) {
      copies.forEach((copy, index) => { if (styles[index]) copy.setAttribute("style", styles[index].shared + styles[index].own); });
      return "";
    }
    // Table cells, list rows and the like resolve to the same style many times
    // over. Writing each distinct style once leaves the browser a fraction of
    // the markup to parse that it had with every style inline.
    const sheet = new Map();
    for (let index = 0; index < copies.length; index++) {
      const { shared, own } = styles[index];
      let id = sheet.get(shared);
      if (id === undefined) sheet.set(shared, id = sheet.size);
      copies[index].setAttribute("style", own);
      copies[index].setAttribute("data-ui-export-style", String(id));
      copies[index].setAttribute("data-ui-export-node", String(index));
    }
    // Match the source's border box, without its parent layout or outer margins.
    // Both sizes are given, since the frozen ones may be those of the content box.
    Object.assign(root.style, {
      margin: "0", position: rootChrome.position === "static" ? "relative" : rootChrome.position, inset: "auto",
      transform: rootChrome.transform, opacity: rootChrome.opacity, zIndex: rootChrome.zIndex,
      pointerEvents: "auto", boxSizing: "border-box", width: `${width}px`, height: `${height}px`
    });
    return [...sheet].map(([text, id]) => `[data-ui-export-style="${id}"]{${text}${FROZEN}caret-color:transparent!important;}`).concat(pseudoRules).join("\n");
  }

  /**
   * The distinct colours of a component as a colour mode shows them, most used
   * first. Replacement colours are keyed by these.
   */
  function colors(source, theme) {
    const Theme = globalThis.__chatgptUIExportTheme;
    const config = { ...Theme.normalize(theme), palette: {}, font: "", radius: 1 };
    const originals = [source, ...source.querySelectorAll("*")];
    if (originals.length > MAX_NODES) throw new Error("选取内容过多，请缩小选取范围。");
    if (config.mode === "page") return Theme.collectColors(originals, node => getComputedStyle(node));
    const clone = source.cloneNode(true);
    const copies = [clone, ...clone.querySelectorAll("*")];
    try {
      stage(source, clone, copies, config, source.getBoundingClientRect());
      return Theme.collectColors(copies, node => getComputedStyle(node));
    } finally {
      clone.remove();
    }
  }

  globalThis.__chatgptUIExportCapture = Object.freeze({ version: VERSION, build, colors, STYLE_PROPERTIES });
})();
