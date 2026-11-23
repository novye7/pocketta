(() => {
  "use strict";
  const VERSION = "0.1.0";
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

  const styleRecord = style => {
    const record = {};
    for (const property of STYLE_PROPERTIES) record[property] = style.getPropertyValue(property);
    return record;
  };

  /**
   * Clones the component and embeds its assets. The live DOM is measured and the
   * page is never mutated. Without `scene` the clone is fully styled for the PNG
   * renderer. With `scene: true` the SVG renderer reads the live scene and embedded assets.
   */
  async function build(source, { signal, scene: wantScene = true } = {}) {
    assertActive(signal);
    const Color = globalThis.__chatgptUIExportColor;
    if (!Color) throw new Error("请重新加载扩展后重试。");
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

    const pace = pacer(signal);
    const styleAt = (index, pseudo = null) => getComputedStyle(originals[index], pseudo);
    const { inlineAsset } = await embedAssets({ originals, copies, signal, pace });
    assertActive(signal);
    // Only the SVG renderer reads the scene, so its limits must not stop a PNG.
    const scene = wantScene ? await buildScene({ source, clone, pace, origin: rect, width, height }) : null;
    assertActive(signal);
    const rules = wantScene ? "" : await exportStyles({ copies, styleAt, inlineAsset, rootChrome, width: rect.width, height: rect.height, pace });
    return { scene, clone, rules, width, height, ambient: Color.ambientBackground(source) };
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

  async function buildScene({ source, clone, pace, width, height, origin }) {
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
        style: styleRecord(style), children: []
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
          rect: relRect(child), style: styleRecord(style), children: []
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

    // The live component is measured; the detached clone only supplies embedded assets.
    const rootStyle = styleRecord(getComputedStyle(source));
    const root = {
      kind: "element", tag: source.localName, node: source, copy: clone, clip: false,
      rect: { x: 0, y: 0, width: origin.width, height: origin.height }, style: rootStyle, children: []
    };
    if (source instanceof HTMLImageElement) root.media = "image";
    root.clip = [rootStyle["overflow-x"], rootStyle["overflow-y"]].some(value => ["hidden", "clip", "scroll", "auto"].includes(value));
    scenePseudo("::before", source, clone, root.children);
    await walk(source, clone, root);
    scenePseudo("::after", source, clone, root.children);
    return { root, width, height };
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
  async function exportStyles({ copies, styleAt, inlineAsset, rootChrome, width, height, pace }) {
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
      styles[index] = await declarationsOf(styleAt(index));
      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyle = styleAt(index, pseudo);
        if (["none", "normal"].includes(pseudoStyle.content)) continue;
        const { shared, own } = await declarationsOf(pseudoStyle);
        pseudoRules.push(`[data-ui-export-node="${index}"]${pseudo}{${shared}${own}${FROZEN}}`);
      }
    }
    const root = copies[0];
    root.remove();
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

  globalThis.__chatgptUIExportCapture = Object.freeze({ version: VERSION, build, STYLE_PROPERTIES });
})();
