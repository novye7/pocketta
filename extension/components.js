(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__chatgptUIExportComponents?.version === VERSION) return;

  // ChatGPT renders an intelligent UI response as one tree of typed nodes
  // (`data-d-component`). Paragraphs, headings, lists and quotes are nodes of
  // that same tree, so this module decides what counts as a UI component:
  // everything that is not prose, an inline part, or a piece of a table.
  const ROOT = "[data-dil-message-id]";
  const NODES = "[data-d-component], table";
  const PROSE_TYPES = new Set([
    "text", "title", "caption", "blockquote", "list", "list-item", "divider", "math", "code", "icon",
    "popover-trigger", "link", "table-row", "table-cell"
  ]);
  const PROSE_TAGS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "pre", "code", "span", "a",
    "svg", "img", "tr", "td", "th", "thead", "tbody", "tfoot"
  ]);
  const NAMES = { svg: "矢量图", chart: "图表", box: "卡片", card: "卡片", table: "表格", row: "行", grid: "网格", "grid-item": "网格项" };
  const MIN_WIDTH = 48;
  const MIN_HEIGHT = 24;

  const typeOf = node => node.localName === "table" ? "table" : node.getAttribute("data-d-component");

  function isComponent(node) {
    if (!(node instanceof HTMLElement)) return false;
    const type = node.getAttribute("data-d-component");
    // A table component is a full-bleed scrolling frame; the table inside it is
    // the part worth exporting, so the table element stands for the component.
    if (node.localName === "table") {
      return !type && node.parentElement?.closest("[data-d-component]")?.getAttribute("data-d-component") === "table";
    }
    if (node instanceof HTMLImageElement && type === "svg") return true;
    if (!type || PROSE_TYPES.has(type) || PROSE_TAGS.has(node.localName)) return false;
    if (node.hasAttribute("data-d-text-flow") || node.hasAttribute("data-d-inline")) return false;
    if (type === "table") return !node.querySelector("table");
    return true;
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT;
  }

  function sameBox(a, b) {
    if (a instanceof HTMLImageElement || b instanceof HTMLImageElement) return false;
    const first = a.getBoundingClientRect();
    const second = b.getBoundingClientRect();
    return Math.abs(first.left - second.left) < 2 && Math.abs(first.top - second.top) < 2 &&
      Math.abs(first.right - second.right) < 2 && Math.abs(first.bottom - second.bottom) < 2;
  }

  // The component that directly contains a node, if any.
  function parent(node) {
    const root = node.closest(ROOT);
    for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
      if (isComponent(current)) return current;
    }
    return null;
  }

  // The components directly inside a component, or inside a response root.
  function children(scope) {
    const owner = scope.matches(ROOT) ? null : scope;
    return [...scope.querySelectorAll(NODES)].filter(node => isComponent(node) && parent(node) === owner);
  }

  // A wrapper that covers the same box as its content is one level, not two:
  // the outermost element stands for it, because it carries the border.
  function canonical(node) {
    for (let up = parent(node); up && sameBox(up, node); up = parent(up)) node = up;
    return node;
  }

  /** The components under a node, innermost first. Empty over prose. */
  function ladder(target) {
    if (!(target instanceof Element)) return [];
    const root = target.closest(ROOT);
    if (!root) return [];
    const levels = [];
    for (let node = target; node && node !== root; node = node.parentElement) {
      if (!isComponent(node) || !isVisible(node)) continue;
      const level = canonical(node);
      if (!levels.includes(level)) levels.push(level);
    }
    return levels;
  }

  /** The whole component under a node. */
  const top = target => ladder(target).at(-1) || null;

  /** The next larger component around one. */
  function outer(node) {
    for (let up = parent(node); up; up = parent(up)) {
      if (isVisible(up) && !sameBox(up, node)) return canonical(up);
    }
    return null;
  }

  /** The next smaller components inside one, in document order. */
  function inner(node) {
    const result = [];
    for (const child of children(node)) {
      if (!isVisible(child)) continue;
      if (sameBox(child, node)) result.push(...inner(child));
      else result.push(child);
    }
    return result;
  }

  /** Every whole component that is currently in the document, in order. */
  function all() {
    const result = [];
    for (const root of document.querySelectorAll(ROOT)) {
      for (const node of children(root)) if (isVisible(node)) result.push(node);
    }
    return result;
  }

  // ChatGPT unmounts turns that scroll far away and may re-render a reply, so a
  // selection is also remembered by where it sits in its response.
  function keyOf(node) {
    const root = node.closest(ROOT);
    if (!root) return null;
    const path = [];
    for (let current = node; current; current = parent(current)) {
      path.unshift(children(parent(current) || root).indexOf(current));
    }
    return { message: root.getAttribute("data-dil-message-id"), path };
  }

  function resolve(key) {
    if (!key?.message) return null;
    let node = document.querySelector(`[data-dil-message-id="${CSS.escape(key.message)}"]`);
    for (const index of key.path) node = node && children(node)[index];
    return node && isComponent(node) ? node : null;
  }

  const label = node => NAMES[typeOf(node)] || "组件";

  /** The first line of text in a component, for naming the exported file. */
  function title(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.data.trim()) continue;
      const block = text.parentElement.closest("[data-d-text-flow], th, td") || text.parentElement;
      return (node.contains(block) ? block.textContent : text.data).replace(/\s+/g, " ").trim().slice(0, 48);
    }
    return "";
  }

  globalThis.__chatgptUIExportComponents = Object.freeze({
    version: VERSION, ROOT, isComponent, isVisible, ladder, top, outer, inner, all, keyOf, resolve, label, title
  });
})();
