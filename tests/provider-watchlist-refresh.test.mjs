import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  unavailableProviderIds,
  reconcileUnavailableProviders,
  reconcileWatchlistFiles
} from "../tools/reconcile-availability-watchlist.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const guardPath = path.join(root, "tools/reconcile-availability-watchlist.mjs");
const auditPath = path.join(root, "tools/audit-availability-watchlist.mjs");
const refreshPath = path.join(root, "tools/refresh-provider-database.mjs");
const regressionIds = ["manawatu-eye-openers-psychiatry", "ranzcp-7046"];

// Synthetic evidence fixtures; these are not new claims about the real providers.
function item(id) {
  return {
    id, name: `Test fixture ${id}`, url: "https://practice.example/contact",
    lastKnownStatus: "unavailable", unavailablePatterns: ["not taking new patients"],
    providerCandidate: { id, name: `Test fixture ${id}`, retainedEvidence: "test-only" }
  };
}
function fixture(t, providers = [{ id: "unrelated", nested: { preserve: true } }], watchlist = { items: regressionIds.map(item) }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-watchlist-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const providersPath = path.join(directory, "custom-providers.json");
  const watchlistPath = path.join(directory, "custom-watchlist.json");
  fs.writeFileSync(providersPath, JSON.stringify(providers));
  fs.writeFileSync(watchlistPath, JSON.stringify(watchlist));
  return { directory, providersPath, watchlistPath };
}
function node(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}
function assertSuccess(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

for (const shape of ["array", "object"]) {
  test(`preserves the two reported exclusions with ${shape} watchlist format`, () => {
    const watch = regressionIds.map(item);
    const providers = [
      { id: regressionIds[0], availabilityStatus: "accepting" },
      { id: "retained", nested: { preserve: true } },
      { id: regressionIds[1] }
    ];
    const result = reconcileUnavailableProviders(providers, shape === "array" ? watch : { items: watch });
    assert.deepEqual(result.excludedIds, regressionIds);
    assert.deepEqual(result.providers, [providers[1]]);
  });
}

test("does not infer shared-practice exclusions from a URL, email or name", () => {
  const excluded = item("excluded");
  const colleague = { id: "colleague", name: excluded.name, website: excluded.url, email: "shared@practice.example" };
  const result = reconcileUnavailableProviders([colleague], [excluded]);
  assert.deepEqual(result.providers, [colleague]);
  assert.deepEqual(result.excludedIds, []);
});

test("pure reconciliation preserves input data, evidence, order and object contents", () => {
  const providers = [{ id: "first", tags: ["test"] }, { id: "excluded" }, { id: "last", nested: { x: 1 } }];
  const watch = { updatedAt: "unchanged", items: [item("excluded")] };
  const beforeProviders = structuredClone(providers);
  const beforeWatch = structuredClone(watch);
  const result = reconcileUnavailableProviders(providers, watch);
  assert.deepEqual(providers, beforeProviders);
  assert.deepEqual(watch, beforeWatch);
  assert.deepEqual(result.providers, [providers[0], providers[2]]);
});

test("an explicitly empty watchlist is valid", () => {
  assert.equal(unavailableProviderIds({ items: [] }).size, 0);
});

const invalidWatchlists = [
  ["null", null],
  ["missing items", {}],
  ["non-array items", { items: "invalid" }],
  ["null item", [null]],
  ["missing id", [{ ...item("x"), id: "" }]],
  ["missing name", [{ ...item("x"), name: "" }]],
  ["missing url", [{ ...item("x"), url: "" }]],
  ["wrong status", [{ ...item("x"), lastKnownStatus: "accepting" }]],
  ["missing patterns", [{ ...item("x"), unavailablePatterns: [] }]],
  ["missing candidate", [{ ...item("x"), providerCandidate: null }]],
  ["array candidate", [{ ...item("x"), providerCandidate: [] }]],
  ["duplicate id", [item("x"), item("x")]]
];
for (const [label, watchlist] of invalidWatchlists) {
  test(`invalid watchlist (${label}) fails without changing either file`, (t) => {
    const f = fixture(t, [{ id: "x" }], watchlist);
    const beforeProviders = fs.readFileSync(f.providersPath, "utf8");
    const beforeWatchlist = fs.readFileSync(f.watchlistPath, "utf8");
    assert.throws(() => reconcileWatchlistFiles(f.providersPath, f.watchlistPath));
    assert.equal(fs.readFileSync(f.providersPath, "utf8"), beforeProviders);
    assert.equal(fs.readFileSync(f.watchlistPath, "utf8"), beforeWatchlist);
  });
}
for (const [label, providers] of [["non-array", {}], ["missing id", [{}]], ["duplicate ids", [{ id: "x" }, { id: "x" }]]]) {
  test(`invalid providers (${label}) fail without changing the file`, (t) => {
    const f = fixture(t, providers);
    const before = fs.readFileSync(f.providersPath, "utf8");
    assert.throws(() => reconcileWatchlistFiles(f.providersPath, f.watchlistPath));
    assert.equal(fs.readFileSync(f.providersPath, "utf8"), before);
  });
}

test("no-op reconciliation does not rewrite the provider file", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.providersPath, "utf8");
  const beforeStat = fs.statSync(f.providersPath);
  const result = reconcileWatchlistFiles(f.providersPath, f.watchlistPath);
  assert.deepEqual(result.excludedIds, []);
  assert.equal(fs.readFileSync(f.providersPath, "utf8"), before);
  assert.equal(fs.statSync(f.providersPath).mtimeMs, beforeStat.mtimeMs);
});

