import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Requires the agent-browser CLI and its Chromium installation; no npm packages.
const root = fileURLToPath(new URL("../", import.meta.url));
const names = process.argv.slice(2);
const tests = names.length ? names : ["renderer", "picker", "layout", "fidelity"];
if (tests.some(name => !["renderer", "picker", "layout", "fidelity"].includes(name))) throw new Error("Use renderer, picker, layout or fidelity.");
const session = execFileSync("agent-browser", ["session", "id", "--scope", "worktree", "--prefix", "uikit-regression"], { cwd: root, encoding: "utf8" }).trim();
const call = (args, input) => execFileSync("agent-browser", ["--session", session, ...args], {
  cwd: root, input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 120_000,
  stdio: ["pipe", "pipe", "pipe"]
});
const evaluate = code => call(["eval", "--stdin"], code);
try {
  call(["open"]);
  // Intercept before navigation, so fixtures never fetch a real conversation.
  call(["network", "route", "https://chatgpt.com/ui-export-test", "--body", "{}"]);
  call(["open", "https://chatgpt.com/ui-export-test"]);
  call(["set", "viewport", "1280", "900"]);
  evaluate(`document.open(); document.write('<!doctype html><html><head><meta charset="utf-8"><title>UI exporter regression</title></head><body></body></html>'); document.close();`);
  for (const file of ["components", "hover", "theme", "capture", "outline", "native-svg", "raster", "exporter", "picker"]) {
    evaluate(readFileSync(new URL(`../extension/${file}.js`, import.meta.url), "utf8"));
  }
  for (const name of tests) {
    if (name === "fidelity") {
      evaluate(readFileSync(new URL("../tests/fidelity.browser.js", import.meta.url), "utf8"));
      const artifacts = join(root, ".scratchpad", `${new Date().toISOString().slice(0, 10)}-svg-fidelity`);
      mkdirSync(artifacts, { recursive: true });
      console.log(`fidelity artifacts: ${artifacts}`);
      const failures = [];
      for (const scale of [1, 2]) {
        call(["set", "viewport", "1280", "1000", String(scale)]);
        evaluate("globalThis.__uiExportFidelity.setup()");
        const screenshot = join(artifacts, `dom-${scale}x.png`);
        call(["screenshot", screenshot]);
        const reference = `data:image/png;base64,${readFileSync(screenshot).toString("base64")}`;
        const result = JSON.parse(evaluate(`globalThis.__uiExportFidelity.compare(${JSON.stringify(reference)})`));
        writeFileSync(join(artifacts, `comparison-${scale}x.png`), Buffer.from(result.proof, "base64"));
        writeFileSync(join(artifacts, `report-${scale}x.json`), JSON.stringify(result.report, null, 2) + "\n");
        failures.push(...result.report.filter(item => !item.passed));
        console.log(`fidelity ${scale}x: ${result.report.filter(item => item.passed).length}/${result.report.length} checks passed`);
        evaluate("globalThis.__uiExportFidelity.cleanup()");
      }
      if (failures.length) throw new Error(failures.map(item => `${item.name} (${item.scale}x): ${(item.ratio * 100).toFixed(2)}% different pixels`).join("\n"));
      continue;
    }
    call(["set", "viewport", name === "layout" ? "280" : "1280", "900"]);
    const checks = JSON.parse(evaluate(readFileSync(new URL(`../tests/${name}.browser.js`, import.meta.url), "utf8")));
    console.log(`${name}: ${checks.length} checks passed`);
  }
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
} finally {
  try { call(["close"]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
