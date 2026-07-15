import fs from "node:fs";
import path from "node:path";

export const rolloutStages = ["shadow", "canary_50", "canary_250", "full"];

export function defaultRolloutState(previous = {}) {
  const stage = rolloutStages.includes(previous.stage) ? previous.stage : "shadow";
  return {
    version: 1,
    stage,
    cleanRunsAtStage: Number(previous.cleanRunsAtStage || 0),
    readyToPublish: Boolean(previous.readyToPublish),
    lastRunId: previous.lastRunId || "",
    lastRunAt: previous.lastRunAt || "",
    lastPublishedRunId: previous.lastPublishedRunId || "",
    history: Array.isArray(previous.history) ? previous.history : []
  };
}

export function stageProviderLimit(stage) {
  if (stage === "canary_50") return 50;
  if (stage === "canary_250") return 250;
  if (stage === "full") return Infinity;
  return 0;
}

export function requiredValidationBatchSize(rollout = {}, totalProviders = 0) {
  const stage = rollout.stage || "shadow";
  if (stage === "shadow" || stage === "full") return Math.max(0, totalProviders);
  return Math.min(Math.max(0, totalProviders), stageProviderLimit(stage));
}

export function validationBatchIsComplete(rollout = {}, counts = {}) {
  const required = requiredValidationBatchSize(rollout, counts.totalProviders || 0);
  return required > 0
    && counts.selected === required
    && counts.checked === required;
}

function providerPriority(provider = {}) {
  let score = 0;
  if (provider.type === "psychiatrist") score += 100;
  else if (provider.type === "psychologist") score += 90;
  else if (["counsellor", "mens-centre", "addiction", "youth", "public-service"].includes(provider.type)) score += 70;
  else if (provider.type === "gp") score += 20;
  if (provider.needsManualVerification) score += 20;
  if (provider.availabilityStatus && provider.availabilityStatus !== "not_published") score += 15;
  if (provider.referralNeedsManualReview) score += 15;
  if (provider.onlineAvailable || provider.tags?.includes("telehealth")) score += 10;
  if (provider.tags?.some((tag) => ["maori", "pasifika", "asian", "rainbow"].includes(tag))) score += 10;
  const lastChecked = provider.validation?.lastCheckedAt ? new Date(provider.validation.lastCheckedAt).getTime() : 0;
  if (!lastChecked || Number.isNaN(lastChecked)) score += 1000;
  else score += Math.min(365, Math.max(0, Math.floor((Date.now() - lastChecked) / 86400000)));
  return score;
}

export function selectRolloutProviders(providers = [], rollout = {}, options = {}) {
  const explicitLimit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null;
  const stageLimit = stageProviderLimit(rollout.stage);
  const limit = explicitLimit ?? stageLimit;
  if (limit === 0) return options.shadowAll ? providers.map((provider) => provider.id) : [];
  return [...providers]
    .filter((provider) => !options.type
      || provider.type === options.type
      || (options.type === "specialist" && ["psychiatrist", "psychologist", "counsellor"].includes(provider.type)))
    .filter((provider) => !options.region || provider.region === options.region)
    .sort((a, b) => providerPriority(b) - providerPriority(a) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Number.isFinite(limit) ? limit : providers.length)
    .map((provider) => provider.id);
}

export function recordValidationRun(previous, run = {}) {
  const state = defaultRolloutState(previous);
  const entry = {
    runId: run.runId || "",
    generatedAt: run.generatedAt || new Date().toISOString(),
    stage: state.stage,
    clean: Boolean(run.clean),
    mode: run.mode || "shadow",
    providersChecked: Number(run.providersChecked || 0),
    reason: run.reason || ""
  };
  state.lastRunId = entry.runId;
  state.lastRunAt = entry.generatedAt;
  state.history = [...state.history, entry].slice(-100);
  state.cleanRunsAtStage = entry.clean ? state.cleanRunsAtStage + 1 : 0;

  if (state.stage === "shadow" && state.cleanRunsAtStage >= 3) {
    state.stage = "canary_50";
    state.cleanRunsAtStage = 0;
    state.readyToPublish = false;
    state.history.push({
      runId: entry.runId,
      generatedAt: entry.generatedAt,
      stage: "canary_50",
      clean: true,
      mode: "rollout_transition",
      providersChecked: 0,
      reason: "Three complete clean shadow passes finished; begin canary validation."
    });
  } else {
    state.readyToPublish = state.stage !== "shadow" && state.cleanRunsAtStage >= 3;
  }
  return state;
}

export function advanceRolloutAfterPublish(previous, runId, generatedAt = new Date().toISOString()) {
  const state = defaultRolloutState(previous);
  if (!state.readyToPublish) throw new Error(`Rollout stage ${state.stage} is not ready to publish.`);
  state.lastPublishedRunId = runId;
  const index = rolloutStages.indexOf(state.stage);
  const nextStage = rolloutStages[Math.min(index + 1, rolloutStages.length - 1)];
  state.history.push({
    runId,
    generatedAt,
    stage: state.stage,
    clean: true,
    mode: "publish",
    providersChecked: stageProviderLimit(state.stage),
    reason: `Published ${state.stage}; next stage is ${nextStage}.`
  });
  state.stage = nextStage;
  state.cleanRunsAtStage = 0;
  state.readyToPublish = false;
  return state;
}

export function readRolloutState(filePath) {
  if (!fs.existsSync(filePath)) return defaultRolloutState();
  return defaultRolloutState(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function writeRolloutState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}
