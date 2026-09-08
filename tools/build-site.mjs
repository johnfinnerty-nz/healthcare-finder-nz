import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "outputs", "github-pages");
const publicFiles = [
  "index.html",
  "styles.css",
  "script.js",
  "providers.json",
  "crisis.html",
  "data-sources.html",
  "privacy.html",
  "terms.html",
  "medium-healthcare-pitfalls.html",
  "robots.txt",
  "sitemap.xml",
];

fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) {
  if (![...publicFiles, "assets", ".nojekyll"].includes(entry)) {
    throw new Error(`Unexpected file in Pages output: ${entry}`);
  }
}
for (const file of publicFiles) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.cpSync(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
fs.writeFileSync(path.join(output, ".nojekyll"), "");
console.log(`Public site prepared in ${output}`);
