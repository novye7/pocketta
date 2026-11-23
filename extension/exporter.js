(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__chatgptUIExportRenderer?.version === VERSION) return;

  /**
   * Exports a ChatGPT intelligent UI component.
   *
   * options:
   *   format   "png" | "svg"
   *   scale    1 | 2 | 3                 (PNG only)
   *   surface  "page" | "transparent"    fill behind the component
   *   text     "live" | "outline"        SVG only: keep text, or convert it to paths
   *   signal   AbortSignal
   *
   * An error carries `fallback: "png"` when the component is beyond the SVG
   * renderer but a PNG would still work.
   */
  async function render(source, { format = "png", scale = 2, surface = "page", text = "live", signal } = {}) {
    if (signal?.aborted) throw new DOMException("导出已取消", "AbortError");
    if (!(source instanceof HTMLElement) || !source.isConnected) throw new Error("选中的组件已不存在，请重新选择。");
    if (!["png", "svg"].includes(format)) throw new Error("不支持的导出格式。");
    if (format === "png" && ![1, 2, 3].includes(scale)) throw new Error("请选择 1×、2× 或 3× 清晰度。");
    if (!["page", "transparent"].includes(surface)) throw new Error("不支持的背景选项。");
    if (!["live", "outline"].includes(text)) throw new Error("不支持的文字选项。");
    try {
      // Only the SVG renderer needs the measured scene.
      const capture = await globalThis.__chatgptUIExportCapture.build(source, { signal, scene: format === "svg" });
      if (format === "svg") {
        const result = globalThis.__chatgptUIExportSVG.render({
          scene: capture.scene, ambient: capture.ambient, surface, outline: text === "outline", signal
        });
        return {
          blob: new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
          width: result.width, height: result.height, format
        };
      }
      return await globalThis.__chatgptUIExportRaster.render({
        clone: capture.clone, rules: capture.rules,
        ambient: capture.ambient, surface, scale, width: capture.width, height: capture.height, signal
      });
    } catch (error) {
      if (format === "svg" && error?.name !== "AbortError" && /PNG/.test(error?.message || "")) error.fallback = "png";
      throw error;
    }
  }

  globalThis.__chatgptUIExportRenderer = Object.freeze({ version: VERSION, render });
})();
