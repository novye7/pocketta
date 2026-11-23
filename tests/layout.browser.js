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
  const ui = () => [...document.querySelectorAll("#chatgpt-ui-exporter")].at(-1).shadowRoot;
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
    return checks;
  } finally {
    picker.close();
    host.remove();
  }
})();
