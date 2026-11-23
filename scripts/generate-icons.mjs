import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Draws assets/icon*.svg into extension/icons/*.png with a browser canvas.
// Requires the agent-browser CLI and its Chromium installation; no npm packages.
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = new URL("../extension/icons/", import.meta.url);
// The small sizes use a simpler drawing. The store asks for 128 px icons to
// keep a 16 px transparent margin around a 96 px drawing.
const ICONS = [
  { size: 16, source: "icon-small.svg", margin: 0 },
  { size: 32, source: "icon-small.svg", margin: 0 },
  { size: 48, source: "icon.svg", margin: 0 },
  { size: 128, source: "icon.svg", margin: 16 }
];
const session = execFileSync("agent-browser", ["session", "id", "--scope", "worktree", "--prefix", "uikit-icons"], { cwd: root, encoding: "utf8" }).trim();
const call = (args, input) => execFileSync("agent-browser", ["--session", session, ...args], {
  cwd: root, input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 120_000,
  stdio: ["pipe", "pipe", "pipe"]
});
// Has no side effects on the page, so it is safe if the CLI evaluates it twice.
const draw = ({ size, margin }, svg) => `(async () => {
  const image = new Image();
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(${JSON.stringify(svg)});
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ${size};
  canvas.getContext("2d").drawImage(image, ${margin}, ${margin}, ${size - margin * 2}, ${size - margin * 2});
  return canvas.toDataURL("image/png");
})()`;
try {
  call(["open", "about:blank"]);
  mkdirSync(destination, { recursive: true });
  for (const icon of ICONS) {
    const svg = readFileSync(new URL(`../assets/${icon.source}`, import.meta.url), "utf8");
    const url = JSON.parse(call(["eval", "--stdin"], draw(icon, svg)));
    if (typeof url !== "string" || !url.startsWith("data:image/png;base64,")) throw new Error(`Could not draw ${icon.source} at ${icon.size} px.`);
    writeFileSync(new URL(`${icon.size}.png`, destination), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    console.log(`extension/icons/${icon.size}.png  ←  assets/${icon.source}`);
  }
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
} finally {
  try { call(["close"]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
