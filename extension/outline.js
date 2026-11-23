(() => {
  "use strict";
  const VERSION = "0.1.0";
  if (globalThis.__chatgptUIExportOutline?.version === VERSION) return;

  // Turns text into vector outlines without access to font files: each glyph is
  // drawn large on a canvas with the page's own font, and the edge of its
  // coverage is followed to build a path. Colour glyphs (emoji) cannot be
  // described by one outline, so they are returned as small images instead.
  const THRESHOLD = 127.5;
  const TARGET_EM = 160;
  const MAX_SCALE = 12;
  const PAD = 3;
  const TOLERANCE = 0.3;
  const MAX_CACHE = 6000;
  const cache = new Map();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const round = value => Math.round(value * 100) / 100;

  // Follows the half-coverage contour of an alpha field (marching squares with
  // interpolated crossings) and returns closed loops in sample coordinates.
  function contours(alpha, width, height) {
    const starts = new Map();
    const at = (x, y) => alpha[(y * width + x) * 4 + 3];
    const cross = (a, b) => (THRESHOLD - a) / (b - a);
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
        const inside = [tl > THRESHOLD, tr > THRESHOLD, br > THRESHOLD, bl > THRESHOLD];
        const count = inside[0] + inside[1] + inside[2] + inside[3];
        if (count === 0 || count === 4) continue;
        const base = y * width + x;
        // Edges in order: top, right, bottom, left. Corner i sits between edge
        // (i + 3) % 4 and edge i.
        const edges = [
          { on: inside[0] !== inside[1], x: x + cross(tl, tr), y, key: base * 2 },
          { on: inside[1] !== inside[2], x: x + 1, y: y + cross(tr, br), key: (base + 1) * 2 + 1 },
          { on: inside[2] !== inside[3], x: x + cross(bl, br), y: y + 1, key: (base + width) * 2 },
          { on: inside[3] !== inside[0], x, y: y + cross(tl, bl), key: base * 2 + 1 }
        ];
        const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
        // Every segment is directed so the covered side is on the same hand,
        // which lets neighbouring cells chain end to start.
        const add = (a, b, corner, covered) => {
          const side = (b.x - a.x) * (corners[corner][1] - a.y) - (b.y - a.y) * (corners[corner][0] - a.x);
          const [from, to] = (side > 0) === covered ? [a, b] : [b, a];
          starts.set(from.key, { x: from.x, y: from.y, next: to.key });
        };
        const active = edges.filter(edge => edge.on);
        if (active.length === 2) {
          add(active[0], active[1], inside.indexOf(true), true);
          continue;
        }
        // Saddle: the centre decides whether the covered corners are joined.
        const joined = (tl + tr + br + bl) / 4 > THRESHOLD;
        for (let corner = 0; corner < 4; corner++) {
          if (inside[corner] === joined) continue;
          add(edges[(corner + 3) % 4], edges[corner], corner, inside[corner]);
        }
      }
    }
    const loops = [];
    for (const key of [...starts.keys()]) {
      let segment = starts.get(key);
      if (!segment) continue;
      const loop = [];
      let current = key;
      while (segment) {
        starts.delete(current);
        loop.push([segment.x, segment.y]);
        current = segment.next;
        segment = starts.get(current);
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  // Drops points that stay within the tolerance of the line through their
  // neighbours (Douglas-Peucker on a closed loop).
  function simplify(loop) {
    if (loop.length < 8) return loop;
    let far = 0;
    let distance = 0;
    for (let index = 1; index < loop.length; index++) {
      const d = (loop[index][0] - loop[0][0]) ** 2 + (loop[index][1] - loop[0][1]) ** 2;
      if (d > distance) { distance = d; far = index; }
    }
    const keep = new Uint8Array(loop.length + 1);
    const points = [...loop, loop[0]];
    keep[0] = keep[far] = keep[loop.length] = 1;
    const stack = [[0, far], [far, loop.length]];
    while (stack.length) {
      const [first, last] = stack.pop();
      const [ax, ay] = points[first];
      const [bx, by] = points[last];
      const length = Math.hypot(bx - ax, by - ay) || 1;
      let worst = 0;
      let split = -1;
      for (let index = first + 1; index < last; index++) {
        const d = Math.abs((bx - ax) * (ay - points[index][1]) - (ax - points[index][0]) * (by - ay)) / length;
        if (d > worst) { worst = d; split = index; }
      }
      if (worst > TOLERANCE && split > 0) {
        keep[split] = 1;
        stack.push([first, split], [split, last]);
      }
    }
    return loop.filter((point, index) => keep[index]);
  }

  /**
   * Returns the outline of one grapheme in CSS pixels, relative to its origin
   * on the baseline: { d } for a path, { image, x, y, width, height } for a
   * colour glyph, or { empty: true } when nothing is painted.
   */
  function glyph(style, text) {
    const size = Number.parseFloat(style["font-size"]) || 16;
    const font = `${style["font-style"] || "normal"} ${style["font-weight"] || 400} ${size}px ${style["font-family"] || "sans-serif"}`;
    const key = `${font}\n${text}`;
    if (cache.has(key)) return cache.get(key);
    if (cache.size >= MAX_CACHE) cache.clear();
    const scale = Math.min(MAX_SCALE, Math.max(2, TARGET_EM / size));
    context.font = font;
    const measured = context.measureText(text);
    const left = Math.ceil(Math.max(0, measured.actualBoundingBoxLeft) * scale) + PAD;
    const top = Math.ceil(Math.max(0, measured.actualBoundingBoxAscent) * scale) + PAD;
    const width = left + Math.ceil(Math.max(0, measured.actualBoundingBoxRight) * scale) + PAD;
    const height = top + Math.ceil(Math.max(0, measured.actualBoundingBoxDescent) * scale) + PAD;
    let result = { empty: true };
    if (width > PAD * 2 && height > PAD * 2 && width * height <= 16_000_000) {
      canvas.width = width;
      canvas.height = height;
      // Resizing resets the context state.
      context.font = font;
      context.textBaseline = "alphabetic";
      context.fillStyle = "#000";
      context.setTransform(scale, 0, 0, scale, left, top);
      context.fillText(text, 0, 0);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const { data } = context.getImageData(0, 0, width, height);
      let ink = false;
      let coloured = false;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 48) continue;
        ink = true;
        if (data[index] + data[index + 1] + data[index + 2] > 60) { coloured = true; break; }
      }
      if (coloured) {
        result = { image: canvas.toDataURL("image/png"), x: round(-left / scale), y: round(-top / scale), width: round(width / scale), height: round(height / scale) };
      } else if (ink) {
        // Samples sit at pixel centres, hence the half-pixel shift.
        const d = contours(data, width, height).map(loop => `M${simplify(loop)
          .map(([x, y]) => `${round((x + 0.5 - left) / scale)} ${round((y + 0.5 - top) / scale)}`).join("L")}Z`).join("");
        if (d) result = { d };
      }
    }
    cache.set(key, result);
    return result;
  }

  globalThis.__chatgptUIExportOutline = Object.freeze({ version: VERSION, glyph, contours, simplify });
})();