test("unchanged audit reproduces both failures, then passes after reconciliation", (t) => {
  const f = fixture(t, [...regressionIds.map((id) => ({ id })), { id: "retained" }]);
  const evidenceBefore = fs.readFileSync(f.watchlistPath, "utf8");
  const before = node(auditPath, [f.providersPath, f.watchlistPath], f.directory);
  assert.equal(before.status, 1);
  for (const id of regressionIds) assert.ok(before.stderr.includes(`${id} is both live`));
  assertSuccess(node(guardPath, [f.providersPath, f.watchlistPath], f.directory));
  assertSuccess(node(auditPath, [f.providersPath, f.watchlistPath], f.directory));
  assert.equal(fs.readFileSync(f.watchlistPath, "utf8"), evidenceBefore);
  const providerBytes = fs.readFileSync(f.providersPath, "utf8");
  assertSuccess(node(guardPath, [f.providersPath, f.watchlistPath], f.directory));
  assert.equal(fs.readFileSync(f.providersPath, "utf8"), providerBytes);
  assert.equal(fs.readdirSync(f.directory).filter((name) => name.endsWith(".tmp")).length, 0);
});

test("preflight validates but never applies exclusions", (t) => {
  const f = fixture(t, regressionIds.map((id) => ({ id })));
  const before = fs.readFileSync(f.providersPath, "utf8");
  assertSuccess(node(guardPath, [f.providersPath, f.watchlistPath, "--validate-only"], f.directory));
  assert.equal(fs.readFileSync(f.providersPath, "utf8"), before);
});

for (const failure of ["missing", "invalid JSON"]) {
  test(`${failure} watchlist fails with a diagnostic and leaves providers untouched`, (t) => {
    const f = fixture(t);
    const before = fs.readFileSync(f.providersPath, "utf8");
    if (failure === "missing") fs.unlinkSync(f.watchlistPath);
    else fs.writeFileSync(f.watchlistPath, "{ invalid JSON");
    const result = node(guardPath, [f.providersPath, f.watchlistPath], f.directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WATCHLIST_RECONCILIATION_ERROR/);
    assert.equal(fs.readFileSync(f.providersPath, "utf8"), before);
  });
}

