(() => {
  "use strict";
  const VERSION = "0.9.0";
  if (location.origin !== "https://chatgpt.com") return;
  const existing = globalThis.__chatgptUIExportHover;
  if (existing?.version === VERSION) return;
  existing?.dispose?.();
  // A copy orphaned by an extension reload may live out of reach; its element is not.
  document.getElementById("chatgpt-ui-exporter-hover")?.remove();
  const Components = globalThis.__chatgptUIExportComponents;
  if (!Components) return;

  // Always on, and deliberately small: it shows an export button over a UI
  // component and hands that component to the picker, which is injected on
  // first use.
  const SHOW_DELAY = 90;
  const HIDE_DELAY = 260;
  const SIZE = 30;
  const INSET = 8;
  const GAP = 3;
  const TOP_SAFE = 60;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const host = document.createElement("div");
  host.id = "chatgpt-ui-exporter-hover";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { --accent:#0a7cff; --surface:rgba(255,255,255,.92); --fg:#0d0d0d; --line:rgba(0,0,0,.1); --hover:#fff; --shadow:0 4px 14px rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.1); }
      :host([data-theme="dark"]) { --accent:#4c9dff; --surface:rgba(56,56,58,.92); --fg:#f5f5f7; --line:rgba(255,255,255,.16); --hover:#48484a; --shadow:0 4px 14px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.3); }
      .ring { position:fixed; left:0; top:0; opacity:0; pointer-events:none; box-shadow:0 0 0 2px var(--accent),0 0 0 6px color-mix(in srgb,var(--accent) 20%,transparent); transition:opacity .14s ease; }
      .ring[data-on] { opacity:1; }
      button { all:unset; position:fixed; left:0; top:0; box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:${SIZE}px; height:${SIZE}px; border-radius:9px; cursor:pointer;
        background:var(--surface); color:var(--fg); border:1px solid var(--line); box-shadow:var(--shadow); -webkit-backdrop-filter:blur(12px) saturate(1.6); backdrop-filter:blur(12px) saturate(1.6);
        opacity:0; scale:.86; transform-origin:top right; pointer-events:none; transition:opacity .14s ease,scale .18s cubic-bezier(.2,.9,.3,1.2),background .12s ease,color .12s ease; }
      button[data-on] { opacity:1; scale:1; pointer-events:auto; }
      button:hover { background:var(--accent); color:#fff; border-color:transparent; }
      button:active { scale:.94; }
      svg { width:17px; height:17px; }
      @media (prefers-reduced-motion:reduce) { .ring,button { transition:none; } }
    </style>
    <div class="ring"></div>
    <button tabindex="-1" aria-label="导出这个组件" title="导出这个组件">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8m8 0h1.5A2.5 2.5 0 0 1 20 6.5V8m0 8v1.5a2.5 2.5 0 0 1-2.5 2.5H16m-8 0H6.5A2.5 2.5 0 0 1 4 17.5V16"/><path d="M12 8v7.5m-3-3 3 3 3-3"/></svg>
    </button>`;
  const chip = shadow.querySelector("button");
  const ring = shadow.querySelector(".ring");
  let target = null;      // the component the button is attached to
  let candidate = null;   // the component under the pointer, waiting out the delay
  let lastNode = null;
  let lastFound = null;
  let showTimer = 0;
  let hideTimer = 0;
  let frame = 0;

  // After the extension is reloaded this copy can no longer reach it.
  const alive = () => {
    try { return Boolean(chrome.runtime?.id); } catch { return false; }
  };
  const pickerActive = () => Boolean(globalThis.__chatgptUIExportPicker?.active);

  function dispose() {
    lifetime.abort();
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    cancelAnimationFrame(frame);
    host.remove();
    if (globalThis.__chatgptUIExportHover === api) delete globalThis.__chatgptUIExportHover;
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = 0;
    target = candidate = null;
    chip.removeAttribute("data-on");
    ring.removeAttribute("data-on");
  }

  function place() {
    if (!target?.isConnected || pickerActive()) return hide();
    const rect = target.getBoundingClientRect();
    if (!rect.width || rect.bottom < TOP_SAFE || rect.top > innerHeight - 24) return hide();
    // Stays on the visible part of a component that is taller or wider than the window.
    const x = Math.min(rect.right, innerWidth) - SIZE - INSET;
    const y = rect.height < SIZE + INSET * 2
      ? rect.top + (rect.height - SIZE) / 2
      : Math.min(Math.max(rect.top + INSET, TOP_SAFE), rect.bottom - SIZE - INSET);
    // Independent translation keeps the corner fixed while the button scales in.
    chip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    ring.style.transform = `translate(${rect.left - GAP}px,${rect.top - GAP}px)`;
    ring.style.width = `${rect.width + GAP * 2}px`;
    ring.style.height = `${rect.height + GAP * 2}px`;
  }

  function show(node) {
    target = node;
    candidate = null;
    if (!host.isConnected) document.documentElement.append(host);
    const root = document.documentElement;
    host.dataset.theme = getComputedStyle(root).colorScheme === "dark" || root.classList.contains("dark") ? "dark" : "light";
    ring.style.borderRadius = `${Math.min(40, Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0) + GAP}px`;
    place();
    if (target) chip.setAttribute("data-on", "");
  }

  document.addEventListener("pointermove", event => {
    if (!alive()) return dispose();
    if (event.composedPath().includes(host)) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      return;
    }
    const node = event.target;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (node !== lastNode) {
        lastNode = node;
        lastFound = Components.top(node);
      }
      const found = pickerActive() || !lastFound?.isConnected ? null : lastFound;
      if (!found) {
        candidate = null;
        clearTimeout(showTimer);
        // A short grace period lets the pointer travel to the button.
        if (target && !hideTimer) hideTimer = setTimeout(hide, HIDE_DELAY);
        return;
      }
      clearTimeout(hideTimer);
      hideTimer = 0;
      if (found === target || found === candidate) return;
      clearTimeout(showTimer);
      if (target) return show(found);
      // Waiting a moment keeps the button from flashing while the pointer sweeps past.
      candidate = found;
      showTimer = setTimeout(() => { if (candidate?.isConnected) show(candidate); }, SHOW_DELAY);
    });
  }, { capture: true, passive: true, signal });
  document.addEventListener("scroll", () => { if (target) place(); }, { capture: true, passive: true, signal });
  document.documentElement.addEventListener("pointerleave", hide, { signal });
  window.addEventListener("resize", hide, { passive: true, signal });

  chip.addEventListener("pointerenter", () => { if (target) ring.setAttribute("data-on", ""); }, { signal });
  chip.addEventListener("pointerleave", () => ring.removeAttribute("data-on"), { signal });
  // The page should neither see these events nor lose its focus to the button.
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"]) {
    chip.addEventListener(type, event => {
      event.stopPropagation();
      if (type === "mousedown") event.preventDefault();
    }, { signal });
  }
  chip.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const node = target;
    hide();
    if (!node?.isConnected) return;
    if (!alive()) return dispose();
    const picker = globalThis.__chatgptUIExportPicker;
    if (picker?.version === VERSION) return picker.open(node);
    // The picker is injected into this same isolated world and starts with this element.
    globalThis.__chatgptUIExportTarget = node;
    chrome.runtime.sendMessage({ type: "chatgpt-ui-export:start" }).catch(() => {
      delete globalThis.__chatgptUIExportTarget;
      dispose();
    });
  }, { signal });

  const api = Object.freeze({ version: VERSION, dispose });
  globalThis.__chatgptUIExportHover = api;
})();
