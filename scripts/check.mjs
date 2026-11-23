import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

for (const directory of ["extension", "scripts", "tests"]) {
  const base = new URL(`../${directory}/`, import.meta.url);
  for (const name of await readdir(base)) {
    if (/\.m?js$/.test(name)) {
      execFileSync(process.execPath, ["--check", fileURLToPath(new URL(name, base))], { stdio: "inherit" });
    }
  }
}
await import("./check-manifest.mjs");
