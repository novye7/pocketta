// Checks component detection, the hover button and the picker against a
// fixture that imitates ChatGPT's markup, including turns that are only in the
// document while they are near the window.
//
// Evaluate on a chatgpt.com document without a conversation, after every
// extension script except background.js (components, hover, color, capture,
// outline, native-svg, raster, exporter, picker). Returns the passed checks.
(async () => {
  const checks = [];
  const assert = (value, message) => {
    if (!value) throw new Error(`Failed: ${message}`);
    checks.push(message);
  };
  const C = globalThis.__chatgptUIExportComponents;
  const picker = globalThis.__chatgptUIExportPicker;
  if (!C || !picker || !globalThis.__chatgptUIExportHover) throw new Error("Load the extension scripts first.");
  if (document.querySelector(C.ROOT)) throw new Error("Run on a page without intelligent UI responses.");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const until = async (test, message, ms = 6000) => {
    const end = performance.now() + ms;
    for (;;) {
      const value = test();
      if (value) return value;
      if (performance.now() > end) throw new Error(`Timed out: ${message}`);
      await frame();
    }
  };

  // ---- stand-ins for what a plain page lacks --------------------------------
  const downloads = [];
  const clipboard = [];
  const original = {
    chrome: globalThis.chrome, click: HTMLAnchorElement.prototype.click,
    write: navigator.clipboard?.write, writeText: navigator.clipboard?.writeText
  };
  globalThis.chrome = { ...(globalThis.chrome || {}), runtime: { ...(globalThis.chrome?.runtime || {}), id: "test", sendMessage: async () => true } };
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, href: this.href }); };
  if (navigator.clipboard) {
    navigator.clipboard.write = async items => { clipboard.push({ types: items.flatMap(item => item.types) }); };
    navigator.clipboard.writeText = async text => { clipboard.push({ text }); };
  }

  // ---- fixture ---------------------------------------------------------------
  const prose = (content, lines = 1) => `<p data-d-component="text" data-d-text-flow style="margin:0 0 12px;min-height:${lines * 24}px;">${content}</p>`;
  const label = content => `<span data-d-component="text" data-d-text-flow style="display:block;">${content}</span>`;
  const card = (id, title, parts, extra = "") => `<div id="${id}" data-d-component="box" data-d-direction="col" data-d-has-border style="margin:0 0 16px;padding:12px;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff;">
    ${label(`<b>${title}</b>`)}${parts.map((part, index) => `<div id="${id}-${index}" data-d-component="box" data-d-direction="col" style="margin-top:8px;padding:10px;border-radius:8px;background:rgb(238,244,238);">${label(part)}</div>`).join("")}${extra}</div>`;
  const cell = (tag, content) => `<${tag} data-d-component="table-cell" style="padding:6px 12px 6px 0;border-bottom:1px solid #ccc;text-align:left;">${label(content)}</${tag}>`;
  const table = id => `<div data-d-component="table" style="display:flex;margin:0 -40px 16px;"><div data-d-table-viewport="true" style="flex:1;overflow:auto;padding-left:40px;">
    <table id="${id}" style="width:520px;border-collapse:collapse;"><tbody>
      <tr data-d-component="table-row">${cell("th", "概念")}${cell("th", "说明")}</tr>
      <tr data-d-component="table-row">${cell("td", "Run")}${cell("td", "一次完整的执行")}</tr>
    </tbody></table></div></div>`;
  const turns = [
    prose("第一段正文。") + `<h2 data-d-component="title" data-d-text-flow style="margin:0 0 12px;font-size:18px;">小标题</h2>` + card("fx-a", "卡片 A", ["第一步", "第二步"]) +
      prose("两个组件之间的正文。") + table("fx-b") +
      `<ul data-d-component="list" style="margin:0 0 12px;"><li data-d-component="list-item">${label("列表项")}</li></ul>` +
      `<blockquote data-d-component="blockquote" style="margin:0 0 12px;">${prose("引用")}</blockquote><div data-d-component="divider" style="height:17px;"></div>`,
    prose("只有正文的一轮回复。", 100),
    // A wrapper that covers exactly the same box as the card inside it, and a part SVG cannot draw.
    prose("另一轮回复。") + `<div id="fx-c" data-d-component="box" data-d-direction="col" style="margin:0 0 16px;">${card("fx-c-inner", "卡片 C", ["甲", "乙"], '<div id="fx-rotated" style="width:40px;height:12px;margin-top:8px;background:rgb(0,0,200);transform:rotate(3deg);"></div>').replace("margin:0 0 16px;", "margin:0;")}</div>` +
      `<div id="fx-d" data-d-component="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 16px;">${["左", "右"].map((item, index) => `<div id="fx-d-${index}" data-d-component="grid-item" style="padding:12px;border:1px solid rgba(0,0,0,.15);border-radius:8px;">${label(item)}</div>`).join("")}</div>`,
    prose("最后一轮，也只有正文。", 100)
  ];
  const host = document.createElement("div");
  host.id = "ui-export-picker-fixture";
  host.style.cssText = "position:fixed;left:0;top:0;width:900px;height:700px;z-index:1000;background:#fff;color:#111;font:16px/24px system-ui,sans-serif;";
  host.innerHTML = `<div id="fx-scroller" style="height:100%;overflow-y:auto;padding:0 60px;box-sizing:border-box;">
    <div style="height:140px;"></div>${turns.map((html, index) => `<div class="fx-turn"><div data-dil-message-id="fixture-${index}" data-d-direction="col">${html}</div></div>`).join("")}</div>`;
  document.documentElement.append(host);
  const scroller = host.querySelector("#fx-scroller");
  // Like ChatGPT, keep a turn in the document only while it is within a screen of the window.
  const slots = [...host.querySelectorAll(".fx-turn")].map((node, index) => {
    node.style.height = `${node.offsetHeight}px`;
    return { node, html: node.innerHTML, mounted: true, index };
  });
  const virtualize = () => {
    const view = scroller.getBoundingClientRect();
    for (const slot of slots) {
      const rect = slot.node.getBoundingClientRect();
      const near = rect.bottom > view.top - view.height && rect.top < view.bottom + view.height;
      if (near === slot.mounted) continue;
      slot.node.innerHTML = near ? slot.html : "";
      slot.mounted = near;
    }
  };
  scroller.addEventListener("scroll", () => requestAnimationFrame(virtualize));
  virtualize();
  const $ = id => host.querySelector(`#${id}`);

  // ---- helpers ---------------------------------------------------------------
  const at = node => { const rect = node.getBoundingClientRect(); return { clientX: rect.left + Math.min(rect.width / 2, 40), clientY: rect.top + Math.min(rect.height / 2, 14) }; };
  const move = node => node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, ...at(node) }));
  const click = node => {
    const prevented = {};
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const event = new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...at(node) });
      node.dispatchEvent(event);
      prevented[type] = event.defaultPrevented;
    }
    return prevented;
  };
  const key = (name, init = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, composed: true, ...init });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const ui = id => [...document.querySelectorAll("#pocketta")].at(-1)?.shadowRoot.getElementById(id);
  const chip = () => document.getElementById("pocketta-hover")?.shadowRoot.querySelector("button");
  const around = (element, node, gap) => {
    if (!element?.hasAttribute("data-on") || !node?.isConnected) return false;
    const a = element.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    return Math.abs(a.left + gap - b.left) < 1 && Math.abs(a.top + gap - b.top) < 1 && Math.abs(a.width - gap * 2 - b.width) < 1 && Math.abs(a.height - gap * 2 - b.height) < 1;
  };
  const selected = id => () => around(ui("frame"), $(id), 3);
  const notice = () => ui("notice")?.hasAttribute("data-open") ? ui("notice-text").textContent : "";
  const format = () => ui("format").querySelector('[aria-checked="true"]').dataset.value;
  const exported = async (button, count) => {
    await until(() => downloads.length + clipboard.length === count && !ui(button).disabled, `export ${count} finishes`, 15000);
  };

  try {
    // The picker opens when its script loads; start from a closed one.
    picker.close();
    await wait(250);

    // ---- what counts as a component -----------------------------------------
    assert(C.all().map(node => node.id).join() === "fx-a,fx-b", "Cards and tables are components; the table element stands for its scrolling frame");
    assert([...host.querySelectorAll("p, h2, li, blockquote, [data-d-component=divider]")].every(node => node.closest("#fx-a, #fx-b") || !C.top(node)), "Paragraphs, headings, lists, quotes and dividers are not components");
    assert(C.top($("fx-b").querySelector("td span")) === $("fx-b") && C.ladder($("fx-a-1").firstElementChild).map(node => node.id).join() === "fx-a-1,fx-a", "A node resolves to its part first, then to the whole component");
    assert(C.inner($("fx-a")).map(node => node.id).join() === "fx-a-0,fx-a-1" && C.outer($("fx-a-0")) === $("fx-a") && C.outer($("fx-a")) === null, "Parts and wholes are linked in both directions");
    assert(C.resolve(C.keyOf($("fx-a-1"))) === $("fx-a-1") && C.title($("fx-a")) === "卡片 A" && C.label($("fx-b")) === "表格", "Components can be found again, named and described");

    // ---- hover button --------------------------------------------------------
    move(host.querySelector("p"));
    await wait(300);
    assert(!chip()?.hasAttribute("data-on"), "No export button over prose");
    move($("fx-a-0").firstElementChild);
    await until(() => chip()?.hasAttribute("data-on"), "export button appears");
    const corner = chip().getBoundingClientRect();
    const box = $("fx-a").getBoundingClientRect();
    assert(Math.abs(box.right - corner.right - 8) < 1 && Math.abs(corner.top - box.top - 8) < 1, "The button sits in the corner of the whole component, not of the part under the pointer");
    move(document.body);
    await until(() => !chip().hasAttribute("data-on"), "export button leaves");
    move($("fx-a").firstElementChild);
    await until(() => chip().hasAttribute("data-on"), "export button returns");
    chip().click();
    await until(selected("fx-a"), "picker opens on the hovered component");
    assert(picker.active && !chip().hasAttribute("data-on") && document.activeElement?.id === "pocketta", "The button opens the picker on that component and gets out of the way");
    const bar = ui("bar").getBoundingClientRect();
    assert(bar.top >= 0 && bar.left >= 0 && bar.right <= innerWidth && bar.bottom <= $("fx-a").getBoundingClientRect().top, "The bar sits above the selection, inside the window");
    assert(getComputedStyle(ui("frame")).boxShadow.match(/[\d.]+px/g).every(length => Number.parseFloat(length) <= 6), "The selection is outlined without dimming the rest of the page");

    // ---- pointer -------------------------------------------------------------
    let reached = 0;
    const spy = () => { reached++; };
    // The fixture lives under <html>, like the overlay, rather than in <body>.
    document.addEventListener("click", spy);
    document.addEventListener("pointerdown", spy);
    move($("fx-b").querySelector("td span"));
    await until(() => around(ui("ring"), $("fx-b"), 3), "hover ring follows the pointer");
    await wait(200);
    assert(!chip().hasAttribute("data-on"), "The hover button stays away while the picker is open");
    const swallowed = click($("fx-b").querySelector("td span"));
    await until(selected("fx-b"), "click selects another component");
    assert(reached === 0 && swallowed.click && swallowed.pointerdown, "Clicks on a component never reach the page");
    click($("fx-a-1").firstElementChild);
    await until(selected("fx-a"), "click selects the whole component first");
    click($("fx-a-1").firstElementChild);
    await until(selected("fx-a-1"), "a second click goes one level in");
    click($("fx-a-0").firstElementChild);
    await until(selected("fx-a-0"), "a click on a sibling part moves across");
    click($("fx-a-0").firstElementChild);
    await until(selected("fx-a"), "a click on the selected part goes back out");
    checks.push("Clicking drills into a component and back out");

    // ---- keyboard ------------------------------------------------------------
    assert(key("ArrowRight") && await until(selected("fx-a-0"), "→ enters"), "→ enters the component");
    key("ArrowDown");
    await until(selected("fx-a-1"), "↓ moves to the next part");
    key("ArrowDown");
    await until(selected("fx-b"), "↓ after the last part");
    checks.push("↓ walks through the parts, then on to the next component");
    key("ArrowUp");
    await until(selected("fx-a"), "↑ moves back");
    key("j");
    await until(selected("fx-b"), "j moves on");
    key("k");
    await until(selected("fx-a"), "k moves back");
    key("ArrowLeft");
    await until(() => notice().includes("范围"), "← at the outermost level");
    checks.push("↑ ↓ j k move between components; ← at the outermost level says so");
    assert(key("s") && format() === "svg" && key("p") && format() === "png", "s and p switch the format");
    assert(!key("a") && !key("r", { metaKey: true }) && picker.active, "Keys the picker does not use are left to the page");

    // ---- export --------------------------------------------------------------
    key("Enter");
    await exported("download", 1);
    const png = await (await fetch(downloads[0].href)).blob();
    assert(downloads[0].name === "卡片 A.png" && png.type === "image/png" && png.size > 500 && ui("download").textContent.includes("已下载"), "↵ downloads a PNG named after the component");
    key("s");
    ui("download").click();
    await exported("download", 2);
    const svg = await (await fetch(downloads[1].href)).text();
    assert(downloads[1].name === "卡片 A.svg" && svg.startsWith("<?xml") && svg.includes("<text"), "SVG downloads as a vector file with live text");
    key("c", { metaKey: true });
    await exported("copy", 3);
    assert(clipboard[0].text?.startsWith("<?xml") && ui("copy").textContent.includes("已复制"), "Copying SVG puts its code on the clipboard");
    key("p");
    key("c");
    await exported("copy", 4);
    assert(clipboard[1].types?.join() === "image/png", "Copying PNG puts an image on the clipboard");

    // ---- options -------------------------------------------------------------
    const rowTop = () => Math.round(ui("bar").querySelector(".row").getBoundingClientRect().top);
    const before = rowTop();
    ui("more").click();
    await wait(400);
    const shown = id => ui(id).offsetWidth > 0;
    assert(ui("drawer").hasAttribute("data-open") && rowTop() === before, "Options fold open without moving the main row");
    const size = ui("size").textContent;
    ui("scale").querySelector('[data-value="3"]').click();
    assert(shown("scale") && !shown("text") && ui("size").textContent !== size && /^\d+ × \d+$/.test(ui("size").textContent), "PNG offers a resolution, and the size shown follows it");
    ui("scale").querySelector('[data-value="2"]').click();
    key("s");
    assert(!shown("scale") && shown("text"), "SVG offers text handling instead");
    ui("text").querySelector('[data-value="outline"]').click();
    ui("download").click();
    await exported("download", 5);
    const outlined = await (await fetch(downloads[2].href)).text();
    assert(!outlined.includes("<text") && outlined.includes("<use"), "Text can be exported as outlines");
    ui("text").querySelector('[data-value="live"]').click();
    const svgButton = ui("format").querySelector('[data-value="svg"]');
    svgButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 1 }));
    const focused = ui("bar").getRootNode().activeElement;
    assert(format() === "svg" && focused === ui("bar"), "A pointer click returns focus to the bar");
    const hintsOpen = ui("hints").hasAttribute("data-open");
    assert(key("?") && ui("hints").hasAttribute("data-open") !== hintsOpen, "? toggles the shortcut list");
    key("?");
    assert(ui("hints").hasAttribute("data-open") === hintsOpen, "? toggles the shortcut list back");
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true, composed: true }));
    assert(format() === "svg" && notice().includes("范围"), "Arrow keys adjust the range, not the button that was clicked");
    ui("more").click();
    await wait(400);

    // ---- turns that are not in the document ------------------------------------
    assert(!$("fx-c") && slots[2].mounted === false, "The fixture has a component in a turn that is not loaded");
    key("ArrowDown");
    await until(selected("fx-b"), "↓ to the last loaded component");
    key("ArrowDown");
    await until(selected("fx-c"), "↓ finds the next component in an unloaded turn", 12000);
    assert(scroller.scrollTop > 1500 && !$("fx-a"), "↓ searches through turns that were not loaded, and a wrapper counts as one level");
    key("ArrowRight");
    await until(selected("fx-c-inner-0"), "→ skips the wrapper level");
    key("ArrowLeft");
    await until(selected("fx-c"), "← returns to the wrapper");
    // This card holds something the SVG renderer cannot draw.
    ui("download").click();
    await until(() => !ui("notice-action").hidden && notice().includes("变换"), "SVG limit is reported");
    assert(!notice().includes("PNG") && ui("notice-action").textContent === "改用 PNG", "An SVG limit is explained, with PNG one click away");
    ui("notice-action").click();
    await exported("download", 6);
    assert(format() === "png" && downloads[3].name === "卡片 C.png", "That click switches to PNG and exports");
    key("ArrowDown");
    await until(selected("fx-d"), "↓ to the grid");
    // Let the scroll that reveals it finish, so there is a resting position to return to.
    for (let last = -1; last !== scroller.scrollTop;) { last = scroller.scrollTop; await wait(160); }
    const resting = scroller.scrollTop;
    key("ArrowDown");
    await until(() => notice().includes("最后一个"), "the end of the conversation is reported", 12000);
    await until(selected("fx-d"), "selection survives the search");
    assert(Math.abs(scroller.scrollTop - resting) < 4, "A search that finds nothing puts the page back");
    key("ArrowUp");
    await until(selected("fx-c"), "↑ back to the card");
    key("ArrowUp");
    await until(selected("fx-b"), "↑ finds the previous component in an unloaded turn", 12000);
    key("ArrowUp");
    await until(selected("fx-a"), "↑ to the first component");
    key("ArrowUp");
    await until(() => notice().includes("第一个"), "the start of the conversation is reported", 12000);
    checks.push("↑ searches backwards the same way, and both ends are reported");

    // ---- re-render ------------------------------------------------------------
    const stale = $("fx-a");
    stale.replaceWith(stale.cloneNode(true));
    // The previous boundary check briefly bounces the frame; wait for it to
    // settle around the replacement instead of assuming two frames suffice.
    await until(selected("fx-a"), "selection follows the replacement after the boundary animation");
    assert($("fx-a") !== stale && selected("fx-a")(), "The selection survives ChatGPT re-rendering the component");

    // Leave a few pixels of the card in view, then scroll just beyond it.
    host.style.top = "100px"; // The scroller clips the card before it leaves the browser window.
    const originalScroll = scroller.scrollTop;
    const bottom = $("fx-a").getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
    scroller.scrollTop += Math.floor(bottom) - 8;
    await wait(120);
    assert(!ui("bar").hasAttribute("data-idle"), "A partially visible selection keeps its controls");
    scroller.scrollTop += 24;
    await until(() => ui("bar").hasAttribute("data-idle"), "mounted card leaves the viewport");
    assert($("fx-a")?.getBoundingClientRect().bottom > 0 && ui("lead").textContent.includes("不在这一屏") && !ui("frame").hasAttribute("data-on"), "Mounted offscreen cards show the offscreen message");
    assert(!ui("return-selection").hidden, "The offscreen notice offers a return action");
    ui("return-selection").click();
    await until(selected("fx-a"), "return button reveals a mounted card");
    scroller.scrollTop = 9000;
    await until(() => !$("fx-a"), "selected turn unmounts");
    assert(ui("lead").textContent.includes("不在这一屏"), "Virtualization preserves the offscreen state");
    host.style.top = "0";
    ui("return-selection").click();
    await until(selected("fx-a"), "return button remounts and reveals the original selection");
    assert(!ui("bar").hasAttribute("data-idle") && ui("download").offsetWidth > 0, "Returning to the selected card restores export controls");

    scroller.scrollTop = originalScroll;

    // ---- leaving --------------------------------------------------------------
    const composer = document.createElement("textarea");
    host.append(composer);
    assert(key("Escape") && !picker.active, "Esc closes the picker");
    await until(() => !document.getElementById("pocketta"), "picker is removed");
    composer.focus();
    picker.toggle();
    // At the 1280 × 900 test viewport the table straddles the window midpoint.
    await until(selected("fx-b"), "the shortcut opens on the nearest component");
    assert(document.activeElement?.id === "pocketta", "The shortcut opens on the component nearest the middle of the window");
    picker.toggle();
    assert(!picker.active && document.activeElement === composer, "The shortcut closes it again and focus returns to where it was");
    await wait(250);
    picker.toggle();
    await until(selected("fx-b"), "picker reopens");
    reached = 0;
    const passed = click(host.querySelector("p"));
    assert(!picker.active && reached === 2 && !passed.click, "Clicking anywhere else closes the picker and the click goes through");
    document.removeEventListener("click", spy);
    document.removeEventListener("pointerdown", spy);
    scroller.scrollTop = 9000;
    await wait(300);
    picker.toggle();
    await until(() => ui("bar")?.hasAttribute("data-idle"), "idle state");
    assert(ui("lead").textContent.includes("没有") && ui("download").offsetWidth === 0 && ui("next").offsetWidth > 0, "With nothing nearby, the bar only offers to jump to a component");
    key("ArrowUp");
    await until(selected("fx-d"), "↑ from nowhere finds the nearest component above", 12000);
    checks.push("From an empty stretch, ↑ jumps to the nearest component above");
    return checks;
  } finally {
    picker.close();
    host.remove();
    globalThis.chrome = original.chrome;
    HTMLAnchorElement.prototype.click = original.click;
    if (navigator.clipboard) {
      navigator.clipboard.write = original.write;
      navigator.clipboard.writeText = original.writeText;
    }
  }
})();
