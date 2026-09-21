import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_WATCHLIST = "data/monitors/provider-availability-watchlist.json";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;

/** Validate the existing exclusion evidence; never reinterpret it as availability. */
export function unavailableProviderIds(watchlist) {
  const items = Array.isArray(watchlist) ? watchlist : watchlist?.items;
  if (!Array.isArray(items)) {
    throw new Error("Watchlist must be an array or an object containing an items array.");
  }
  const ids = new Set();
  for (const item of items) {
    if (!isRecord(item) || !isText(item.id)) throw new Error("Watchlist item missing a valid id.");
    if (ids.has(item.id)) throw new Error(`Duplicate watchlist id: ${item.id}.`);
    if (!isText(item.name) || !isText(item.url)) throw new Error(`${item.id} missing name or url.`);
    if (item.lastKnownStatus !== "unavailable") {
      throw new Error(`${item.id} lastKnownStatus must remain unavailable while watchlisted.`);
    }
    if (!Array.isArray(item.unavailablePatterns) || item.unavailablePatterns.length === 0) {
      throw new Error(`${item.id} missing unavailablePatterns.`);
    }
    if (!isRecord(item.providerCandidate)) throw new Error(`${item.id} missing providerCandidate.`);
    ids.add(item.id);
  }
  return ids;
}

/** Match exact provider IDs only: colleagues may share a website or practice. */
export function reconcileUnavailableProviders(providers, watchlist) {
  if (!Array.isArray(providers)) throw new Error("Providers must be an array.");
  const ids = unavailableProviderIds(watchlist);
  const seen = new Set();
  const retained = [];
  const excludedIds = [];
  for (const provider of providers) {
    if (!isRecord(provider) || !isText(provider.id)) throw new Error("Provider missing a valid id.");
    if (seen.has(provider.id)) throw new Error(`Duplicate provider id: ${provider.id}.`);
    seen.add(provider.id);
    if (ids.has(provider.id)) excludedIds.push(provider.id);
    else retained.push(provider);
  }
  return { providers: retained, excludedIds };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${filePath}: ${error.message}`, { cause: error });
  }
}

/** Validate everything before writing, leave evidence untouched, and avoid partial JSON files. */
export function reconcileWatchlistFiles(providersPath, watchlistPath, { validateOnly = false } = {}) {
  if (path.resolve(providersPath) === path.resolve(watchlistPath)) {
    throw new Error("Providers and watchlist paths must be different.");
  }
  const providers = readJson(providersPath);
  const watchlist = readJson(watchlistPath);
  const result = reconcileUnavailableProviders(providers, watchlist);
  if (!validateOnly && result.excludedIds.length > 0) {
    const temporaryPath = `${providersPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(result.providers, null, 2)}\n`, {
        flag: "wx",
        mode: fs.statSync(providersPath).mode & 0o777
      });
      fs.renameSync(temporaryPath, providersPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const flags = args.filter((arg) => arg.startsWith("--"));
    const positional = args.filter((arg) => !arg.startsWith("--"));
    if (flags.some((flag) => flag !== "--validate-only") || positional.length > 2) {
      throw new Error("Usage: node tools/reconcile-availability-watchlist.mjs [providers.json] [watchlist.json] [--validate-only]");
    }
    const [providersPath = "providers.json", watchlistPath = DEFAULT_WATCHLIST] = positional;
    const validateOnly = flags.includes("--validate-only");
    const result = reconcileWatchlistFiles(providersPath, watchlistPath, { validateOnly });
    if (validateOnly) {
      console.log("Provider and unavailable watchlist inputs are valid; no files changed.");
    } else {
      console.log(`Preserved unavailable watchlist exclusions: ${result.excludedIds.length}. Retained providers: ${result.providers.length}.`);
      for (const id of result.excludedIds) console.log(`WATCHLIST_PRESERVED ${id}`);
    }
  } catch (error) {
    console.error(`WATCHLIST_RECONCILIATION_ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
