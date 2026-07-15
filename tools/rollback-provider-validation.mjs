import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function rollbackProviderValidationRun(options = {}) {
  const runId = options.runId;
  if (!runId) throw new Error("--run-id is required.");
  const providersPath = options.providers || "providers.json";
  const logPath = options.log || "data/provider-validation/change-log.jsonl";
  const dryRun = Boolean(options.dryRun);
  const events = readEvents(logPath).filter((event) => event.runId === runId
    && (Object.hasOwn(event.rollback || {}, "restoreProvider") || event.rollback?.removeProvider === true));
  if (!events.length) throw new Error(`No reversible provider changes found for run ${runId}.`);

  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  for (const event of [...events].reverse()) {
    if (event.rollback.removeProvider) byId.delete(event.providerId);
    else byId.set(event.providerId, event.rollback.restoreProvider);
  }
  const restored = [...byId.values()];
  const generatedAt = new Date().toISOString();
  const rollbackRunId = `rollback-${runId}-${crypto.randomBytes(3).toString("hex")}`;

  if (!dryRun) {
    fs.writeFileSync(providersPath, `${JSON.stringify(restored, null, 2)}\n`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const rollbackEvents = events.map((event) => ({
      eventId: `validation-event-${crypto.randomUUID()}`,
      runId: rollbackRunId,
      rollsBackRunId: runId,
      providerId: event.providerId,
      providerName: event.providerName,
      action: "rollback",
      reason: options.reason || "Automated validation rollback.",
      oldProvider: event.newProvider,
      newProvider: event.rollback.removeProvider ? null : event.rollback.restoreProvider,
      rollback: event.newProvider ? { restoreProvider: event.newProvider } : { removeProvider: true },
      generatedAt
    }));
    fs.appendFileSync(logPath, `${rollbackEvents.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
  return { runId, rollbackRunId, restoredProviders: events.length, dryRun };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") options.runId = argv[++index];
    else if (arg === "--providers") options.providers = argv[++index];
    else if (arg === "--log") options.log = argv[++index];
    else if (arg === "--reason") options.reason = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = rollbackProviderValidationRun(parseArgs(process.argv.slice(2)));
    console.log(`${result.dryRun ? "Would restore" : "Restored"} ${result.restoredProviders} provider(s) from ${result.runId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
