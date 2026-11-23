// Evaluate in a browser document after the extension scripts (color, capture, native-svg, raster, exporter); no test dependencies.
(async () => {
  const checks = [];
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    checks.push(message);
  };
  const render = globalThis.__chatgptUIExportRenderer.render;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;z-index:-2147483647;background:rgb(244,244,244);";
  host.innerHTML = `<style>#ui-export-alpha-fixture::before {content:"";position:absolute;left:20px;top:130px;width:40px;height:10px;background:rgb(150,150,150);}
    .ui-export-marker {position:absolute;left:205px;top:126px;width:24px;height:24px;counter-increment:ui-export-test 7;}
    .ui-export-marker::before {content:counter(ui-export-test);display:block;font:700 20px/24px system-ui;color:rgb(200,0,0);text-align:center;}</style>
    <div id="ui-export-alpha-fixture" style="position:relative;width:240px;height:160px;margin:16px;border:1px solid black;border-radius:20px;color:black;font:16px/24px system-ui;box-sizing:border-box;">
      <div style="position:absolute;left:20px;top:20px;width:60px;height:40px;background:white;border-radius:8px;"></div>
      <button style="position:absolute;left:100px;top:20px;width:100px;height:40px;background:black;color:white;border:0;border-radius:20px;">PNG</button>
      <span style="position:absolute;left:20px;top:80px;">文字 · Text</span>
      <input type="checkbox" style="position:absolute;left:180px;top:100px;">
    </div>`;
  document.documentElement.append(host);
  const fixture = host.querySelector("#ui-export-alpha-fixture");
  fixture.querySelector("input").checked = true;
  const original = fixture.outerHTML;
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.innerHTML = '<symbol id="ui-export-test-symbol" viewBox="0 0 24 24"><path d="M4 4h16v16H4Z" fill="currentColor"/></symbol>';
  host.append(sprite);
  sprite.style.display = "none";
  const pixels = async result => {
    let bitmap;
    if (result.blob.type.startsWith("image/svg+xml")) {
      bitmap = new Image();
      bitmap.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await result.blob.text())}`;
      await bitmap.decode();
    } else {
      bitmap = await createImageBitmap(result.blob);
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { at: (x, y) => [...context.getImageData(x, y, 1, 1).data], data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  };
  try {
    const clear = await render(fixture, { scale: 1, surface:"transparent" });
    const clearPixels = await pixels(clear);
    assert(clear.width === 240 && clear.height === 160, "Transparent PNG excludes external margins");
    assert(clearPixels.at(0, 0)[3] === 0 && clearPixels.at(10, 60)[3] === 0, "Corners and empty content have alpha 0");
    assert(clearPixels.at(40, 40).join() === "255,255,255,255", "White component surfaces remain opaque");
    assert(clearPixels.at(120, 40).join() === "0,0,0,255", "Black controls remain opaque");
    assert(clearPixels.at(30, 135).join() === "150,150,150,255", "Pseudo-element surfaces survive");
    assert(clearPixels.data.some((value, index) => index % 4 === 3 && value > 0 && value < 255), "Antialiasing retains partial alpha");

    const double = await render(fixture, { scale: 2, surface:"transparent" });
    assert(double.width === 480 && double.height === 320 && (await pixels(double)).at(20, 120)[3] === 0, "2x PNG retains transparency");
    const filled = await render(fixture, { scale: 1 });
    assert((await pixels(filled)).at(10, 60).join() === "244,244,244,255", "Default page fill is unchanged");
    assert(fixture.outerHTML === original && fixture.querySelector("input").checked, "Rendering preserves source DOM and live state");

    fixture.style.backgroundColor = "white";
    const opaqueSource = await render(fixture, { surface:"transparent", scale: 1 });
    assert((await pixels(opaqueSource)).at(10, 60).join() === "255,255,255,255", "Source-owned background is preserved in transparent mode");
    fixture.style.backgroundColor = "";
    try { await render(fixture, {surface:"invalid"}); throw new Error("Expected background rejection"); }
    catch (error) { assert(error.message.includes("背景选项"), "Invalid background option is rejected"); }
    const controller = new AbortController();
    controller.abort();
    try { await render(fixture, {signal:controller.signal}); throw new Error("Expected cancellation"); }
    catch (error) { assert(error.name === "AbortError", "Cancellation remains effective"); }
    Object.assign(fixture.style, { boxSizing: "content-box", paddingBottom: "20px" });
    const padded = await render(fixture, { scale: 1, surface: "transparent" });
    assert(padded.height === 182 && (await pixels(padded)).at(120, 181).join() === "0,0,0,255", "A content-box component keeps its padding and border in PNG");
    Object.assign(fixture.style, { boxSizing: "border-box", paddingBottom: "" });
    const canvas = document.createElement("canvas");
    fixture.append(canvas);
    try { await render(fixture); throw new Error("Expected unsupported content rejection"); }
    catch (error) { assert(error.message.includes("Canvas"), "Unsupported content still fails explicitly"); }
    canvas.remove();
    const marker = document.createElement("span");
    marker.className = "ui-export-marker";
    fixture.append(marker);
    const inked = (data, left, top, size) => {
      for (let y = top; y < top + size; y++) for (let x = left; x < left + size; x++) {
        const at = (y * 240 + x) * 4;
        if (data[at] > 150 && data[at + 1] < 80 && data[at + 3] > 150) return true;
      }
      return false;
    };
    assert(inked((await pixels(await render(fixture, { scale: 1, surface: "transparent" }))).data, 205, 126, 24), "Pseudo-element text is exported to PNG");
    const triple = await render(fixture, { scale: 3, surface: "transparent" });
    assert(triple.width === 720 && triple.height === 480, "3x PNG is available");
    marker.remove();
    const rotated = document.createElement("div");
    rotated.style.cssText = "position:absolute;left:100px;top:100px;width:20px;height:20px;background:rgb(0,0,200);transform:rotate(10deg);";
    fixture.append(rotated);
    try { await render(fixture, { format: "svg" }); throw new Error("Expected SVG rejection"); }
    catch (error) { assert(error.fallback === "png" && error.message.includes("PNG"), "SVG-only limits point to PNG as the fallback"); }
    assert((await render(fixture, { scale: 1 })).format === "png", "The same component still exports as PNG");
    rotated.remove();
    fixture.style.borderRadius = "calc(50% - 2px)";
    try { await render(fixture, { format: "svg" }); throw new Error("Expected radius expression rejection"); }
    catch (error) { assert(error.fallback === "png" && error.message.includes("圆角表达式"), "Unsupported radius expressions offer PNG instead of silently losing corners"); }
    assert((await render(fixture, { scale: 1 })).format === "png", "PNG retains browser support for calculated radii");
    fixture.style.borderRadius = "20px";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.style.cssText = "position:absolute;left:180px;top:70px;width:24px;height:24px;color:blue;";
    icon.innerHTML = '<use href="#ui-export-test-symbol"/>';
    fixture.append(icon);
    const localIcon = await render(fixture, {surface:"transparent",scale:1});
    assert((await pixels(localIcon)).at(190, 80).join() === "0,0,255,255", "Local SVG symbols outside the selected component are embedded");
    const spriteURL = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><g id="test-shape"><path d="M4 4h16v16H4Z" fill="currentColor"/></g><symbol id="test-icon" viewBox="0 0 24 24"><use href="#test-shape"/></symbol></svg>'], {type:"image/svg+xml"}));
    let embeddedSVG;
    try {
      icon.querySelector("use").setAttribute("href", `${spriteURL}#test-icon`);
      const externalIcon = await render(fixture, {surface:"transparent",scale:1});
      assert((await pixels(externalIcon)).at(190, 80).join() === "0,0,255,255", "Nested external SVG symbols preserve currentColor and transparency");
      embeddedSVG = await render(fixture, {format:"svg",surface:"transparent"});
    } finally { URL.revokeObjectURL(spriteURL); }
    assert((await pixels(embeddedSVG)).at(190, 80).join() === "0,0,255,255", "Saved SVG embeds external symbols after their original URL is revoked");
    sprite.innerHTML += '<symbol id="ui-export-cycle"><use href="#ui-export-cycle"/></symbol>';
    icon.querySelector("use").setAttribute("href", "#ui-export-cycle");
    try { await render(fixture); throw new Error("Expected SVG cycle rejection"); }
    catch (error) { assert(error.message.includes("引用无效或层级过深"), "Cyclic SVG references fail explicitly"); }
    icon.querySelector("use").setAttribute("href", "#ui-export-test-symbol");
    const active = document.createElement("div");
    active.style.display = "none";
    active.innerHTML = '<a href="javascript:void(0)" onclick="void(0)">link</a><form action="https://example.invalid" onsubmit="void(0)"><button formaction="https://example.invalid" autofocus>submit</button></form><svg xmlns="http://www.w3.org/2000/svg"><set attributeName="opacity" to="1"/></svg><script type="application/json">{}</script><template>hidden</template><source srcset="https://example.invalid/image.png">';
    fixture.append(active);
    const beforeSVG = fixture.outerHTML;
    const svgResult = await render(fixture, {format:"svg",scale:2,surface:"transparent"});
    assert(svgResult.format === "svg" && svgResult.blob.type.startsWith("image/svg+xml"), "SVG download has the correct format and MIME type");
    assert(svgResult.width === 240 && svgResult.height === 160, "SVG dimensions do not depend on PNG pixel scale");
    const svgText = await svgResult.blob.text();
    const svgDocument = new DOMParser().parseFromString(svgText,"image/svg+xml");
    assert(!svgDocument.querySelector("parsererror") && svgDocument.documentElement.getAttribute("viewBox") === "0 0 240 160", "SVG is valid XML with a proportional viewBox");
    assert(!svgDocument.querySelector("foreignObject,image") && !!svgDocument.querySelector("text") && !!svgDocument.querySelector("path"), "SVG contains native text and paths without HTML or a raster snapshot");
    assert(svgText.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && /^[\x00-\x7f]*$/.test(svgText), "SVG uses an explicit XML encoding and ASCII character references");
    assert(svgDocument.documentElement.textContent.includes("文字"), "Chinese characters survive native SVG serialization");
    assert(!svgDocument.querySelector("script,template,source,set,animate,animateMotion,animateTransform"), "Standalone SVG excludes scripts, templates, alternate image sources and animations");
    assert(![...svgDocument.querySelectorAll("*")].some(node=>[...node.attributes].some(attribute=>/^on/i.test(attribute.name)||["action","formaction","autofocus"].includes(attribute.name))), "Standalone SVG excludes event handlers, submissions and autofocus");
    assert(!svgDocument.querySelector("a,form"), "Standalone SVG contains no interactive HTML links or forms");
    const outlinedResult = await render(fixture, {format:"svg",surface:"transparent",text:"outline"});
    const outlinedDocument = new DOMParser().parseFromString(await outlinedResult.blob.text(),"image/svg+xml");
    assert(!outlinedDocument.querySelector("parsererror,text,foreignObject") && outlinedDocument.querySelectorAll("use").length >= 8 && !!outlinedDocument.querySelector("defs path[id^=ui-glyph]"), "Outlined SVG replaces text with shared glyph paths");
    const liveData = (await pixels(svgResult)).data;
    const outlinedData = (await pixels(outlinedResult)).data;
    let outlineFar = 0, outlineInk = 0;
    for (let i = 3; i < liveData.length; i += 4) {
      if (Math.abs(liveData[i] - outlinedData[i]) > 96) outlineFar++;
      if (outlinedData[i] > 128) outlineInk++;
    }
    assert(outlineInk > 1000 && outlineFar / (liveData.length / 4) < 0.004, "Outlined text matches live text");
    try { await render(fixture,{format:"svg",text:"invalid"}); throw new Error("Expected text option rejection"); }
    catch (error) { assert(error.message.includes("文字选项"), "Unknown text options fail explicitly"); }
    const svgPixels = await pixels(svgResult);
    assert(svgPixels.at(10,60)[3] === 0 && svgPixels.at(40,40).join() === "255,255,255,255", "SVG preserves transparent areas and opaque component surfaces");
    assert(fixture.outerHTML === beforeSVG, "SVG serialization does not alter the original component");
    svgDocument.documentElement.setAttribute("width","480");
    svgDocument.documentElement.setAttribute("height","320");
    const scaledSVG = {blob:new Blob([new XMLSerializer().serializeToString(svgDocument)],{type:"image/svg+xml"}),width:480,height:320};
    const scaledPixels = await pixels(scaledSVG);
    assert(scaledPixels.at(80,80).join() === "255,255,255,255" && scaledPixels.at(20,120)[3] === 0, "Changing SVG display size scales the fixed layout without reflow");
    assert((await pixels(await render(fixture,{format:"svg"}))).at(10,60).join() === "244,244,244,255", "SVG also supports the ordinary page background");
    try { await render(fixture,{format:"invalid"}); throw new Error("Expected format rejection"); }
    catch (error) { assert(error.message.includes("导出格式"), "Unknown export formats fail explicitly"); }
    fixture.style.height = "17000px";
    try {
      assert((await render(fixture,{format:"svg"})).height === 17000, "SVG is not restricted by the PNG canvas dimension limit");
      try { await render(fixture,{format:"png"}); throw new Error("Expected PNG size rejection"); }
      catch (error) { assert(error.message.includes("图片过大"), "PNG retains its canvas size protection"); }
    } finally { fixture.style.height = "160px"; }
    return checks;
  } finally {
    host.remove();
  }
})();
