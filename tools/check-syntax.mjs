import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(filePath);
    return entry.name.endsWith(".mjs") || entry.name.endsWith(".js") ? [filePath] : [];
  });
}

const files = ["script.js", ...javascriptFiles("tools"), ...javascriptFiles("tests")];

let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr || result.stdout || `Syntax check failed: ${file}`);
  }
}

if (failed) process.exit(1);
console.log(`Syntax checked ${files.length} JavaScript files.`);
