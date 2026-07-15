import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COMPLETED_ACTIONS = new Set(["approve", "adjust", "reject", "move_to_watchlist", "duplicate"]);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function decisionsList(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value.decisions) ? value.decisions : [];
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000).toISOString();
}

export function updateCodexProgress(progress = {}, decisions = [], options = {}) {
  const now = options.now || new Date();
  const deferredDays = Number(options.deferredDays || 30);
  const failedDays = Number(options.failedDays || 7);
  const next = structuredClone(progress && typeof progress === "object" ? progress : {});
  next.version = 1;
  next.updatedAt = now.toISOString();
  next.items ||= {};
  next.events ||= [];

  for (const decision of decisionsList(decisions)) {
    const action = decision.action || decision.reviewDecision || "needs_more_info";
    let reviewIds = Array.isArray(decision.reviewIds) ? decision.reviewIds : [decision.reviewId].filter(Boolean);
    if (!reviewIds.length && decision.providerId) {
      reviewIds = Object.values(next.items)
        .filter((item) => item.providerId === decision.providerId && item.status === "in_progress")
        .map((item) => item.reviewId);
    }
    for (const reviewId of reviewIds) {
      const previous = next.items[reviewId] || { reviewId, providerId: decision.providerId || "" };
      const failed = options.batchFailed === true || decision.processingStatus === "failed";
      const completed = COMPLETED_ACTIONS.has(action) && !failed;
      next.items[reviewId] = {
        ...previous,
        status: failed ? "deferred" : completed ? "completed" : "deferred",
        completedAt: completed ? now.toISOString() : "",
        nextEligibleAt: completed ? "" : addDays(now, failed ? failedDays : deferredDays),
        lastAction: action,
        lastSourceUrl: decision.sourceUrl || "",
        lastNotes: decision.reviewNotes || decision.notes || "",
        lastDecisionFile: options.decisionsPath || ""
      };
      next.events.push({
        reviewId,
        providerId: decision.providerId || previous.providerId || "",
        action,
        status: next.items[reviewId].status,
        at: now.toISOString(),
        decisionFile: options.decisionsPath || ""
      });
    }
  }
  next.events = next.events.slice(-2000);
  return next;
}

function parseArgs(argv) {
  const config = {
    decisions: "data/provider-validation/codex-verified-decisions.json",
    progress: "data/provider-validation/codex-progress.json",
    deferredDays: 30,
    failedDays: 7
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--decisions") config.decisions = argv[++index];
    else if (arg === "--progress") config.progress = argv[++index];
    else if (arg === "--deferred-days") config.deferredDays = Number(argv[++index]);
    else if (arg === "--failed-days") config.failedDays = Number(argv[++index]);
  }
  return config;
}

export function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const progress = readJson(config.progress, { version: 1, items: {}, batches: [], events: [] });
  const decisions = readJson(config.decisions, { decisions: [] });
  const batchFailed = Array.isArray(decisions.errors) && decisions.errors.length > 0;
  const next = updateCodexProgress(progress, decisions, { ...config, decisionsPath: config.decisions, batchFailed });
  writeJson(config.progress, next);
  console.log(`Updated Codex progress from ${decisionsList(decisions).length} decision(s).${batchFailed ? " Evidence batch failed; all decisions were deferred." : ""}`);
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
