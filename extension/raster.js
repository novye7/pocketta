(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__chatgptUIExportRaster?.version === VERSION) return;

  const MAX_PIXELS = 32_000_000;
  const MAX_DIMENSION = 16_384;

  function assertActive(signal) {
    if (signal?.aborted) throw new DOMException("导出已取消", "AbortError");
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

  function decode(svg) {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("浏览器无法渲染这个组件，请尝试缩小选取范围。"));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return loaded.then(() => image);
  }

  /**
   * Renders the styled clone through the browser's own layout engine.
   */
  async function render({ clone, rules, ambient, surface = "page", scale = 2, width, height, signal }) {
    assertActive(signal);
    if (width * scale > MAX_DIMENSION || height * scale > MAX_DIMENSION || width * height * scale * scale > MAX_PIXELS) {
      throw new Error("图片过大，请选择 1× 清晰度或缩小选取范围。");
    }
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.style.cssText = `width:${width}px;height:${height}px;overflow:hidden;`;
    if (rules) {
      const style = document.createElement("style");
      style.textContent = rules;
      wrapper.append(style);
    }
    wrapper.append(clone);
    const html = new XMLSerializer().serializeToString(wrapper);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    return rasterize(svg, width, height, scale, surface === "transparent" ? null : ambient, signal);
  }

  // Rasterize the exported vector itself so both clipboard representations
  // preserve the same background, geometry and text mode.
  async function preview(result, signal) {
    const { width, height } = result;
    const scale = Math.min(2, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_PIXELS / (width * height)));
    const png = await rasterize(await result.blob.text(), width, height, scale, null, signal);
    return png.blob;
  }

  async function rasterize(svg, width, height, scale, ambient, signal) {
    assertActive(signal);
    const image = await bounded(decode(svg), signal, 15_000, "渲染超时，请缩小选取范围后重试。");
    assertActive(signal);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片，请缩小选取范围。");
    context.scale(canvas.width / width, canvas.height / height);
    if (ambient) {
      context.fillStyle = ambient;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    let blob;
    try {
      blob = await bounded(new Promise(resolve => canvas.toBlob(resolve, "image/png")), signal, 15_000, "生成 PNG 超时。");
    } catch (error) {
      if (error.name === "SecurityError") throw new Error("组件包含无法读取的跨域资源，请缩小选取范围。");
      throw error;
    }
    assertActive(signal);
    if (!blob) throw new Error("PNG 生成失败，请尝试 1× 清晰度。");
    return { blob, width: canvas.width, height: canvas.height, format: "png" };
  }

  globalThis.__chatgptUIExportRaster = Object.freeze({ version: VERSION, render, preview, MAX_PIXELS, MAX_DIMENSION });
})();
