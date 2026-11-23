(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (location.origin !== "https://chatgpt.com") return;
  // Set by the hover button: the component to start with.
  const pending = globalThis.__chatgptUIExportTarget;
  delete globalThis.__chatgptUIExportTarget;
  const loaded = globalThis.__chatgptUIExportPicker;
  if (loaded?.version === VERSION) {
    // Injected again: the hover button selects, the toolbar icon and the shortcut toggle.
    if (pending) loaded.open(pending);
    else loaded.toggle();
    return;
  }
  loaded?.close?.();
  // A copy left behind by an earlier version of the extension notices this and stops.
  document.getElementById("pocketta")?.remove();

  const Components = globalThis.__chatgptUIExportComponents;
  const Color = globalThis.__chatgptUIExportColor;
  const SETTINGS_KEY = "chatgpt-ui-export.settings";
  const FOLD_ROOM = 120;     // room a folded row needs to open on the side away from the component
  const GAP = 3;             // space between a component and the ring around it
  const MARGIN = 12;         // the bar keeps this distance from the window edges
  const TOP_SAFE = 60;       // clears ChatGPT's header
  const GLIDE = 300;
  const SEEK_BUDGET = 10_000;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const storage = typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
  const settings = { format: "png", scale: 2, transparent: false, outlined: false, hinted: 0 };
  const save = () => { storage?.set({ [SETTINGS_KEY]: { ...settings } }).catch(() => {}); };
  const restored = (async () => {
    try {
      const stored = (await storage?.get(SETTINGS_KEY))?.[SETTINGS_KEY];
      if (!stored || typeof stored !== "object") return;
      if (["png", "svg"].includes(stored.format)) settings.format = stored.format;
      if ([1, 2, 3].includes(stored.scale)) settings.scale = stored.scale;
      settings.transparent = Boolean(stored.transparent);
      settings.outlined = Boolean(stored.outlined);
      const hinted = Number(stored.hinted);
      if (Number.isInteger(hinted) && hinted > 0) settings.hinted = Math.min(hinted, 3);
    } catch { /* Settings are optional; the defaults stay in place. */ }
  })();

  const svg = (paths, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
  const icons = {
    up: svg('<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>'),
    down: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
    options: svg('<path d="M4 8h8m6 0h2M4 16h2m6 0h8"/><circle cx="15" cy="8" r="2.6"/><circle cx="9" cy="16" r="2.6"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/>'),
    download: svg('<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/>'),
    close: svg('<path d="m7 7 10 10M17 7 7 17"/>'),
    info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-9v.2"/>'),
    warning: svg('<path d="m10.3 4.8-7.1 12.4A1.8 1.8 0 0 0 4.8 20h14.4a1.8 1.8 0 0 0 1.6-2.8L13.7 4.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3v.2"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    spinner: svg('<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/>', ' class="spin"')
  };
  const labels = { copy: ["复制", "已复制"], download: ["下载", "已下载"] };
  const segment = (id, name, options, extra = "") => `<div class="seg${extra}" id="${id}" role="radiogroup" aria-label="${name}"><i class="thumb"></i>${options.map(([value, text, tip, key]) => `<button role="radio" data-value="${value}"${tip ? ` data-tip="${tip}"` : ""}${key ? ` data-key="${key}"` : ""}>${text}</button>`).join("")}</div>`;

  const TEMPLATE = `
    <style>
      :host { --accent:#0a7cff; --fg:#0d0d0d; --muted:#6b6b70; --surface:rgba(255,255,255,.9); --line:rgba(0,0,0,.09); --hover:rgba(0,0,0,.06); --inset:rgba(0,0,0,.06); --thumb:#fff; --ink:#111; --ink-fg:#fff; --danger:#c9271a; --flash:.6; --shadow:0 14px 40px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08); color-scheme:light; }
      :host([data-theme="dark"]) { --accent:#4c9dff; --fg:#f5f5f7; --muted:#a1a1a6; --surface:rgba(48,48,50,.9); --line:rgba(255,255,255,.13); --hover:rgba(255,255,255,.1); --inset:rgba(255,255,255,.09); --thumb:#68686d; --ink:#f5f5f7; --ink-fg:#111; --danger:#ff7b6e; --flash:.3; --shadow:0 14px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.3); color-scheme:dark; }
      * { box-sizing:border-box; }
      [hidden] { display:none!important; }
      .sr { position:fixed; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }

      /* The frame marks what will be exported. The page around it is left as it is. */
      .frame,.ring { position:fixed; left:0; top:0; pointer-events:none; opacity:0; }
      .frame { box-shadow:0 0 0 2px var(--accent),0 0 0 6px color-mix(in srgb,var(--accent) 22%,transparent); transition:opacity .2s ease,border-radius .2s ease; }
      .frame[data-on] { opacity:1; }
      .flash { position:absolute; inset:0; border-radius:inherit; background:#fff; opacity:0; }
      .frame[data-flash] .flash { animation:flash .45s ease-out; }
      .frame[data-bump="1"] { animation:bump-down .3s ease-out; }
      .frame[data-bump="-1"] { animation:bump-up .3s ease-out; }
      .frame[data-bump="0"] { animation:pulse .3s ease-out; }
      .ring { background:color-mix(in srgb,var(--accent) 7%,transparent); box-shadow:0 0 0 1.5px var(--accent); transition:opacity .12s ease; }
      .ring[data-on] { opacity:.9; }

      .bar { position:fixed; left:0; top:0; display:flex; flex-direction:column; max-width:calc(100vw - 24px); padding:6px; border-radius:18px; outline:none; pointer-events:auto;
        background:var(--surface); -webkit-backdrop-filter:blur(20px) saturate(1.8); backdrop-filter:blur(20px) saturate(1.8); border:1px solid var(--line); box-shadow:var(--shadow);
        color:var(--fg); font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif; -webkit-font-smoothing:antialiased;
        user-select:none; -webkit-user-select:none; opacity:0; translate:0 6px; transition:opacity .2s ease,translate .28s cubic-bezier(.2,.9,.3,1); }
      .bar[data-on] { opacity:1; translate:0 0; }
      .bar[data-grow="up"] { flex-direction:column-reverse; }
      .bar[data-shake] { animation:shake .32s ease-out; }
      .row { display:flex; flex-wrap:wrap; align-items:center; gap:4px; min-height:36px; }
      button { all:unset; box-sizing:border-box; position:relative; display:inline-flex; align-items:center; justify-content:center; gap:6px; flex:none; height:32px; min-width:32px; padding:0 9px; border-radius:10px;
        cursor:pointer; white-space:nowrap; transition:background .12s ease,opacity .12s ease,scale .12s ease,color .12s ease; }
      button:hover { background:var(--hover); }
      button:active { scale:.95; }
      #more:active { scale:1; }
      button:focus-visible { box-shadow:0 0 0 2px var(--accent); }
      button:disabled { opacity:.4; cursor:default; scale:1; }
      button[aria-expanded="true"] { background:var(--inset); color:var(--accent); }
      button[aria-expanded="true"]:hover { background:var(--inset); }
      button.icon { padding:0; }
      svg { width:18px; height:18px; flex:none; }
      .glyph { display:flex; }
      .glyph svg { animation:pop .22s cubic-bezier(.2,.9,.3,1.3); }
      .spin { animation:spin .7s linear infinite!important; }
      .label { min-width:3em; text-align:center; }
      .primary { padding:0 12px 0 10px; background:var(--ink); color:var(--ink-fg); font-weight:600; }
      .primary:hover { background:var(--ink); opacity:.86; }
      .sep { flex:none; align-self:center; width:1px; height:16px; margin:0 4px; background:var(--line); }
      .lead { display:none; align-items:center; gap:7px; min-width:0; }
      .bar[data-idle] .lead { display:inline-flex; margin:0; padding:6px 10px; }
      .lead svg { width:15px; height:15px; color:var(--muted); }
      .bar[data-idle] .t { display:none!important; }

      .seg { position:relative; display:flex; flex:none; padding:2px; border-radius:10px; background:var(--inset); }
      .seg button { z-index:1; height:28px; min-width:0; padding:0 10px; border-radius:8px; color:var(--muted); }
      .seg button:hover { background:none; color:var(--fg); }
      .seg button[aria-checked="true"] { color:var(--fg); }
      .thumb { position:absolute; left:0; top:2px; bottom:2px; width:0; border-radius:8px; background:var(--thumb); box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.06); }
      .bar[data-ready] .thumb { transition:translate .24s cubic-bezier(.3,.9,.3,1),width .24s cubic-bezier(.3,.9,.3,1); }
      #format button { min-width:46px; font-size:12px; font-weight:600; letter-spacing:.02em; }

      /* Rows that fold open below the main row, or above it when the bar grows upward. */
      .fold { display:grid; grid-template-rows:0fr; width:0; min-width:100%; transition:grid-template-rows .26s cubic-bezier(.3,.9,.3,1); }
      .fold[data-open] { grid-template-rows:1fr; }
      .fold > div { min-height:0; overflow:hidden; }
      .fold:not([data-open]) > div { visibility:hidden; transition:visibility 0s .26s; }
      .panel, .feedback { margin:4px 0 0; }
      .bar[data-grow="up"] .fold :is(.panel,.feedback) { margin:0 0 4px; }
      .options { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; min-height:32px; color:var(--muted); font-size:12px; }
      .options .sep { margin:0 -4px; }
      .opt { display:inline-flex; align-items:center; gap:6px; min-width:0; }
      .name { color:var(--muted); font-size:12px; font-weight:500; }
      #size { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
      .feedback, .tip { font-size:12px; line-height:1.45; font-weight:500; }
      .feedback { border-radius:11px; background:color-mix(in srgb,var(--fg) 4%,transparent); padding:8px 10px; }
      .message { display:flex; gap:7px; align-items:center; }
      .message svg { width:15px; height:15px; color:var(--muted); }
      .message .warning, #notice[data-kind="error"] .info { display:none; }
      #notice[data-kind="error"] .warning { display:flex; color:var(--danger); }
      #notice[data-kind="error"] .feedback { background:color-mix(in srgb,var(--danger) 7%,transparent); }
      #notice-text { flex:1; min-width:0; overflow-wrap:anywhere; }
      .feedback-action { height:26px; min-width:0; padding:0 5px; gap:4px; border-radius:6px; color:var(--fg); font-weight:600; }
      .feedback-action::after { content:""; width:5px; height:5px; border-top:1.5px solid currentColor; border-right:1.5px solid currentColor; transform:rotate(45deg); }
      .hints { display:grid; grid-template-columns:repeat(auto-fit,minmax(108px,1fr)); gap:6px 14px; }
      .hints span { display:flex; justify-content:space-between; align-items:center; gap:4px; white-space:nowrap; }
      .hints .keys { font-style:normal; display:inline-flex; gap:2px; }
      kbd { display:inline-grid; place-items:center; min-width:18px; height:19px; padding:0 4px; border:1px solid var(--line); border-radius:5px; background:var(--thumb); color:var(--muted); font-family:inherit; font-size:11px; line-height:1; }
      .tip { position:absolute; z-index:3; display:flex; align-items:center; gap:8px; max-width:240px; padding:5px 8px; border:1px solid var(--line); border-radius:9px; background:var(--thumb); color:var(--fg); box-shadow:0 3px 12px rgba(0,0,0,.13); pointer-events:none; opacity:0; transition:opacity .12s ease; }
      .tip[data-on] { opacity:1; }
      .tip kbd:empty { display:none; }

      :host([data-leaving]) .frame,:host([data-leaving]) .ring,:host([data-leaving]) .bar { opacity:0!important; transition:opacity .14s ease!important; }
      @keyframes flash { 0% { opacity:0; } 14% { opacity:var(--flash); } 100% { opacity:0; } }
      @keyframes bump-down { 40% { translate:0 9px; } }
      @keyframes bump-up { 40% { translate:0 -9px; } }
      @keyframes pulse { 40% { scale:1.012; } }
      @keyframes shake { 20% { translate:-5px 0; } 45% { translate:5px 0; } 70% { translate:-3px 0; } 90% { translate:1px 0; } }
      @keyframes pop { from { opacity:0; scale:.5; } }
      @keyframes spin { to { rotate:360deg; } }
      @media (prefers-reduced-motion:reduce) { *,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
    </style>
    <div class="frame" id="frame"><i class="flash"></i></div>
    <div class="ring" id="ring"></div>
    <div class="bar" id="bar" role="toolbar" aria-label="导出组件" tabindex="-1" data-grow="up">
      <div class="row">
        <button id="prev" class="icon" aria-label="上一个组件" data-tip="上一个组件" data-key="↑">${icons.up}</button>
        <button id="next" class="icon" aria-label="下一个组件" data-tip="下一个组件" data-key="↓">${icons.down}</button>
        <span class="lead feedback">${icons.info}<span id="lead" role="status"></span><button class="feedback-action" id="return-selection" hidden>返回组件</button></span>
        <i class="sep t"></i>
        ${segment("format", "导出格式", [["png", "PNG", "PNG 图片", "P"], ["svg", "SVG", "SVG 矢量图", "S"]], " t")}
        <button id="more" class="icon t" aria-label="导出选项" aria-expanded="false" data-tip="选项">${icons.options}</button>
        <i class="sep t"></i>
        <button id="copy" class="t" data-tip="" data-key=""><span class="glyph">${icons.copy}</span><span class="label">复制</span></button>
        <button id="download" class="t primary" data-tip="下载文件" data-key="↵"><span class="glyph">${icons.download}</span><span class="label">下载</span></button>
        <i class="sep"></i>
        <button id="close" class="icon" aria-label="退出导出" data-tip="退出" data-key="Esc">${icons.close}</button>
      </div>
      <div class="fold t" id="drawer"><div><div class="panel">
        <div class="options">
          <span class="opt" id="background-option"><span class="name">背景</span>${segment("surface", "背景", [["page", "页面底色"], ["transparent", "透明"]])}</span>
          <span class="opt" data-for="png"><span class="name">清晰度</span>${segment("scale", "清晰度", [["1", "1×"], ["2", "2×"], ["3", "3×"]])}</span>
          <span class="opt" data-for="svg"><span class="name">文字</span>${segment("text", "文字", [["live", "可编辑", "文件小、可编辑；其他软件可能替换字体。"], ["outline", "转为轮廓", "外观保持不变，文字不能再编辑。"]])}</span>
          <i class="sep"></i><output id="size"></output>
        </div>
      </div></div></div>
      <div class="fold" id="notice"><div><div class="feedback message"><i class="info glyph">${icons.info}</i><i class="warning glyph">${icons.warning}</i><span id="notice-text"></span><button class="feedback-action" id="notice-action" hidden></button></div></div></div>
      <div class="fold" id="hints"><div><div class="feedback hints">
        <span>切换组件<i class="keys"><kbd>↑</kbd><kbd>↓</kbd></i></span><span>调整范围<i class="keys"><kbd>←</kbd><kbd>→</kbd></i></span><span>下载<kbd>↵</kbd></span><span>复制<kbd>${mac ? "⌘" : "Ctrl+"}C</kbd></span><span>退出<kbd>Esc</kbd></span><span>快捷键<kbd>?</kbd></span>
      </div></div></div>
      <div class="tip" id="tip" hidden aria-hidden="true"><span id="tip-text"></span><kbd id="tip-key"></kbd></div>
    </div>
    <div class="sr" id="live" aria-live="polite"></div>`;

  let session = null;

  function create() {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const host = document.createElement("div");
    host.id = "pocketta";
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    const $ = id => shadow.getElementById(id);
    const frame = $("frame");
    const ring = $("ring");
    const bar = $("bar");
    const previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    let closed = false;
    let selected = null;      // the component that will be exported
    let selectedKey = null;   // where it sits in its response, to find it again after a re-render
    let bookmark = null;         // scroll position that can remount the selected turn
    let returnDeadline = 0;      // while waiting for that turn to reappear
    let hovered = null;       // what a click would select
    let pointer = null;       // the last pointer position and the element under it
    let pointerDirty = false;
    let box = null;           // the frame as drawn, in window coordinates
    let glide = null;         // the frame's remaining offset while it travels to a new component
    let side = "above";       // where the bar sits relative to the frame
    let rowHeight = 50;
    let rowTop = 0;           // where the main row was last placed
    let busy = false;
    let work = null;
    let seeking = null;       // { scroller, origin } while searching through turns that are not loaded
    let seekRun = 0;
    let noticeRun = null;
    let noticeTimer = 0;
    let raf = 0;
    const stateTimers = new Map();

    const syncTheme = () => {
      const root = document.documentElement;
      host.dataset.theme = getComputedStyle(root).colorScheme === "dark" || root.classList.contains("dark") ? "dark" : "light";
    };
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    syncTheme();
    document.documentElement.append(host);
    rowHeight = bar.offsetHeight;

    const announce = text => { $("live").textContent = text; };
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const replay = (node, name, value = "") => {
      node.removeAttribute(name);
      void node.offsetWidth;
      node.setAttribute(name, value);
    };
    // Looks an element up again at most twice a second.
    const lookup = find => {
      let node = null;
      let checked = -Infinity;
      return now => {
        if (!node?.isConnected && now - checked > 500) {
          checked = now;
          node = find();
        }
        return node?.isConnected ? node : null;
      };
    };
    const composer = lookup(() => document.querySelector("form[data-chatgpt-composer], form:has(#prompt-textarea)"));
    const column = lookup(() => document.querySelector(Components.ROOT) || document.querySelector("main"));
    const radiusOf = node => {
      const style = getComputedStyle(node);
      return ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]
        .map(key => `${Math.min(40, Number.parseFloat(style.getPropertyValue(key)) || 0) + GAP}px`).join(" ");
    };
    const scrollerOf = node => {
      for (let up = node?.parentElement; up; up = up.parentElement) {
        if (up.scrollHeight > up.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(up).overflowY)) return up;
      }
      return null;
    };
    const keyText = node => {
      const key = Components.keyOf(node);
      return key ? `${key.message}/${key.path.join(".")}` : "";
    };

    // The selection, found again if ChatGPT re-rendered it.
    function current() {
      if (selected?.isConnected) return selected;
      const again = selectedKey && Components.resolve(selectedKey);
      if (!again || !Components.isVisible(again)) return null;
      selected = again;
      frame.style.borderRadius = radiusOf(again);
      return again;
    }

    // ---- controls -----------------------------------------------------------

    function syncSegment(id, value) {
      const group = $(id);
      let checked = null;
      for (const button of group.querySelectorAll("button")) {
        const on = button.dataset.value === String(value);
        button.setAttribute("aria-checked", String(on));
        button.tabIndex = on ? 0 : -1;
        if (on) checked = button;
      }
      const thumb = group.querySelector(".thumb");
      if (checked?.offsetWidth) {
        thumb.style.width = `${checked.offsetWidth}px`;
        thumb.style.translate = `${checked.offsetLeft}px 0`;
      } else if (!checked) {
        thumb.style.width = "0px";
      }
    }

    function syncSize() {
      const node = current();
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const factor = settings.format === "png" ? settings.scale : 1;
      $("size").textContent = `${Math.round(Math.ceil(rect.width) * factor)} × ${Math.round(Math.ceil(rect.height) * factor)}`;
    }

    // ---- options, hints, tooltips -------------------------------------------

    let hintsDesired = false;
    let hintsHold = false;
    let hintsTimer = 0;
    let tipTimer = 0;
    let tipColdTimer = 0;
    let tipTarget = null;
    let tipWarm = false;

    const applyHints = () => {
      $("hints").toggleAttribute("data-open", hintsDesired && !$("notice").hasAttribute("data-open"));
    };

    // `?` toggles the list and keeps it up. The first few opens show it on their own.
    function toggleHints() {
      clearTimeout(hintsTimer);
      hintsHold = true;
      hintsDesired = !hintsDesired;
      applyHints();
    }

    function showCoach() {
      if (closed || hintsHold || settings.hinted >= 3) return;
      settings.hinted += 1;
      save();
      hintsDesired = true;
      applyHints();
      hintsTimer = setTimeout(() => {
        if (hintsHold || closed) return;
        hintsDesired = false;
        applyHints();
      }, 8000);
    }

    function placeTip(button) {
      const tip = $("tip");
      if (tip.hidden) return;
      const barRect = bar.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const tipWidth = tip.offsetWidth;
      const tipHeight = tip.offsetHeight;
      const min = 8 - barRect.left;
      const max = innerWidth - 8 - barRect.left - tipWidth;
      const left = Math.min(Math.max(rect.left + rect.width / 2 - barRect.left - tipWidth / 2, min), Math.max(min, max));
      let top = bar.dataset.grow === "up" ? -tipHeight - 8 : bar.offsetHeight + 8;
      if (barRect.top + top < 8) top = bar.offsetHeight + 8;
      else if (barRect.top + top + tipHeight > innerHeight - 8) top = -tipHeight - 8;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    }

    function hideTip() {
      clearTimeout(tipTimer);
      tipTarget = null;
      const tip = $("tip");
      tip.removeAttribute("data-on");
      tip.hidden = true;
    }

    function showTip(button) {
      const text = button?.dataset.tip;
      if (!text || button.offsetWidth === 0) return hideTip();
      const tip = $("tip");
      $("tip-text").textContent = text;
      $("tip-key").textContent = button.dataset.key || "";
      tipTarget = button;
      tip.hidden = false;
      placeTip(button);
      requestAnimationFrame(() => { if (tipTarget === button) tip.setAttribute("data-on", ""); });
    }

    function armTip(button) {
      clearTimeout(tipTimer);
      clearTimeout(tipColdTimer);
      tipTimer = setTimeout(() => {
        tipWarm = true;
        showTip(button);
      }, tipWarm ? 40 : 500);
    }

    function fold() {
      const open = !$("drawer").hasAttribute("data-open");
      $("drawer").toggleAttribute("data-open", open);
      $("more").setAttribute("aria-expanded", String(open));
      aim();
      sync();
    }

    // Folded rows open away from the component, so they do not cover it,
    // unless that side is cramped and the other has more room.
    function aim() {
      const above = rowTop - 8;
      const below = innerHeight - rowTop - rowHeight - 8;
      const up = side === "above" ? above >= FOLD_ROOM || above >= below : below < FOLD_ROOM && above > below;
      if (bar.dataset.grow !== (up ? "up" : "down")) bar.dataset.grow = up ? "up" : "down";
    }

    function sync() {
      for (const node of shadow.querySelectorAll("[data-for]")) node.hidden = node.dataset.for !== settings.format;
      $("background-option").hidden = settings.format === "svg" && selected instanceof HTMLImageElement;
      syncSegment("format", settings.format);
      syncSegment("scale", settings.scale);
      syncSegment("text", settings.outlined ? "outline" : "live");
      syncSegment("surface", settings.transparent ? "transparent" : "page");
      $("copy").dataset.tip = settings.format === "png" ? "复制图片" : "复制 SVG 图片";
      $("copy").dataset.key = mac ? "⌘C" : "Ctrl+C";
      syncSize();
      if (tipTarget) showTip(tipTarget);
    }

    function setFormat(value) {
      if (busy || settings.format === value) return;
      settings.format = value;
      clearNotice();
      sync();
      save();
    }

    function notice(text, { kind = "info", action = "", run = null, timeout = 0 } = {}) {
      clearTimeout(noticeTimer);
      $("notice-text").textContent = text;
      $("notice-action").textContent = action;
      $("notice-action").hidden = !action;
      noticeRun = run;
      $("notice").dataset.kind = kind;
      $("notice").setAttribute("data-open", "");
      applyHints();
      announce(text);
      if (timeout) noticeTimer = setTimeout(clearNotice, timeout);
    }

    function clearNotice() {
      clearTimeout(noticeTimer);
      noticeRun = null;
      $("notice").removeAttribute("data-open");
      applyHints();
    }

    function setState(id, state) {
      const button = $(id);
      clearTimeout(stateTimers.get(id));
      button.querySelector(".glyph").innerHTML = state === "busy" ? icons.spinner : state === "done" ? icons.check : icons[id];
      button.querySelector(".label").textContent = labels[id][state === "done" ? 1 : 0];
      if (state === "done") stateTimers.set(id, setTimeout(() => setState(id, "idle"), 1600));
    }

    function setBusy(value) {
      busy = value;
      for (const button of bar.querySelectorAll("#copy, #download, #format button")) button.disabled = value;
    }

    // The bar shows the export controls only while there is something to export.
    function setIdle(text, canReturn = false) {
      $("return-selection").hidden = !canReturn;
      if (text === null) return bar.removeAttribute("data-idle");
      if ($("lead").textContent !== text) $("lead").textContent = text;
      bar.setAttribute("data-idle", "");
    }

    // ---- selection ----------------------------------------------------------

    function reveal(node, smooth = true) {
      const rect = node.getBoundingClientRect();
      const scroller = scrollerOf(node);
      const view = scroller?.getBoundingClientRect();
      // Leaves room for the bar above the component and clears the composer below it.
      const top = Math.max(view?.top ?? 0, 0) + rowHeight + 28;
      const bottom = Math.min(view?.bottom ?? innerHeight, innerHeight) - 110;
      if (rect.top >= top && rect.bottom <= bottom) return;
      const room = Math.max(0, bottom - top);
      const delta = rect.height <= room ? rect.top - (top + (room - rect.height) / 2) : rect.top - top;
      if (Math.abs(delta) < 2) return;
      const options = { top: delta, behavior: smooth && !reducedMotion.matches ? "smooth" : "auto" };
      if (!scroller) return scrollBy(options);
      scroller.scrollBy(options);
      // Turns that load on the way can shift the page, so the landing is checked once.
      if (smooth) scroller.addEventListener("scrollend", () => { if (!closed && selected === node && node.isConnected) reveal(node, false); }, { once: true, signal });
    }

    function returnToSelection() {
      const node = current();
      if (node) {
        node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        return;
      }
      if (!bookmark || !selectedKey) return;
      const scroller = bookmark.scroller.isConnected ? bookmark.scroller : scrollerOf(column(performance.now())) || document.scrollingElement;
      returnDeadline = performance.now() + 3000;
      scroller.scrollTo({ top: bookmark.top, behavior: "instant" });
    }

    function select(node, { show = true } = {}) {
      if (!node || closed) return;
      if (node !== selected) {
        glide = { start: 0 };
        side = "above";
      }
      selected = node;
      selectedKey = Components.keyOf(node);
      returnDeadline = 0;
      const scroller = scrollerOf(node) || document.scrollingElement;
      const viewTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      bookmark = { scroller, top: scroller.scrollTop + node.getBoundingClientRect().top - viewTop - scroller.clientHeight / 3 };
      hovered = null;
      pointerDirty = true;
      frame.style.borderRadius = radiusOf(node);
      setIdle(null);
      clearNotice();
      sync();
      const rect = node.getBoundingClientRect();
      announce(`已选中${Components.label(node)}，${Math.ceil(rect.width)} × ${Math.ceil(rect.height)}`);
      if (show) reveal(node);
    }

    // The component closest to the middle of the window, if one is reasonably near.
    function nearest() {
      const middle = innerHeight / 2;
      let best = null;
      let distance = Infinity;
      for (const node of Components.all()) {
        const rect = node.getBoundingClientRect();
        const away = rect.top > middle ? rect.top - middle : rect.bottom < middle ? middle - rect.bottom : 0;
        if (away < distance) { best = node; distance = away; }
      }
      return distance <= innerHeight * 1.25 ? best : null;
    }

    // What a click on `target` selects: another component, a sibling at the
    // level already entered, one level deeper, or back out to the whole thing.
    function pickAt(target) {
      const levels = Components.ladder(target);
      if (!levels.length) return null;
      const whole = levels.at(-1);
      const node = current();
      if (!node) return whole;
      const at = levels.indexOf(node);
      if (at > 0) return levels[at - 1];
      if (at === 0) return node === whole ? null : whole;
      const shared = levels.findIndex(level => level.contains(node));
      if (shared < 0) return whole;
      return levels[Math.max(0, shared - 1)];
    }

    function edge(direction) {
      if (current()) {
        replay(frame, "data-bump", String(direction));
        notice(direction > 0 ? "已到最后一个组件" : direction < 0 ? "已到第一个组件" : "没有更小或更大的范围了", { timeout: 1800 });
      } else {
        notice(direction > 0 ? "下文没有可导出的组件" : "上文没有可导出的组件", { timeout: 2400 });
      }
    }

    // The next whole component in a direction among what is loaded, or null.
    function neighbour(direction) {
      const list = Components.all();
      const node = current();
      if (node) {
        const index = list.indexOf(Components.top(node) || node);
        return index < 0 ? null : list[index + direction] || null;
      }
      const middle = innerHeight / 2;
      return direction > 0
        ? list.find(item => item.getBoundingClientRect().top > middle) || null
        : list.findLast(item => item.getBoundingClientRect().bottom < middle) || null;
    }

    function step(direction) {
      returnDeadline = 0;
      if (seeking || closed) return;
      const node = current();
      if (node) {
        // Inside a component, the arrows first move between its parts.
        const around = Components.outer(node);
        const parts = around ? Components.inner(around) : [];
        const at = parts.indexOf(node);
        if (at >= 0 && parts[at + direction]) return select(parts[at + direction]);
      }
      const next = neighbour(direction);
      if (next) return select(next);
      seek(direction);
    }

    // ---- searching through turns that are not loaded ------------------------

    // ChatGPT keeps only the turns near the window in the document, so the rest
    // of the conversation has to be scrolled through to be searched.
    async function settle(scroller) {
      await nextFrame();
      await nextFrame();
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(quiet);
          clearTimeout(limit);
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(done, 90);
        });
        let quiet = setTimeout(done, 90);
        const limit = setTimeout(done, 600);
        observer.observe(scroller, { childList: true, subtree: true });
      });
    }

    // How far to move: a page, or to the end of the responses that are loaded
    // around the window when that is further, since those were searched already.
    function stride(scroller, direction) {
      const view = scroller.getBoundingClientRect();
      const page = scroller.clientHeight * 0.85;
      // Distances along the direction of travel, from the trailing edge of the window.
      const spans = [...document.querySelectorAll(Components.ROOT)].map(root => root.getBoundingClientRect()).filter(rect => rect.height)
        .map(rect => direction > 0 ? [rect.top - view.top, rect.bottom - view.top] : [view.bottom - rect.bottom, view.bottom - rect.top])
        .sort((a, b) => a[0] - b[0]);
      let reach = 0;
      for (const [start, end] of spans) {
        if (end < 0) continue;
        // A wide gap means the turns in between are not loaded.
        if (start > reach + scroller.clientHeight) break;
        reach = Math.max(reach, end);
      }
      return direction * Math.max(page, reach - 120);
    }

    async function seek(direction, resume = null) {
      const anchor = current() || document.querySelector(Components.ROOT) || document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      const scroller = scrollerOf(anchor);
      if (!scroller) return edge(direction);
      const run = ++seekRun;
      const started = performance.now();
      const stale = () => closed || run !== seekRun;
      // Everything loaded at the start was already ruled out, so whatever
      // appears while moving on is further along.
      const ruledOut = resume?.ruledOut || new Set(Components.all().map(keyText));
      seeking = { scroller, origin: resume?.origin ?? scroller.scrollTop };
      if (resume) scroller.scrollTop = resume.top;
      clearNotice();
      $(direction > 0 ? "next" : "prev").innerHTML = icons.spinner;
      announce("正在查找…");
      let found = null;
      let ended = false;
      while (!found && !ended && performance.now() - started < SEEK_BUDGET) {
        const before = scroller.scrollTop;
        const height = scroller.scrollHeight;
        scroller.scrollTop = before + stride(scroller, direction);
        await settle(scroller);
        if (stale()) return;
        const fresh = Components.all().filter(node => !ruledOut.has(keyText(node)));
        found = (direction > 0 ? fresh[0] : fresh.at(-1)) || null;
        if (found || Math.abs(scroller.scrollTop - before) >= 2 || scroller.scrollHeight !== height) continue;
        // An end of the page. Earlier turns can arrive a moment after the top is reached.
        ended = true;
        for (let wait = 0; direction < 0 && ended && wait < 16; wait++) {
          await pause(100);
          if (stale()) return;
          ended = scroller.scrollHeight === height && scroller.scrollTop <= 2;
        }
      }
      const { origin } = seeking;
      const reached = scroller.scrollTop;
      stopSeek();
      if (found) return select(found);
      // Back to where the search started.
      scroller.scrollTop = origin;
      await settle(scroller);
      if (closed) return;
      const node = current();
      if (node) reveal(node, false);
      if (ended) return edge(direction);
      notice(direction > 0 ? "往下暂时没有找到组件" : "往上暂时没有找到组件", {
        action: "继续查找", run: () => seek(direction, { origin, top: reached, ruledOut })
      });
    }

    function stopSeek() {
      if (!seeking) return;
      seeking = null;
      seekRun++;
      $("prev").innerHTML = icons.up;
      $("next").innerHTML = icons.down;
    }

    // ---- range --------------------------------------------------------------

    function zoom(direction) {
      const node = current();
      if (!node || seeking) return;
      let next = null;
      if (direction > 0) next = Components.outer(node);
      else {
        const parts = Components.inner(node);
        const under = pointer?.target instanceof Node && node.contains(pointer.target) ? Components.ladder(pointer.target) : [];
        next = parts.find(part => under.includes(part)) || parts[0] || null;
      }
      if (next) select(next);
      else edge(0);
    }

    // ---- export -------------------------------------------------------------

    function fileName(node, extension) {
      const base = Components.title(node).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 40).trim();
      return `${base || "chatgpt-ui"}.${extension}`;
    }

    function download(result, node) {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(node, result.format);
      link.style.display = "none";
      document.documentElement.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    async function copy(result, signal) {
      const types = {};
      if (result.format === "svg" && globalThis.ClipboardItem?.supports?.("image/svg+xml")) {
        types["image/svg+xml"] = result.blob.slice(0, result.blob.size, "image/svg+xml");
      }
      types["image/png"] = result.format === "png" ? result.blob :
        await globalThis.__chatgptUIExportRaster.preview(result, signal);
      signal.throwIfAborted();
      try {
        await navigator.clipboard.write([new ClipboardItem(types)]);
      } catch (error) {
        if (types["image/svg+xml"] && error.name === "DataError") {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": types["image/png"] })]);
          return;
        }
        throw new Error("无法写入剪贴板。请点击一下页面后重试，或改用下载。");
      }
    }

    async function run(kind) {
      const node = current();
      if (!node || busy || closed || seeking) return;
      const controller = work = new AbortController();
      setBusy(true);
      setState(kind, "busy");
      clearNotice();
      try {
        const result = await globalThis.__chatgptUIExportRenderer.render(node, {
          format: settings.format, scale: settings.scale, surface: settings.transparent ? "transparent" : "page",
          text: settings.outlined ? "outline" : "live", signal: controller.signal
        });
        if (closed) return;
        if (kind === "copy") await copy(result, controller.signal);
        else download(result, node);
        if (closed) return;
        replay(frame, "data-flash");
        setState(kind, "done");
        announce(kind === "copy" ? "已复制到剪贴板" : "已开始下载");
      } catch (error) {
        if (closed || error.name === "AbortError") return;
        setState(kind, "idle");
        replay(bar, "data-shake");
        const message = error.message || "导出失败，请重试。";
        if (error.fallback === "png") {
          notice(message.replace(/[，,]?\s*请使用 PNG。?$/, "。"), {
            kind: "error", action: "改用 PNG",
            run: () => { setFormat("png"); run(kind); }
          });
        } else {
          notice(message, { kind: "error" });
        }
      } finally {
        if (!closed) setBusy(false);
      }
    }

    // ---- drawing ------------------------------------------------------------

    // IntersectionObserver accounts for the viewport and clipping by nested
    // scroll containers, even when ChatGPT keeps a distant turn mounted.
    let observed = null;
    let intersects = false;
    const visibility = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === observed) intersects = entry.isIntersecting;
      }
    });

    function draw(now) {
      if (closed) return;
      // Removed from outside, for example by a newer copy of this script.
      if (!host.isConnected) return close();
      raf = requestAnimationFrame(draw);
      const width = innerWidth;
      const height = innerHeight;
      const node = current();
      if (returnDeadline && node) {
        returnDeadline = 0;
        node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      } else if (returnDeadline && now >= returnDeadline) {
        returnDeadline = 0;
        notice("暂未找到原组件，请重试。", { timeout: 2400 });
      }
      const rect = node?.getBoundingClientRect();
      if (node !== observed) {
        visibility.disconnect();
        observed = node;
        // Use viewport geometry until the first clipping observation arrives.
        intersects = true;
        if (node) visibility.observe(node);
      }
      if (intersects && rect?.width && rect.height && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width) {
        const goal = { x: rect.left - GAP, y: rect.top - GAP, w: rect.width + GAP * 2, h: rect.height + GAP * 2 };
        if (glide && !glide.start) {
          // Travels from where the frame was; a first frame settles in from slightly larger.
          const from = box || { x: goal.x - 10, y: goal.y - 10, w: goal.w + 20, h: goal.h + 20 };
          glide = { x: from.x - goal.x, y: from.y - goal.y, w: from.w - goal.w, h: from.h - goal.h, start: now };
        }
        let left = 0;
        if (glide) {
          const progress = reducedMotion.matches ? 1 : Math.min(1, (now - glide.start) / GLIDE);
          left = (1 - progress) ** 4;
          if (progress >= 1) glide = null;
        }
        // The offset is relative to the component, so the frame stays glued to it while the page scrolls.
        box = glide ? { x: goal.x + glide.x * left, y: goal.y + glide.y * left, w: goal.w + glide.w * left, h: goal.h + glide.h * left } : goal;
        frame.style.transform = `translate(${box.x}px,${box.y}px)`;
        frame.style.width = `${box.w}px`;
        frame.style.height = `${box.h}px`;
        frame.setAttribute("data-on", "");
        if (bar.hasAttribute("data-idle") && !seeking) {
          setIdle(null);
          sync();
        }
      } else {
        box = null;
        frame.removeAttribute("data-on");
      }
      if (seeking) setIdle("正在查找组件…");
      else if (returnDeadline) setIdle("正在返回组件…");
      else if (!box) setIdle(selectedKey ? "选中的组件不在这一屏" : "这附近没有可导出的组件", Boolean(selectedKey));

      if (pointerDirty) {
        pointerDirty = false;
        const choice = pointer && !pointer.inside && !seeking ? pickAt(pointer.target) : null;
        if (choice !== hovered) {
          hovered = choice;
          if (choice) ring.style.borderRadius = radiusOf(choice);
        }
      }
      const over = hovered?.isConnected ? hovered.getBoundingClientRect() : null;
      if (over?.width) {
        ring.style.transform = `translate(${over.left - GAP}px,${over.top - GAP}px)`;
        ring.style.width = `${over.width + GAP * 2}px`;
        ring.style.height = `${over.height + GAP * 2}px`;
        ring.setAttribute("data-on", "");
      } else {
        ring.removeAttribute("data-on");
      }

      // The main row is what gets placed; folded rows extend away from it, so
      // opening the options never moves the button that was just pressed.
      const barWidth = bar.offsetWidth;
      const barHeight = bar.offsetHeight;
      rowHeight = bar.querySelector(".row").offsetHeight + 14;
      const composerTop = composer(now)?.getBoundingClientRect().top;
      const floor = (composerTop > height / 2 ? Math.min(height - MARGIN, composerTop - 8) : height - MARGIN) - rowHeight;
      let x;
      let rowY = floor;
      if (box) {
        // Sits on the corner where the hover button was, so the pointer is already there.
        x = Math.min(box.x + box.w, width - MARGIN) - barWidth;
        const fits = { above: box.y - 10 - rowHeight >= TOP_SAFE, below: box.y + box.h + 10 <= floor };
        if (!fits[side]) side = side === "above" && fits.below ? "below" : "above";
        rowY = side === "above" ? box.y - 10 - rowHeight : box.y + box.h + 10;
      } else {
        const rect = column(now)?.getBoundingClientRect();
        x = (rect?.width ? rect.left + rect.width / 2 : width / 2) - barWidth / 2;
      }
      rowY = Math.min(Math.max(rowY, TOP_SAFE), Math.max(TOP_SAFE, floor));
      rowTop = rowY;
      if (barHeight <= rowHeight + 1) aim();
      x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, width - barWidth - MARGIN));
      // Growing upward is anchored on the bottom edge. Compensating the top from
      // the animated height makes the buttons jump; a fixed bottom cannot.
      if (bar.dataset.grow === "up") {
        bar.style.top = "auto";
        bar.style.bottom = `${Math.round(innerHeight - (rowY + rowHeight))}px`;
        bar.style.transform = `translate(${Math.round(x)}px, 0)`;
      } else {
        bar.style.bottom = "auto";
        bar.style.top = "0px";
        bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(rowY, 8))}px)`;
      }
      if (tipTarget) placeTip(tipTarget);
      if (!bar.hasAttribute("data-on")) {
        bar.setAttribute("data-on", "");
        // Segment thumbs start in place and only animate from now on.
        requestAnimationFrame(() => bar.setAttribute("data-ready", ""));
      }
    }

    // ---- input --------------------------------------------------------------

    const inside = event => event.composedPath().includes(host);
    const onScrollbar = event => {
      const node = event.target;
      if (!(node instanceof Element) || node.scrollHeight <= node.clientHeight + 1) return false;
      return event.clientX >= node.getBoundingClientRect().right - 18;
    };

    document.addEventListener("pointermove", event => {
      pointer = { x: event.clientX, y: event.clientY, target: event.target, inside: inside(event) };
      pointerDirty = true;
    }, { capture: true, passive: true, signal });
    document.addEventListener("scroll", () => {
      // The element under a resting pointer changes as the page moves.
      if (!pointer || pointer.inside) return;
      pointer.target = document.elementFromPoint(pointer.x, pointer.y);
      pointerDirty = true;
    }, { capture: true, passive: true, signal });
    for (const type of ["wheel", "touchmove"]) {
      document.addEventListener(type, () => { returnDeadline = 0; if (seeking) stopSeek(); }, { capture: true, passive: true, signal });
    }

    // A click on a component selects it instead of reaching the page; a press
    // anywhere else ends the session and is left for the page to handle.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]) {
      document.addEventListener(type, event => {
        if (event.button !== 0 || inside(event)) return;
        const choice = seeking ? null : pickAt(event.target);
        const within = selected?.isConnected && event.target instanceof Node && selected.contains(event.target);
        if (!choice && !within) {
          if (event.type === "pointerdown" && !onScrollbar(event)) close();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "click" && choice) select(choice, { show: false });
      }, { capture: true, signal });
    }

    document.addEventListener("keydown", event => {
      const origin = event.composedPath()[0];
      const focused = origin instanceof Element && bar.contains(origin) ? origin : null;
      const take = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const key = event.key;
      if (event.isComposing || event.defaultPrevented) return;
      if (key === "Escape") { take(); return close(); }
      if (event.altKey) return;
      if (event.metaKey || event.ctrlKey) {
        if (key.toLowerCase() === "c" && !event.shiftKey) { take(); run("copy"); }
        return;
      }
      const group = focused?.closest('[role="radiogroup"]');
      switch (key) {
        case "ArrowUp": take(); return step(-1);
        case "ArrowDown": take(); return step(1);
        case "ArrowLeft":
        case "ArrowRight": {
          take();
          if (!group) return zoom(key === "ArrowLeft" ? 1 : -1);
          const buttons = [...group.querySelectorAll("button")];
          const next = buttons[(buttons.findIndex(button => button.getAttribute("aria-checked") === "true") + (key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
          next.click();
          return next.focus();
        }
        case "Enter":
          // A focused button keeps its own action.
          if (focused?.localName === "button") return;
          take();
          return run("download");
        default:
      }
      switch (key.length === 1 ? key.toLowerCase() : "") {
        case "j": take(); return step(1);
        case "k": take(); return step(-1);
        case "c": take(); return run("copy");
        case "p": take(); return setFormat("png");
        case "s": take(); return setFormat("svg");
        case "?": take(); return toggleHints();
        default:
      }
    }, { capture: true, signal });

    bar.addEventListener("pointerover", event => {
      const button = event.target.closest("button");
      if (button && bar.contains(button)) armTip(button);
    }, { signal });
    bar.addEventListener("pointerout", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest("button") : null;
      if (next && bar.contains(next)) return;
      clearTimeout(tipTimer);
      hideTip();
      tipColdTimer = setTimeout(() => { tipWarm = false; }, 700);
    }, { signal });
    bar.addEventListener("focusin", event => {
      const button = event.target.closest("button");
      if (button && bar.contains(button)) showTip(button);
    }, { signal });
    bar.addEventListener("focusout", event => {
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest("button") : null;
      if (!next || !bar.contains(next)) hideTip();
    }, { signal });
    bar.addEventListener("pointerdown", () => hideTip(), { signal });
    bar.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      // A pointer click would leave focus on the button, so the next arrow or
      // Enter would act on it instead of the selection.
      if (event.detail > 0) bar.focus({ preventScroll: true });
      const group = button.closest(".seg");
      if (group) {
        if (busy) return;
        const value = button.dataset.value;
        if (group.id === "format") return setFormat(value);
        if (group.id === "scale") settings.scale = Number(value);
        else if (group.id === "text") settings.outlined = value === "outline";
        else settings.transparent = value === "transparent";
        sync();
        return save();
      }
      switch (button.id) {
        case "return-selection": return returnToSelection();
        case "prev": return step(-1);
        case "next": return step(1);
        case "copy": return run("copy");
        case "download": return run("download");
        case "close": return close();
        case "notice-action": return noticeRun?.();
        case "more": return fold();
        default:
      }
    }, { signal });
    for (const [node, names] of [[frame, ["data-flash", "data-bump"]], [bar, ["data-shake"]]]) {
      node.addEventListener("animationend", event => {
        if (event.target === node || event.target.parentElement === node) for (const name of names) node.removeAttribute(name);
      }, { signal });
    }

    function close() {
      if (closed) return;
      closed = true;
      const landed = seeking;
      stopSeek();
      if (landed) landed.scroller.scrollTop = landed.origin;
      lifetime.abort();
      work?.abort();
      cancelAnimationFrame(raf);
      clearTimeout(noticeTimer);
      clearTimeout(hintsTimer);
      clearTimeout(tipTimer);
      clearTimeout(tipColdTimer);
      for (const timer of stateTimers.values()) clearTimeout(timer);
      visibility.disconnect();
      themeObserver.disconnect();
      // Hands the keyboard back to wherever it was, unless the page has moved focus since.
      if ((document.activeElement === host || document.activeElement === document.body) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      host.setAttribute("data-leaving", "");
      setTimeout(() => host.remove(), 180);
      if (session === api) session = null;
    }

    function start(target) {
      const node = target instanceof HTMLElement && target.isConnected && Components.isComponent(target) && Components.isVisible(target) ? target : null;
      if (node) return select(node, { show: false });
      const near = nearest();
      if (near) select(near);
      else announce("这附近没有可导出的组件");
    }

    sync();
    restored.then(() => { if (!closed) { sync(); showCoach(); } });
    bar.focus({ preventScroll: true });
    raf = requestAnimationFrame(draw);
    const api = { start, close };
    return api;
  }

  function open(target) {
    if (!Components || !Color || !globalThis.__chatgptUIExportRenderer) return;
    session ||= create();
    session.start(target);
  }

  globalThis.__chatgptUIExportPicker = Object.freeze({
    version: VERSION,
    get active() { return Boolean(session); },
    open,
    close: () => session?.close(),
    toggle: () => { if (session) session.close(); else open(); }
  });
  open(pending);
})();
