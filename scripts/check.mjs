import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["index.js"];

function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) collect(relative);
    else if (/\.m?js$/.test(entry.name)) files.push(relative);
  }
}

for (const directory of ["config", "jobs", "middleware", "routes", "scripts", "utils"]) collect(directory);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", join(root, file)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checked ${files.length} application and tooling files.`);
