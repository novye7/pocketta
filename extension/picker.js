(() => {
  "use strict";
  const VERSION = "0.8.0";
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
  document.getElementById("chatgpt-ui-exporter")?.remove();

  const Components = globalThis.__chatgptUIExportComponents;
  const Theme = globalThis.__chatgptUIExportTheme;
  const SETTINGS_KEY = "chatgpt-ui-export.settings";
  const MAX_SWATCHES = 8;
  const FOLD_ROOM = 220;     // room a folded row needs to open on the side away from the component
  // Font choices by key; the families are what a theme stores.
  const FONTS = [
    ["", "默认", ""], ["serif", "衬线", 'Georgia, "Songti SC", serif'],
    ["round", "圆体", '"SF Pro Rounded", "PingFang SC", sans-serif'], ["kai", "楷体", '"Kaiti SC", serif']
  ];
  const ROLES = { background: "背景", text: "文字", border: "边框", fill: "填充", stroke: "描边", shadow: "阴影" };
  const GAP = 3;             // space between a component and the ring around it
  const MARGIN = 12;         // the bar keeps this distance from the window edges
  const TOP_SAFE = 60;       // clears ChatGPT's header
  const GLIDE = 300;
  const SEEK_BUDGET = 10_000;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const storage = typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
  const settings = { format: "png", scale: 2, transparent: false, outlined: false, theme: Theme?.defaults() };
  const save = () => { storage?.set({ [SETTINGS_KEY]: { ...settings } }).catch(() => {}); };
  const restored = (async () => {
    try {
      presets = await Theme.readPresets();
      const stored = (await storage?.get(SETTINGS_KEY))?.[SETTINGS_KEY];
      if (!stored || typeof stored !== "object") return;
      if (["png", "svg"].includes(stored.format)) settings.format = stored.format;
      if ([1, 2, 3].includes(stored.scale)) settings.scale = stored.scale;
      settings.transparent = Boolean(stored.transparent);
      settings.outlined = Boolean(stored.outlined);
      if (stored.theme) settings.theme = Theme.normalize(stored.theme);
    } catch { /* Settings are optional; the defaults stay in place. */ }
  })();

  const svg = (paths, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
  const icons = {
    up: svg('<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>'),
    down: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
    options: svg('<path d="M4 8h8m6 0h2M4 16h2m6 0h8"/><circle cx="15" cy="8" r="2.6"/><circle cx="9" cy="16" r="2.6"/>'),
    theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/>'),
    download: svg('<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/>'),
    close: svg('<path d="m7 7 10 10M17 7 7 17"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    spinner: svg('<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/>', ' class="spin"')
  };
  const labels = { copy: ["复制", "已复制"], download: ["下载", "已下载"] };
  const segment = (id, name, options, extra = "") => `<div class="seg${extra}" id="${id}" role="radiogroup" aria-label="${name}"><i class="thumb"></i>${options.map(([value, text, tip]) => `<button role="radio" data-value="${value}"${tip ? ` data-tip="${tip}"` : ""}>${text}</button>`).join("")}</div>`;

  const slider = (id, name, min, max, step) => `<input type="range" id="${id}" aria-label="${name}" min="${min}" max="${max}" step="${step}"><output class="value" id="${id}-value"></output>`;
  const color = (id, name, when) => `<input type="color" id="${id}" aria-label="${name}" title="${name}" data-bg="${when}">`;

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
      button:focus-visible { box-shadow:0 0 0 2px var(--accent); }
      button:disabled { opacity:.4; cursor:default; scale:1; }
      button.icon { padding:0; }
      svg { width:18px; height:18px; flex:none; }
      .glyph { display:flex; }
      .glyph svg { animation:pop .22s cubic-bezier(.2,.9,.3,1.3); }
      .spin { animation:spin .7s linear infinite!important; }
      .label { min-width:3em; text-align:center; }
      .primary { padding:0 12px 0 10px; background:var(--ink); color:var(--ink-fg); font-weight:600; }
      .primary:hover { background:var(--ink); opacity:.86; }
      .sep { flex:none; width:1px; height:18px; margin:0 4px; background:var(--line); }
      .lead { display:none; padding:0 8px 0 6px; color:var(--muted); white-space:nowrap; }
      .bar[data-idle] .lead { display:block; }
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
      .panel { margin-top:6px; border-top:1px solid var(--line); }
      .bar[data-grow="up"] .panel { margin:0 0 6px; border-top:0; border-bottom:1px solid var(--line); }
      .options { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:8px 14px; padding:10px 6px 2px; }
      .name { color:var(--muted); font-size:12px; }
      .field { display:flex; flex-direction:column; align-items:flex-start; gap:5px; min-width:0; }
      .note { color:var(--muted); font-size:11px; line-height:1.4; }
      output { font-size:12px; font-variant-numeric:tabular-nums; }
      .hints { display:flex; flex-wrap:wrap; gap:6px 12px; padding:10px 6px 4px; color:var(--muted); font-size:11px; }
      .bar[data-grow="up"] .hints { padding-bottom:10px; }
      .hints span { display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
      kbd { min-width:18px; padding:2px 4px; border-radius:5px; background:var(--inset); color:var(--fg); font:inherit; font-size:10.5px; text-align:center; }
      .message { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0; padding:8px 6px 2px 8px; font-size:12px; line-height:1.5; white-space:normal; }
      .bar[data-grow="up"] .message { padding:2px 6px 8px 8px; }
      #notice[data-kind="error"] .message { color:var(--danger); }
      .message button { height:26px; min-width:0; padding:0 10px; border-radius:8px; background:var(--inset); color:var(--fg); }

      /* The theme panel. It scrolls inside the room the window leaves for it. */
      .scroll { max-height:min(360px,var(--room,360px)); overflow-y:auto; overscroll-behavior:contain; }
      .line { display:flex; flex-direction:row; align-items:center; gap:6px; align-self:stretch; min-width:0; }
      .chips { display:flex; flex-wrap:wrap; align-items:center; gap:4px; min-width:0; }
      .chip { display:block; height:26px; min-width:0; max-width:12em; padding:0 10px; border-radius:8px; overflow:hidden; background:var(--inset); color:var(--muted); font-size:12px; line-height:26px; text-align:center; text-overflow:ellipsis; }
      .chip:hover { background:var(--inset); color:var(--fg); }
      .chip[aria-pressed="true"] { background:var(--ink); color:var(--ink-fg); }
      .chip.plain { background:none; color:var(--accent); }
      .chip.plain:hover { background:var(--hover); }
      .chip.solid,.chip.solid:hover { background:var(--ink); color:var(--ink-fg); }
      #themes .name { min-width:4em; }
      input { margin:0; font:inherit; }
      input[type="range"] { flex:1; width:0; min-width:70px; height:20px; accent-color:var(--accent); cursor:pointer; }
      input[type="color"] { flex:none; width:26px; height:26px; padding:0; border:0; border-radius:8px; overflow:hidden; background:none; box-shadow:0 0 0 1px var(--line); cursor:pointer; }
      input[type="color"]::-webkit-color-swatch-wrapper { padding:0; }
      input[type="color"]::-webkit-color-swatch { border:0; }
      input[type="text"] { flex:1; width:0; min-width:80px; height:26px; padding:0 8px; border:0; border-radius:8px; outline:none; background:var(--inset); color:var(--fg); font-size:12px; user-select:text; -webkit-user-select:text; }
      input:focus-visible { box-shadow:0 0 0 2px var(--accent); }
      .value { min-width:2.8em; text-align:right; }
      .swatch { position:relative; display:flex; }
      .swatch[data-changed]::before { content:""; position:absolute; right:-3px; top:-3px; z-index:1; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 1.5px var(--thumb); }
      .dot { position:absolute; right:4px; top:4px; width:7px; height:7px; border-radius:50%; background:var(--accent); scale:0; transition:scale .16s ease; }
      #theme[data-on] .dot { scale:1; }
      @media (max-width:380px) { #themes .options { grid-template-columns:1fr; gap:4px; } #themes .name { margin-top:6px; } }

      [data-tip]:not([data-tip=""])::after { content:attr(data-tip); position:absolute; left:50%; bottom:calc(100% + 12px); z-index:2; padding:6px 8px; border-radius:8px; background:var(--ink); color:var(--ink-fg);
        font-size:11px; font-weight:500; letter-spacing:0; line-height:1; white-space:pre; pointer-events:none; opacity:0; translate:-50% 4px; transition:opacity .12s ease,translate .12s ease; }
      [data-tip]:hover::after,[data-tip]:focus-visible::after { opacity:1; translate:-50% 0; transition-delay:.5s; }
      .bar[data-flip] [data-tip]::after { top:calc(100% + 12px); bottom:auto; }

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
        <button id="prev" class="icon" aria-label="上一个组件" data-tip="上一个组件  ↑">${icons.up}</button>
        <button id="next" class="icon" aria-label="下一个组件" data-tip="下一个组件  ↓">${icons.down}</button>
        <span class="lead" id="lead"></span>
        <i class="sep t"></i>
        ${segment("format", "导出格式", [["png", "PNG", "PNG 图片  P"], ["svg", "SVG", "SVG 矢量图  S"]], " t")}
        <button id="more" class="icon t" aria-label="导出选项" aria-expanded="false" data-tip="选项">${icons.options}</button>
        <button id="theme" class="icon t" aria-label="主题" aria-expanded="false" data-tip="主题">${icons.theme}<i class="dot"></i></button>
        <i class="sep t"></i>
        <button id="copy" class="t" data-tip=""><span class="glyph">${icons.copy}</span><span class="label">复制</span></button>
        <button id="download" class="t primary" data-tip="下载文件  ↵"><span class="glyph">${icons.download}</span><span class="label">下载</span></button>
        <i class="sep"></i>
        <button id="close" class="icon" aria-label="退出导出" data-tip="退出  Esc">${icons.close}</button>
      </div>
      <div class="fold" id="notice" role="status"><div><p class="message"><span id="notice-text"></span><button id="notice-action" hidden></button></p></div></div>
      <div class="fold t" id="drawer"><div><div class="panel">
        <div class="options">
          <span class="name" data-for="png">清晰度</span>
          <div class="field" data-for="png">${segment("scale", "清晰度", [["1", "1×"], ["2", "2×"], ["3", "3×"]])}</div>
          <span class="name" data-for="svg">文字</span>
          <div class="field" data-for="svg">${segment("text", "文字", [["live", "可编辑"], ["outline", "转为轮廓"]])}<span class="note" id="text-note"></span></div>
          <span class="name">背景</span>
          <div class="field">${segment("surface", "背景", [["page", "页面底色"], ["transparent", "透明"]])}</div>
          <span class="name">尺寸</span>
          <output id="size"></output>
        </div>
        <div class="hints">
          <span><kbd>↑</kbd><kbd>↓</kbd>切换组件</span><span><kbd>←</kbd><kbd>→</kbd>调整范围</span><span><kbd>↵</kbd>下载</span><span><kbd>${mac ? "⌘" : "Ctrl+"}C</kbd>复制</span><span><kbd>Esc</kbd>退出</span>
        </div>
      </div></div></div>
      <div class="fold t" id="themes"><div><div class="panel scroll">
        <div class="options">
          <span class="name">预设</span>
          <div class="field">
            <div class="chips"><span id="presets" style="display:contents"></span><button class="chip plain" id="preset-new">保存为预设</button><button class="chip plain" id="preset-delete">删除</button></div>
            <div class="line" id="preset-form" hidden><input type="text" id="preset-name" maxlength="40" placeholder="预设名称" aria-label="预设名称" spellcheck="false" autocomplete="off"><button class="chip solid" id="preset-save">保存</button></div>
          </div>
          <span class="name">配色</span>
          <div class="field">${segment("mode", "配色", [["page", "跟随页面"], ["light", "浅色"], ["dark", "深色"]])}</div>
          <span class="name">换色</span>
          <div class="field"><div class="chips"><span id="colors" style="display:contents"></span><button class="chip plain" id="colors-reset">还原</button></div><span class="note" id="colors-note"></span></div>
          <span class="name">字体</span>
          <div class="field">${segment("font", "字体", FONTS.map(([key, text]) => [key, text]))}</div>
          <span class="name">圆角</span>
          <div class="field"><div class="line">${slider("radius", "组件圆角倍数", 0, 3, 0.25)}</div></div>
          <span class="name">画布</span>
          <div class="field">
            ${segment("canvas-bg", "画布背景", [["none", "无"], ["solid", "纯色"], ["gradient", "渐变"]])}
            <div class="line" data-bg="solid gradient">${color("bg-color", "画布颜色", "solid")}${color("bg-from", "渐变起始色", "gradient")}${color("bg-to", "渐变结束色", "gradient")}<span class="line" data-bg="gradient" style="flex:1">${slider("bg-angle", "渐变角度", 0, 360, 15)}</span></div>
          </div>
          <span class="name">留白</span>
          <div class="field"><div class="line">${slider("padding", "画布留白", 0, 160, 4)}</div></div>
          <span class="name" data-bg="solid gradient">画布圆角</span>
          <div class="field" data-bg="solid gradient"><div class="line">${slider("canvas-radius", "画布圆角", 0, 64, 2)}</div></div>
          <span class="name" data-bg="solid gradient">阴影</span>
          <div class="field" data-bg="solid gradient">${segment("canvas-shadow", "画布阴影", [["none", "无"], ["soft", "柔和"], ["medium", "中等"], ["strong", "明显"]])}</div>
        </div>
      </div></div></div>
    </div>
    <div class="sr" id="live" aria-live="polite"></div>`;

  let session = null;
  let presets = {};          // saved themes by name

  function create() {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const host = document.createElement("div");
    host.id = "chatgpt-ui-exporter";
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
      // The canvas around the component counts; a font or radius change can still shift the result a little.
      const whole = Theme.geometry(Math.ceil(rect.width), Math.ceil(rect.height), settings.theme.canvas);
      $("size").textContent = `${Math.round(whole.width * factor)} × ${Math.round(whole.height * factor)}${settings.format === "png" ? " 像素" : ""}`;
    }

    // ---- theme --------------------------------------------------------------

    // Two themes are the same when they export the same way, whatever order their colours were replaced in.
    const fingerprint = theme => JSON.stringify({ ...theme, palette: Object.entries(theme.palette).sort() });
    const presetNames = () => Object.keys(presets).sort((a, b) => a.localeCompare(b, "zh"));
    // The saved preset the current theme matches, if any.
    const activePreset = () => {
      const now = fingerprint(settings.theme);
      return presetNames().find(name => fingerprint(Theme.normalize(presets[name])) === now) ?? null;
    };

    function syncPresets() {
      const box = $("presets");
      const plain = Theme.isDefault(settings.theme);
      const active = plain ? null : activePreset();
      const state = JSON.stringify([presetNames(), plain, active]);
      if (box.dataset.state !== state) {
        box.dataset.state = state;
        const focused = shadow.activeElement?.closest?.("#presets") ? shadow.activeElement.dataset.preset : null;
        box.replaceChildren(...[["", "默认", plain], ...presetNames().map(name => [name, name, name === active])].map(([name, text, on]) => {
          const chip = document.createElement("button");
          chip.className = "chip";
          chip.dataset.preset = name;
          chip.textContent = text;
          chip.setAttribute("aria-pressed", String(on));
          return chip;
        }));
        if (focused !== null) [...box.children].find(chip => chip.dataset.preset === focused)?.focus({ preventScroll: true });
      }
      const naming = !$("preset-form").hidden;
      // A theme can be saved once it differs from the default and from every saved one.
      $("preset-new").hidden = plain || active !== null || naming;
      $("preset-delete").hidden = active === null || naming;
    }

    function syncThemeControls() {
      const theme = settings.theme;
      const { canvas } = theme;
      const { background } = canvas;
      for (const node of shadow.querySelectorAll("[data-bg]")) node.hidden = !node.dataset.bg.split(" ").includes(background.type);
      syncSegment("mode", theme.mode);
      // A font from an older preset that is not on the list is kept, with no choice marked.
      syncSegment("font", FONTS.find(font => font[2] === theme.font)?.[0] ?? null);
      syncSegment("canvas-bg", background.type);
      syncSegment("canvas-shadow", canvas.shadow);
      for (const [id, value, text] of [
        ["radius", theme.radius, `${theme.radius}×`], ["padding", canvas.padding, canvas.padding],
        ["canvas-radius", canvas.radius, canvas.radius], ["bg-angle", background.angle, `${background.angle}°`]
      ]) {
        $(id).value = value;
        $(`${id}-value`).textContent = text;
      }
      for (const key of ["color", "from", "to"]) $(`bg-${key}`).value = Theme.formatOpaque(Theme.resolveColor(background[key]));
      for (const swatch of $("colors").children) {
        const replaced = theme.palette[swatch.dataset.key];
        swatch.toggleAttribute("data-changed", Boolean(replaced));
        swatch.firstElementChild.value = replaced || swatch.dataset.color;
      }
      $("colors-reset").hidden = Theme.isPlain(theme);
      $("theme").toggleAttribute("data-on", !Theme.isDefault(theme));
      syncPresets();
    }

    // Lists the component's colours so each can be replaced. Replacements are
    // keyed by the colours of the chosen colour mode, so they are read in it.
    function syncColors() {
      const node = current();
      if (!node || !$("themes").hasAttribute("data-open")) return;
      let found = [];
      let problem = "";
      try {
        found = globalThis.__chatgptUIExportCapture.colors(node, settings.theme).slice(0, MAX_SWATCHES);
      } catch (error) {
        problem = error.message || "无法读取组件颜色。";
      }
      $("colors").replaceChildren(...found.map(entry => {
        const swatch = document.createElement("label");
        swatch.className = "swatch";
        swatch.dataset.key = entry.key;
        swatch.dataset.color = entry.color;
        const input = document.createElement("input");
        input.type = "color";
        input.title = `${ROLES[entry.role]} ${entry.color}`;
        input.setAttribute("aria-label", `替换${ROLES[entry.role]}颜色 ${entry.color}`);
        swatch.append(input);
        return swatch;
      }));
      $("colors-note").textContent = problem || (found.length ? "点击色块，替换组件里的这种颜色。" : "这个组件没有可替换的颜色。");
      syncThemeControls();
    }

    function setTheme(theme) {
      settings.theme = Theme.normalize(theme);
      sync();
      save();
    }

    function restyle(change) {
      const next = structuredClone(settings.theme);
      change(next);
      setTheme(next);
    }

    function namePreset(open) {
      // The keyboard goes back to the bar before the field it was in is hidden.
      if (!open && shadow.activeElement?.closest("#preset-form")) bar.focus({ preventScroll: true });
      $("preset-form").hidden = !open;
      syncPresets();
      if (!open) return;
      $("preset-name").value = "";
      $("preset-name").focus({ preventScroll: true });
    }

    async function storePreset(name, theme) {
      if (!name) return;
      try {
        presets = await (theme ? Theme.savePreset(name, theme) : Theme.deletePreset(name));
        if (closed) return;
        namePreset(false);
        announce(theme ? `已保存预设 ${name}` : `已删除预设 ${name}`);
      } catch {
        if (!closed) notice(theme ? "无法保存预设，请重新加载扩展后重试。" : "无法删除预设，请重新加载扩展后重试。", { kind: "error" });
      }
    }

    const THEME_FIELDS = {
      radius: (theme, value) => { theme.radius = Number(value); },
      padding: (theme, value) => { theme.canvas.padding = Number(value); },
      "canvas-radius": (theme, value) => { theme.canvas.radius = Number(value); },
      "bg-angle": (theme, value) => { theme.canvas.background.angle = Number(value); },
      "bg-color": (theme, value) => { theme.canvas.background.color = value; },
      "bg-from": (theme, value) => { theme.canvas.background.from = value; },
      "bg-to": (theme, value) => { theme.canvas.background.to = value; }
    };
    const THEME_CHOICES = {
      font: (theme, value) => { theme.font = FONTS.find(font => font[0] === value)?.[2] || ""; },
      "canvas-bg": (theme, value) => { theme.canvas.background.type = value; },
      "canvas-shadow": (theme, value) => { theme.canvas.shadow = value; },
      // Replacement colours belong to one mode's colours, so they do not carry over.
      mode: (theme, value) => { if (theme.mode !== value) theme.palette = {}; theme.mode = value; }
    };

    // Opens the options or the theme panel, or closes the one that is open.
    function fold(id) {
      const opening = !$(id).hasAttribute("data-open");
      for (const [panel, trigger] of [["drawer", "more"], ["themes", "theme"]]) {
        const open = opening && panel === id;
        $(panel).toggleAttribute("data-open", open);
        $(trigger).setAttribute("aria-expanded", String(open));
      }
      if (!opening || id !== "themes") namePreset(false);
      aim();
      sync();
      syncColors();
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
      syncSegment("format", settings.format);
      syncSegment("scale", settings.scale);
      syncSegment("text", settings.outlined ? "outline" : "live");
      syncSegment("surface", settings.transparent ? "transparent" : "page");
      $("text-note").textContent = settings.outlined ? "在任何软件里外观一致，但文字不能再编辑。" : "文件小、可编辑；其他软件可能替换字体。";
      $("copy").dataset.tip = `${settings.format === "png" ? "复制图片" : "复制 SVG 代码"}  ${mac ? "⌘C" : "Ctrl+C"}`;
      syncThemeControls();
      syncSize();
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
      announce(text);
      if (timeout) noticeTimer = setTimeout(clearNotice, timeout);
    }

    function clearNotice() {
      clearTimeout(noticeTimer);
      noticeRun = null;
      $("notice").removeAttribute("data-open");
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
    function setIdle(text) {
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

    function select(node, { show = true } = {}) {
      if (!node || closed) return;
      if (node !== selected) {
        glide = { start: 0 };
        side = "above";
      }
      selected = node;
      selectedKey = Components.keyOf(node);
      hovered = null;
      pointerDirty = true;
      frame.style.borderRadius = radiusOf(node);
      setIdle(null);
      clearNotice();
      sync();
      syncColors();
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
        notice(direction > 0 ? "已经是最后一个组件了" : direction < 0 ? "已经是第一个组件了" : "没有更小或更大的范围了", { timeout: 1800 });
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

    async function copy(result) {
      try {
        if (result.format === "svg") await navigator.clipboard.writeText(await result.blob.text());
        else await navigator.clipboard.write([new ClipboardItem({ "image/png": result.blob })]);
      } catch {
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
          text: settings.outlined ? "outline" : "live", theme: settings.theme, signal: controller.signal
        });
        if (closed) return;
        if (kind === "copy") await copy(result);
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

    function draw(now) {
      if (closed) return;
      // Removed from outside, for example by a newer copy of this script.
      if (!host.isConnected) return close();
      raf = requestAnimationFrame(draw);
      const width = innerWidth;
      const height = innerHeight;
      const node = current();
      const rect = node?.getBoundingClientRect();
      if (rect?.width) {
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
      else if (!box) setIdle(selectedKey ? "选中的组件不在这一屏" : "这附近没有可导出的组件");

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
      // The theme panel scrolls inside whatever the window leaves on that side.
      const room = `${Math.max(120, Math.floor(bar.dataset.grow === "up" ? rowY - 8 : height - rowY - rowHeight - 8) - 20)}px`;
      if (bar.style.getPropertyValue("--room") !== room) bar.style.setProperty("--room", room);
      const y = bar.dataset.grow === "up" ? rowY + rowHeight - barHeight : rowY;
      x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, width - barWidth - MARGIN));
      bar.style.transform = `translate(${Math.round(x)}px,${Math.round(Math.max(y, 8))}px)`;
      bar.toggleAttribute("data-flip", y < 44);
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
      document.addEventListener(type, () => { if (seeking) stopSeek(); }, { capture: true, passive: true, signal });
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
      if (focused?.localName === "input" && (key !== "Escape" || event.isComposing)) {
        // Typing and slider keys belong to the field, and stay out of the page's shortcuts.
        event.stopImmediatePropagation();
        if (key === "Enter" && focused.id === "preset-name" && !event.isComposing) $("preset-save").click();
        return;
      }
      if (event.isComposing || event.defaultPrevented) return;
      // Esc leaves the preset name first, then the picker.
      if (key === "Escape" && focused?.id === "preset-name") { take(); namePreset(false); return bar.focus({ preventScroll: true }); }
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
        default:
      }
    }, { capture: true, signal });

    bar.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      const group = button.closest(".seg");
      if (group) {
        if (busy) return;
        const value = button.dataset.value;
        if (group.id === "format") return setFormat(value);
        if (THEME_CHOICES[group.id]) {
          restyle(theme => THEME_CHOICES[group.id](theme, value));
          if (group.id === "mode") syncColors();
          return;
        }
        if (group.id === "scale") settings.scale = Number(value);
        else if (group.id === "text") settings.outlined = value === "outline";
        else settings.transparent = value === "transparent";
        sync();
        return save();
      }
      if (button.dataset.preset !== undefined) {
        if (busy) return;
        namePreset(false);
        setTheme(button.dataset.preset ? presets[button.dataset.preset] : Theme.defaults());
        return syncColors();
      }
      switch (button.id) {
        case "prev": return step(-1);
        case "next": return step(1);
        case "copy": return run("copy");
        case "download": return run("download");
        case "close": return close();
        case "notice-action": return noticeRun?.();
        case "more": return fold("drawer");
        case "theme": return fold("themes");
        case "colors-reset": return restyle(theme => { theme.palette = {}; });
        case "preset-new": return namePreset(true);
        case "preset-delete": return storePreset(activePreset(), null);
        case "preset-save": {
          const name = $("preset-name").value.trim();
          return name ? storePreset(name, settings.theme) : $("preset-name").focus({ preventScroll: true });
        }
        default:
      }
    }, { signal });
    bar.addEventListener("input", event => {
      const input = event.target;
      const swatch = input.closest(".swatch");
      if (swatch) restyle(theme => { theme.palette[swatch.dataset.key] = input.value; });
      else if (THEME_FIELDS[input.id]) restyle(theme => THEME_FIELDS[input.id](theme, input.value));
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
      for (const timer of stateTimers.values()) clearTimeout(timer);
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
    restored.then(() => { if (!closed) sync(); });
    bar.focus({ preventScroll: true });
    raf = requestAnimationFrame(draw);
    const api = { start, close };
    return api;
  }

  function open(target) {
    if (!Components || !Theme || !globalThis.__chatgptUIExportRenderer) return;
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
