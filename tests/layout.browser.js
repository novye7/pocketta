// Run at 280 × 900 after the extension scripts, on an empty fixture page.
(async () => {
  const checks = [];
  const picker = globalThis.__chatgptUIExportPicker;
  const host = document.createElement("div");
  host.setAttribute("data-dil-message-id", "layout-fixture");
  host.innerHTML = '<div data-d-component="box" style="position:fixed;left:8px;top:260px;width:264px;padding:16px;box-sizing:border-box;border:1px solid #ccc;border-radius:12px;background:white;color:black;">窄窗口里的组件</div>';
  document.body.append(host);
  const wait = async predicate => {
    const end = performance.now() + 3000;
    while (!predicate()) {
      if (performance.now() > end) throw new Error("Layout did not settle");
      await new Promise(requestAnimationFrame);
    }
  };
  const ui = () => [...document.querySelectorAll("#pocketta")].at(-1).shadowRoot;
  const assert = (value, message) => { if (!value) throw new Error(`Failed: ${message}`); checks.push(message); };
  try {
    picker.open(host.firstElementChild);
    await wait(() => ui().getElementById("bar").hasAttribute("data-ready"));
    for (const format of ["png", "svg"]) {
      ui().querySelector(`#format [data-value="${format}"]`).click();
      for (const open of [false, true]) {
        const drawer = ui().getElementById("drawer");
        if (drawer.hasAttribute("data-open") !== open) ui().getElementById("more").click();
        await new Promise(requestAnimationFrame);
        await Promise.all(ui().getAnimations().map(animation => animation.finished));
        await new Promise(requestAnimationFrame);
        const bar = ui().getElementById("bar").getBoundingClientRect();
        assert(bar.left >= 0 && bar.right <= innerWidth && bar.top >= 0 && bar.bottom <= innerHeight, `${format} toolbar fits a 280px window with options ${open ? "open" : "closed"}`);
        const visible = [...ui().querySelectorAll("button")].filter(button => button.checkVisibility({visibilityProperty:true}));
        assert(visible.every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bar.left && rect.right <= bar.right && rect.top >= bar.top && rect.bottom <= bar.bottom; }), `${format} controls stay inside the toolbar with options ${open ? "open" : "closed"}`);
      }
    }
    // The SVG options are open, so every tooltip can be reached.
    const tip = ui().getElementById("tip");
    const text = ui().getElementById("tip-text");
    // It keeps 8px from the window edges, give or take a rounded width.
    const inside = box => box.left >= 6.5 && box.right <= innerWidth - 6.5;
    const hover = async button => {
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true }));
      await wait(() => tip.hasAttribute("data-on") && text.textContent === button.dataset.tip);
      const box = tip.getBoundingClientRect();
      const lines = text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight);
      button.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, composed: true }));
      return { box, lines };
    };
    for (const button of ui().querySelectorAll("#bar button[data-tip]")) {
      if (!button.checkVisibility({visibilityProperty:true})) continue;
      const { box } = await hover(button);
      assert(inside(box), `"${button.dataset.tip}" tooltip stays inside a 280px window`);
    }
    // One longer than the window gives way, instead of running past its edge.
    const download = ui().getElementById("download");
    const { tip: wording } = download.dataset;
    download.dataset.tip = "说明".repeat(60);
    const { box, lines } = await hover(download);
    assert(inside(box) && lines > 2, "A tooltip longer than the window wraps inside it");
    download.dataset.tip = wording;
    const source = host.firstElementChild;
    source.style.width = "232px";
    await wait(() => ui().getElementById("size").textContent.startsWith("232 × "));
    assert(ui().querySelector(".dimensions").textContent.endsWith("px"), "Open SVG dimensions follow a resized selection and include pixel units");
    const rowTop = id => ui().getElementById(id).getBoundingClientRect().top;
    assert(rowTop("prev") < rowTop("copy") && Math.abs(rowTop("copy") - rowTop("close")) < 1, "Narrow layout keeps copy, download and close on the second row");
    return checks;
  } finally {
    picker.close();
    host.remove();
  }
})();
