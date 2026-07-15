import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildCanonicalProviderDataset,
  refreshCanonicalProviderDataset,
  writeCanonicalDataset
} from "./lib/provider-canonical.mjs";

export function buildProviderCanonical(options = {}) {
  const providersPath = options.providers || "providers.json";
  const outPath = options.out || "data/provider-validation/provider-canonical.json";
  const statePath = options.state || "data/provider-validation/provider-validation-state.json";
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  const previousState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
  const existingCanonical = fs.existsSync(outPath) && !options.forceRebuild
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : null;
  const canonical = existingCanonical
    ? refreshCanonicalProviderDataset(existingCanonical, providers, { previousState, source: providersPath })
    : buildCanonicalProviderDataset(providers, { previousState, source: providersPath });
  writeCanonicalDataset(outPath, canonical);
  return canonical;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--providers") options.providers = argv[++index];
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--state") options.state = argv[++index];
    else if (arg === "--force-rebuild") options.forceRebuild = true;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const canonical = buildProviderCanonical(parseArgs(process.argv.slice(2)));
  console.log(`Canonical provider dataset: ${canonical.providerCount} providers, ${canonical.practiceCount} practices, ${canonical.clinicianCount} clinicians.`);
}
