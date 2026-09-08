import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("GitHub workflows validate source but do not host the website", () => {
  for (const file of fs.readdirSync(path.join(root, ".github/workflows"))) {
    const workflow = read(`.github/workflows/${file}`);
    assert.doesNotMatch(workflow, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
    assert.doesNotMatch(workflow, /pages:\s*write/);
    assert.doesNotMatch(workflow, /github\.io\/healthcare-finder-nz/);
  }
  assert.match(read("AGENTS.md"), /GitHub Pages disabled/);
});

test("public metadata points to the finnerty.me app", () => {
  for (const file of ["index.html", "privacy.html", "terms.html", "crisis.html", "data-sources.html", "medium-healthcare-pitfalls.html", "robots.txt", "sitemap.xml"]) {
    const content = read(file);
    assert.match(content, /https:\/\/finnerty\.me\/care-finder\//);
    assert.doesNotMatch(content, /github\.io\/healthcare-finder-nz/);
  }
  assert.match(read("index.html"), /<strong>In development\.<\/strong>/);
});