test("rejects unknown CLI flags rather than accidentally applying changes", (t) => {
  const f = fixture(t);
  const result = node(guardPath, [f.providersPath, f.watchlistPath, "--dryrun"], f.directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("rejects providers and watchlist pointing at the same path", (t) => {
  const f = fixture(t);
  assert.throws(() => reconcileWatchlistFiles(f.providersPath, f.providersPath), /must be different/);
});

// Offline pipeline integration: copy the actual orchestrator and guard; stub only
// external imports and unrelated audits so this test cannot fetch or publish data.
function pipelineFixture(t, { corruptDuringImport = false } = {}) {
  const f = fixture(t);
  const tools = path.join(f.directory, "tools");
  fs.mkdirSync(tools);
  fs.copyFileSync(guardPath, path.join(tools, path.basename(guardPath)));
  fs.copyFileSync(refreshPath, path.join(tools, path.basename(refreshPath)));
  const stub = `import fs from "node:fs";\nconst p=process.argv[2];\nconst providers=JSON.parse(fs.readFileSync(p,"utf8"));\nproviders.push({id: "__ID__"});\nfs.writeFileSync(p,JSON.stringify(providers));\nfs.appendFileSync("import-calls.txt","called\\n");\n`;
  fs.writeFileSync(path.join(tools, "import-ranzcp-psychiatrists.mjs"), stub.replace("__ID__", regressionIds[1]));
  fs.writeFileSync(path.join(tools, "import-gap-verified-providers.mjs"), stub.replace("__ID__", regressionIds[0]) + (corruptDuringImport ? 'fs.writeFileSync(process.argv[3],"{ invalid");\n' : ""));
  for (const name of ["geocode-provider-addresses", "audit-provider-quality", "audit-support-preferences", "audit-provider-source-fit", "audit-provider-availability", "audit-address-coverage"]) {
    fs.writeFileSync(path.join(tools, `${name}.mjs`), 'import fs from "node:fs"; fs.appendFileSync("post-import-calls.txt","called\\n");\n');
  }
  const config = {
    providersPath: f.providersPath,
    reportsPath: "reports/custom-report.json",
    monitors: { availabilityWatchlist: f.watchlistPath },
    liveSources: {
      ranzcpPsychiatrists: true,
      gapVerifiedProviders: true,
      healthpointApi: { urlEnv: "WATCHLIST_TEST_NO_NETWORK_URL" }
    }
  };
  fs.writeFileSync(path.join(f.directory, "config.json"), JSON.stringify(config));
  return { ...f, localRefresh: path.join(tools, path.basename(refreshPath)), reportPath: path.join(f.directory, config.reportsPath) };
}
function runPipeline(f) {
  return spawnSync(process.execPath, [f.localRefresh, "config.json"], {
    cwd: f.directory, encoding: "utf8", env: { ...process.env, WATCHLIST_TEST_NO_NETWORK_URL: "" }
  });
}

test("refresh integration preserves exclusions after both importers using configured paths", (t) => {
  const f = pipelineFixture(t);
  const evidence = fs.readFileSync(f.watchlistPath, "utf8");
  assertSuccess(runPipeline(f));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.providersPath, "utf8")), [{ id: "unrelated", nested: { preserve: true } }]);
  assert.equal(fs.readFileSync(f.watchlistPath, "utf8"), evidence);
  assertSuccess(node(auditPath, [f.providersPath, f.watchlistPath], f.directory));
  const report = JSON.parse(fs.readFileSync(f.reportPath, "utf8"));
  const guardIndex = report.steps.findIndex((step) => step.label === "Preserve unavailable provider watchlist exclusions");
  const geocodeIndex = report.steps.findIndex((step) => step.label === "Geocode provider addresses");
  const importIndex = report.steps.findIndex((step) => step.label === "Refresh Chrome/search verified gap-fill providers");
  assert.ok(guardIndex > importIndex && guardIndex < geocodeIndex);
  assert.equal(report.steps[guardIndex].optional, false);
  assert.equal(report.steps[guardIndex].ok, true);
  for (const id of regressionIds) assert.ok(report.steps[guardIndex].stdout.includes(id));
});

test("refresh preflight stops before imports on invalid watchlist and writes a failure report", (t) => {
  const f = pipelineFixture(t);
  const before = fs.readFileSync(f.providersPath, "utf8");
  fs.unlinkSync(f.watchlistPath);
  const result = runPipeline(f);
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(f.providersPath, "utf8"), before);
  assert.equal(fs.existsSync(path.join(f.directory, "import-calls.txt")), false);
  const report = JSON.parse(fs.readFileSync(f.reportPath, "utf8"));
  assert.equal(report.steps.length, 1);
  assert.equal(report.steps[0].ok, false);
});

test("refresh stops subsequent steps if an importer corrupts the watchlist", (t) => {
  const f = pipelineFixture(t, { corruptDuringImport: true });
  const result = runPipeline(f);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(f.directory, "post-import-calls.txt")), false);
  const report = JSON.parse(fs.readFileSync(f.reportPath, "utf8"));
  assert.equal(report.steps.at(-1).label, "Preserve unavailable provider watchlist exclusions");
  assert.equal(report.steps.at(-1).ok, false);
});
