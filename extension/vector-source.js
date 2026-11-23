(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__pockettaVectorSource?.version === VERSION) return;
  const NS = "http://www.w3.org/2000/svg";
  const tags = new Set("svg g defs symbol use path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath title desc text tspan".split(" "));
  const geometry = "id viewBox preserveAspectRatio d x y dx dy x1 x2 y1 y2 cx cy r rx ry fx fy width height points transform gradientTransform gradientUnits spreadMethod offset clipPathUnits";
  const paint = "color fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity display visibility clip-path clip-rule stop-color stop-opacity font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing";
  const presentation = paint.split(" ");
  const attributes = new Set((geometry + " " + paint).split(" "));
  const reject = reason => { throw new Error(reason + "，请使用 PNG。"); };
  const make = name => document.createElementNS(NS, name);

  // This renderer accepts only static SVG primitives. Build a new tree before
  // measuring it in the document, including for SVGs supplied as image data.
  function fromImage(data) {
    if (!/^data:image\/svg\+xml[;,]/i.test(data)) reject("选区包含位图，无法导出纯矢量 SVG");
    const start = data.indexOf(",");
    const payload = data.slice(start + 1);
    let xml;
    try {
      xml = /;base64$/i.test(data.slice(0, start))
        ? new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)))
        : decodeURIComponent(payload);
    } catch {
      reject("SVG 图片编码无效");
    }
    if (xml.length > 10_000_000) reject("SVG 图片过大");
    const doc = new DOMParser().parseFromString(xml, "image/svg+xml");
    if (doc.doctype || doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") reject("SVG 图片格式不受支持");
    return doc.documentElement;
  }

  function labelText(fo) {
    const label = fo.firstElementChild;
    if (!label || fo.children.length !== 1 || label.children.length || !label.isConnected) reject("图表含复杂 HTML 标签");
    const range = document.createRange();
    range.selectNodeContents(label);
    const boxes = range.getClientRects();
    if (boxes.length !== 1) reject("图表含多行 HTML 标签");
    const style = getComputedStyle(label);
    const metrics = document.createElement("canvas").getContext("2d");
    metrics.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
    const ink = metrics.measureText(label.textContent);
    const baseline = boxes[0].top + (boxes[0].height + ink.fontBoundingBoxAscent - ink.fontBoundingBoxDescent) / 2;
    const p = new DOMPoint(boxes[0].left, baseline).matrixTransform(fo.parentElement.getScreenCTM().inverse());
    const text = make("text");
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y);
    text.setAttribute("text-anchor", "start");
    text.setAttribute("fill", style.color);
    for (const key of ["font-family","font-size","font-weight","font-style","letter-spacing"]) text.setAttribute(key, style.getPropertyValue(key));
    text.textContent = label.textContent;
    return text;
  }

  function read(source, copy, nextId) {
    const ids = new Map();
    const refs = [];
    let count = 0;
    function visit(node, live) {
      const tag = node.localName;
      if (++count > 16000) reject("SVG 节点过多");
      if (["script","set","animate","animateMotion","animateTransform"].includes(tag)) return null;
      if (tag === "foreignObject") return labelText(live || node);
      if (node.namespaceURI !== NS || !tags.has(tag)) reject("SVG 中包含不支持的元素 " + tag);
      const out = make(tag);
      const style = live?.isConnected ? getComputedStyle(live) : node.style;
      if (!live && [...node.style].some(key => !attributes.has(key))) reject("源图包含不支持的内联样式");
      function set(key, value) {
        if (key === "id") {
          if (ids.has(value)) reject("SVG 含重复标识");
          ids.set(value, nextId("ui-vector"));
          out.id = ids.get(value);
          return;
        }
        // Only local paint servers, clipping paths and symbol references.
        if (/url\s*\(/i.test(value) || key === "href") {
          let target = key === "href" ? value : /^url\(\s*["']?([^"'()]+)["']?\s*\)$/i.exec(value)?.[1];
          if (live && target?.startsWith(document.URL.split("#")[0] + "#")) target = target.slice(target.indexOf("#"));
          if (!target?.startsWith("#")) reject("SVG 依赖外部资源");
          refs.push([out,key,target.slice(1)]);
        } else {
          if (/[\\]|\/\*|(?:var|image-set|image)\s*\(/i.test(value)) reject("SVG 样式无法独立保存");
          out.setAttribute(key,value);
        }
      }
      for (const attr of node.attributes) {
        if (presentation.includes(attr.name) && style?.getPropertyValue(attr.name)) continue;
        if (attributes.has(attr.name) || attr.localName === "href") set(attr.localName,attr.value);
      }
      for (const key of presentation) {
        const value = style?.getPropertyValue(key);
        if (value) set(key,value);
      }
      if ((style.filter && style.filter !== "none") || (style.maskImage && style.maskImage !== "none")
          || node.hasAttribute("filter") || node.hasAttribute("mask")) reject("SVG 包含滤镜或蒙版");
      for (const key of node.style) {
        if (attributes.has(key) && !presentation.includes(key)) set(key, node.style.getPropertyValue(key));
      }
      let i = 0;
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const result = visit(child, live?.children[i++]);
          if (result) out.append(result);
        } else if (child.nodeType === Node.TEXT_NODE && ["text","tspan","title","desc"].includes(tag)) out.append(child.data);
      }
      return out;
    }
    const svg = visit(copy,source);
    for (const [node,key,target] of refs) {
      if (!ids.has(target)) reject("SVG 缺少引用定义");
      node.setAttribute(key,key === "href" ? "#" + ids.get(target) : "url(#" + ids.get(target) + ")");
    }
    return svg;
  }

  // SVG's character positions already include anchoring, tspan offsets and
  // browser shaping. Trace glyphs where the layout engine placed them.
  function outline(svg) {
    if (!svg.querySelector("text")) return;
    const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;left:-100000px;top:0;pointer-events:none;opacity:0";
    host.attachShadow({mode:"closed"}).append(svg);
    document.documentElement.append(host);
    try {
      for (const text of svg.querySelectorAll("text")) {
        const group = make("g");
        for (const attr of text.attributes) group.setAttribute(attr.name,attr.value);
        const walker = document.createTreeWalker(text,NodeFilter.SHOW_TEXT);
        let index = 0;
        const total = text.getNumberOfChars();
        for (let run = walker.nextNode(); run; run = walker.nextNode()) {
          const css = getComputedStyle(run.parentElement);
          const style = Object.fromEntries(presentation.map(key=>[key,css.getPropertyValue(key)]));
          for (const { segment } of segments.segment(run.data)) {
            if (index >= total) reject("部分 SVG 文字无法可靠转曲，可选择可编辑文字");
            const p = text.getStartPositionOfChar(index);
            const rotation = text.getRotationOfChar(index);
            index += segment.length;
            if (!segment.trim()) continue;
            const glyph = globalThis.__chatgptUIExportOutline.glyph(style,segment);
            if (glyph.empty) reject("字形无法可靠转曲，可选择可编辑文字");
            const path = make("path");
            path.setAttribute("d",glyph.d);
            path.setAttribute("transform","translate("+p.x+" "+p.y+") rotate("+rotation+")");
            for (const key of ["fill","fill-opacity","stroke","stroke-width","stroke-opacity"]) path.setAttribute(key,style[key]);
            group.append(path);
          }
        }
        if (index !== total) reject("SVG 文字排版无法可靠转曲，可选择可编辑文字");
        text.replaceWith(group);
      }
    } finally {
      svg.remove();
      host.remove();
    }
  }
  globalThis.__pockettaVectorSource = Object.freeze({version:VERSION,fromImage,read,outline});
})();
