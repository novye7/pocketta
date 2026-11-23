// Screenshot oracle: the reference is the live DOM painted by Chromium,
// independent of capture.js, the PNG exporter and the SVG geometry code.
(() => {
  let host;
  let samples = [];
  const cases = [
    ["wide-pill", 742, 36, "border-radius:9999px;"],
    ["vertical-pill", 36, 120, "border-radius:9999px;"],
    ["circle", 100, 100, "border-radius:9999px;"],
    ["percentage-ellipse", 240, 80, "border-radius:50%;"],
    ["one-large-corner", 240, 100, "border-radius:180px 0 0 0 / 90px 0 0 0;"],
    ["overlapping-corners", 240, 80, "border-radius:180px 120px 70px 50px / 90px 100px 50px 70px;"],
    ["percentage-corners", 240, 100, "border-radius:80% 20% 70% 10% / 60% 40% 80% 20%;"],
    ["zero-axis", 240, 100, "border-radius:200px 80px 40px 30px / 0 90px 50px 30px;"],
    ["bordered-pill", 240, 64, "border:8px solid #cc4422;border-radius:9999px;"],
    ["bordered-asymmetric", 240, 100, "border:6px solid #cc4422;border-radius:180px 30px 80px 60px / 60px 90px 30px 80px;"],
    ["clipped-pill", 240, 80, "border-radius:9999px;overflow:hidden;", '<div style="width:300px;height:100px;background:#1678bc;"></div>'],
    ["clipped-asymmetric", 240, 100, "border-radius:180px 120px 70px 50px / 90px 100px 50px 70px;overflow:hidden;", '<div style="width:300px;height:120px;background:#1678bc;"></div>'],
    ["elliptical-lengths", 240, 100, "border-radius:90px / 25px;"],
    ["small-corners", 240, 80, "border-radius:12px;"],
    ["square-corners", 240, 80, "border-radius:0;"],
    ["inset-ring", 240, 80, "border-radius:9999px;box-shadow:inset 0 0 0 5px #cc4422;"]
  ];
  const image = async url => {
    const node = new Image();
    node.src = url;
    await node.decode();
    return node;
  };
  // CSS and SVG rasterizers can assign different coverage to a boundary pixel.
  // Require each colour to fit the other image's local colour range in BOTH
  // directions, with a tolerance of one physical pixel (half a CSS px at 2x).
  // Large shape changes and interior colour errors remain outside that range;
  // subpixel details still need dedicated fixtures or visual inspection.
  const withinEdge = (color, nearby, index, width, height) => {
    const x = index % width, y = Math.floor(index / width);
    for (let channel = 0; channel < 3; channel++) {
      let low = 255, high = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const value = nearby[(ny * width + nx) * 4 + channel];
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      if (color[index * 4 + channel] < low - 32 || color[index * 4 + channel] > high + 32) return false;
    }
    return true;
  };
  const cleanup = () => { host?.remove(); samples = []; };
  async function setup() {
    cleanup();
    globalThis.__chatgptUIExportPicker?.close();
    host = document.createElement("div");
    host.style.cssText = "position:absolute;inset:0 auto auto 0;width:1280px;height:1000px;background:#fff;color:#111;z-index:2147483647;font:14px sans-serif;";
    document.body.append(host);
    for (const [index, [name, width, height, style, html = ""]] of cases.entries()) {
      const x = index === 0 ? 16 : 16 + ((index - 1) % 3) * 400;
      const y = index === 0 ? 36 : 130 + Math.floor((index - 1) / 3) * 170;
      const label = document.createElement("div");
      label.style.cssText = `position:absolute;left:${x}px;top:${y - 24}px;`;
      label.textContent = name;
      const node = document.createElement("div");
      node.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;box-sizing:border-box;background:#0d0d0d;${style}`;
      node.innerHTML = html;
      host.append(label, node);
      const result = await globalThis.__chatgptUIExportRenderer.render(node, { format: "svg", surface: "transparent" });
      samples.push({ name, node, svg: await result.blob.text() });
    }
    return samples.map(sample => sample.name);
  }
  async function compare(screenshot) {
    const reference = await image(screenshot);
    const scale = reference.naturalWidth / innerWidth;
    const source = document.createElement("canvas");
    source.width = reference.naturalWidth;
    source.height = reference.naturalHeight;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(reference, 0, 0);
    const actual = document.createElement("canvas");
    const output = actual.getContext("2d", { willReadFrequently: true });
    const report = [];
    const proof = document.createElement("canvas");
    proof.width = 1200;
    proof.height = samples.length * 150;
    const proofContext = proof.getContext("2d");
    proofContext.fillStyle = "white";
    proofContext.fillRect(0, 0, proof.width, proof.height);
    for (const [index, sample] of samples.entries()) {
      const rect = sample.node.getBoundingClientRect();
      const x = Math.round(rect.x * scale), y = Math.round(rect.y * scale);
      const width = Math.round(rect.width * scale), height = Math.round(rect.height * scale);
      if (x < 0 || y < 0 || x + width > source.width || y + height > source.height) throw new Error(`${sample.name}: fixture is outside screenshot`);
      const expected = context.getImageData(x, y, width, height);
      actual.width = width;
      actual.height = height;
      output.fillStyle = "white";
      output.fillRect(0, 0, width, height);
      output.drawImage(await image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sample.svg)}`), 0, 0, width, height);
      const pixels = output.getImageData(0, 0, width, height);
      const heat = output.createImageData(width, height);
      let raw = 0, far = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const difference = Math.max(...[0, 1, 2].map(channel => Math.abs(pixels.data[i + channel] - expected.data[i + channel])));
        const edge = difference > 32 &&
          withinEdge(pixels.data, expected.data, i / 4, width, height) &&
          withinEdge(expected.data, pixels.data, i / 4, width, height);
        if (difference > 32) raw++;
        if (difference > 32 && !edge) far++;
        heat.data.set(difference <= 32 ? [255, 255, 255, 255] : edge ? [245, 190, 60, 255] : [220, 0, 80, 255], i);
      }
      const ratio = far / (width * height);
      report.push({ name: sample.name, scale, rawDifferentPixels: raw, differentPixels: far, ratio, passed: ratio < 0.007 });
      const drawWidth = Math.min(370, rect.width), drawHeight = rect.height * drawWidth / rect.width;
      const top = index * 150;
      proofContext.fillStyle = "#111";
      proofContext.font = "14px sans-serif";
      proofContext.fillText(`${sample.name}: DOM | SVG | diff (${(ratio * 100).toFixed(3)}%)`, 8, top + 18);
      proofContext.drawImage(source, x, y, width, height, 8, top + 26, drawWidth, drawHeight);
      proofContext.drawImage(actual, 408, top + 26, drawWidth, drawHeight);
      output.putImageData(heat, 0, 0);
      proofContext.drawImage(actual, 808, top + 26, drawWidth, drawHeight);
    }
    return { report, proof: proof.toDataURL("image/png").split(",")[1] };
  }
  globalThis.__uiExportFidelity = { setup, compare, cleanup };
})();
