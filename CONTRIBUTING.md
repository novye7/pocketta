# 参与 Pocketta 开发

## 运行与检查

扩展直接从 `extension/` 加载。修改代码后，在扩展管理页点击重新加载，然后刷新用于验证的对话页。

静态检查只需要 Node.js 和 npm。浏览器回归另外使用 agent-browser 及其 Chromium。以下组合已在 macOS、Node.js 24.x 上验证。

```sh
npm run check

npm install --global agent-browser@0.38.2
agent-browser install
npm run test:browser
```

可单独运行一组，例如 `npm run test:browser -- renderer`。测试脚本使用独立浏览器会话，拦截测试页请求并注入本地夹具，无需登录 ChatGPT。

| 测试组 | 验收内容 |
| --- | --- |
| `renderer` | PNG 尺寸和透明度、SVG 图形与文字、外部资源、转曲、取消与失败提示 |
| `picker` | 悬停入口、选区层级、键盘、复制和下载、离屏返回和对话虚拟滚动 |
| `layout` | 窄屏布局、选项开合、导出尺寸变化 |
| `fidelity` | 浏览器绘制的 DOM 截图与导出 SVG 在 1×、2× 下的逐组件对照 |

视觉回归将参考截图、差异图和 JSON 报告写入本地 `.scratchpad/`。修复绘制偏差时，请用最小组件复现，并用浏览器原始截图作为参照。

## 代码从哪里读起

- [components.js](extension/components.js) 识别组件、父子选区和选择位置。[picker.js](extension/picker.js) 管理工具条与交互。
- [exporter.js](extension/exporter.js) 是两种格式的公共入口。[capture.js](extension/capture.js) 采集布局、资源和当前表单状态。
- [raster.js](extension/raster.js) 通过浏览器排版生成 PNG。[native-svg.js](extension/native-svg.js) 组合原生矢量元素，[vector-source.js](extension/vector-source.js) 处理已有 SVG 和图表标签，[outline.js](extension/outline.js) 处理文字转曲。

## 报告导出问题

请注明浏览器和系统、组件类型、选中范围、导出格式，以及复现步骤。涉及文字时，请补充「可编辑」还是「转为轮廓」。涉及 PNG 时，请补充倍率与背景选项。原组件和导出结果的局部对照图有助于定位偏差，示例请使用可公开的文字和数据。
