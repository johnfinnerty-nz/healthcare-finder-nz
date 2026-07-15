import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ALLOWED_CORRECTED_FIELDS } from "./apply-provider-review-decisions.mjs";
import { buildProviderReviewQueue } from "./export-provider-review-queue.mjs";

const DEFAULTS = {
  queue: "data/provider-review-queue.json",
  decisionsOut: "data/provider-ai-review-decisions.json",
  promptsOut: "data/provider-ai-review-prompts.json",
  reportOut: "PROVIDER_AI_REVIEW_REPORT.md",
  reviewer: "AI provider reviewer",
  model: process.env.AI_REVIEW_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
  baseUrl: process.env.AI_REVIEW_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.AI_REVIEW_API_KEY || process.env.OPENAI_API_KEY || "",
  limit: 25,
  priority: "",
  severity: "",
  region: "",
  type: "",
  providerId: "",
  noNetwork: false,
  promptsOnly: false,
  includeAll: false
};

const VALID_DECISIONS = new Set(["approve", "adjust", "reject", "move_to_watchlist", "duplicate", "needs_more_info"]);
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2, unknown: 3 };
const RISKY_FIELDS = new Set(["verified", "lastVerified", "needsManualVerification"]);

class AiReviewRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AiReviewRequestError";
    this.status = options.status || 0;
    this.code = options.code || "";
    this.fatal = Boolean(options.fatal);
  }
}

export const AI_REVIEW_SYSTEM_PROMPT = `
You are an evidence-bound provider-data reviewer for a New Zealand healthcare navigation app.
The app may be used by stressed or vulnerable people, so provider data must be conservative, source-driven, and auditable.

You must use only the provided provider record, audit findings, and captured source evidence.
Do not invent contact details, availability, referral pathways, cultural tags, telehealth status, specialties, costs, addresses, or clinician genders.
If the evidence is weak, blocked, stale, conflicting, or only a search snippet, choose needs_more_info.
Never infer accepting new clients from silence.
Never infer self-referral psychiatry from contact details alone.
Never turn a directory/register into a direct provider without direct public provider evidence.
For psychologists and counsellors, broad condition tags require source evidence or explicit review approval.
For psychiatrists, baseline capability is a routing aid only; advertisedSpecialties still need source evidence.

Return a single JSON object only. No markdown.
Schema:
{
  "action": "approve|adjust|reject|move_to_watchlist|duplicate|needs_more_info",
  "confidence": "high|medium|low",
  "correctedFields": {},
  "keptProviderId": "",
  "sourceUrl": "",
  "sourceExcerpt": "",
  "auditRulesResolved": [],
  "reviewNotes": "",
  "riskFlags": [],
  "followUp": []
}
`.trim();

function parseArgs(argv = process.argv.slice(2)) {
  const config = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--queue") config.queue = argv[++index];
    else if (arg === "--decisions-out") config.decisionsOut = argv[++index];
    else if (arg === "--prompts-out") config.promptsOut = argv[++index];
    else if (arg === "--report-out") config.reportOut = argv[++index];
    else if (arg === "--reviewer") config.reviewer = argv[++index];
    else if (arg === "--model") config.model = argv[++index];
    else if (arg === "--base-url") config.baseUrl = argv[++index];
    else if (arg === "--limit") config.limit = Number(argv[++index]);
    else if (arg === "--priority") config.priority = argv[++index];
    else if (arg === "--severity") config.severity = argv[++index];
    else if (arg === "--region") config.region = argv[++index];
    else if (arg === "--type") config.type = argv[++index];
    else if (arg === "--provider-id") config.providerId = argv[++index];
    else if (arg === "--no-network") config.noNetwork = true;
    else if (arg === "--prompts-only") config.promptsOnly = true;
    else if (arg === "--include-all") config.includeAll = true;
  }
  return config;
}

function readJsonIfExists(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value, max = 700) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstSourceUrl(item) {
  return asArray(item.sourceUrls)[0] || item.source || item.website || item.availabilitySource || item.referralSourceUrl || "";
}

function flattenEvidence(sourceEvidence = {}) {
  const evidence = [];
  for (const [bucket, values] of Object.entries(sourceEvidence || {})) {
    for (const value of asArray(values)) {
      if (!value || typeof value !== "object") continue;
      evidence.push({
        bucket,
        field: value.field || "",
        value: compact(value.value, 240),
        sourceUrl: value.sourceUrl || "",
        sourceType: value.sourceType || "",
        excerpt: compact(value.excerpt, 900),
        capturedAt: value.capturedAt || "",
        confidence: value.confidence || "unknown",
        needsManualReview: value.needsManualReview !== false
      });
    }
  }
  return evidence
    .filter((item) => item.excerpt || item.value || item.sourceUrl)
    .sort((a, b) => (CONFIDENCE_RANK[a.confidence] ?? 3) - (CONFIDENCE_RANK[b.confidence] ?? 3))
    .slice(0, 18);
}

function publicFieldsForReview(item) {
  return {
    providerId: item.providerId,
    name: item.name,
    clinicianName: item.clinicianName,
    practiceName: item.practiceName,
    type: item.type,
    region: item.region,
    city: item.city,
    address: item.address,
    lat: item.lat,
    lon: item.lon,
    phone: item.phone,
    text: item.text,
    email: item.email,
    website: item.website,
    bookingUrl: item.bookingUrl,
    source: item.source,
    sourceQuality: item.sourceQuality,
    confidence: item.confidence,
    needsManualVerification: item.needsManualVerification,
    verified: item.verified,
    lastVerified: item.lastVerified,
    availabilityStatus: item.availabilityStatus,
    availabilityEvidence: item.availabilityEvidence,
    availabilitySource: item.availabilitySource,
    availabilityNeedsManualReview: item.availabilityNeedsManualReview,
    requiresReferral: item.requiresReferral,
    referralType: item.referralType,
    referralSourceUrl: item.referralSourceUrl,
    referralSourceExcerpt: item.referralSourceExcerpt,
    referralConfidence: item.referralConfidence,
    referralNeedsManualReview: item.referralNeedsManualReview,
    tags: item.tags || [],
    needScope: item.needScope || [],
    baselineScope: item.baselineScope || [],
    advertisedSpecialties: item.advertisedSpecialties || [],
    specialties: item.specialties || [],
    services: item.services || [],
    patientGroups: item.patientGroups || [],
    ageGroups: item.ageGroups || [],
    onlineAvailable: item.onlineAvailable,
    phoneSupport: item.phoneSupport,
    inPerson: item.inPerson,
    crisisOnly: item.crisisOnly,
    fit: item.fit,
    firstStep: item.firstStep,
    cost: item.cost,
    hours: item.hours
  };
}

export function buildAiReviewTask(item) {
  return {
    task: "Review this provider queue item and draft one conservative review decision.",
    reviewId: item.reviewId,
    reviewCategory: item.reviewCategory,
    reviewPriority: item.reviewPriority,
    auditSeverity: item.auditSeverity,
    auditRules: item.auditRules || [],
    auditIssues: item.auditIssues || [],
    suggestedFixes: item.suggestedFixes || [],
    reviewReasons: item.reviewReasons || [],
    currentPublicRecord: publicFieldsForReview(item),
    fieldsThatAffectRanking: {
      type: item.type,
      region: item.region,
      city: item.city,
      tags: item.tags || [],
      needScope: item.needScope || [],
      advertisedSpecialties: item.advertisedSpecialties || [],
      baselineScope: item.baselineScope || [],
      availabilityStatus: item.availabilityStatus,
      referralType: item.referralType,
      onlineAvailable: item.onlineAvailable,
      phoneSupport: item.phoneSupport,
      inPerson: item.inPerson,
      crisisOnly: item.crisisOnly
    },
    existingSuggestedCorrectedFields: item.correctedFields || {},
    sourceEvidenceSummary: compact(item.sourceEvidenceSummary, 1600),
    sourceUrls: unique([...(item.sourceUrls || []), firstSourceUrl(item)]),
    capturedEvidence: flattenEvidence(item.sourceEvidence),
    allowedCorrectedFields: [...ALLOWED_CORRECTED_FIELDS],
    decisionRules: [
      "Choose needs_more_info when the source evidence does not directly support a safe decision.",
      "Use adjust only for fields directly supported by captured evidence.",
      "Use move_to_watchlist only when explicit evidence says unavailable, not accepting, referrals paused, or similar.",
      "Use reject only when evidence shows the record is not a relevant provider, is a directory treated as direct, or is unsafe for live recommendations.",
      "Use duplicate only when the keptProviderId is clear from evidence.",
      "Do not clear needsManualVerification or set verified/lastVerified; the controlled apply step and human policy handle verification status."
    ]
  };
}

export function buildAiReviewPrompt(item) {
  return {
    system: AI_REVIEW_SYSTEM_PROMPT,
    user: JSON.stringify(buildAiReviewTask(item), null, 2)
  };
}

function parseJsonObject(text) {
  if (text && typeof text === "object" && !Array.isArray(text)) return text;
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const object = raw.match(/\{[\s\S]*\}/)?.[0];
    if (object) return JSON.parse(object);
  }
  throw new Error("AI response did not contain a parseable JSON object.");
}

function evidenceText(item, proposal) {
  return compact([
    proposal.sourceExcerpt,
    proposal.reviewNotes,
    item.sourceEvidenceSummary,
    item.availabilityEvidence,
    item.referralSourceExcerpt,
    ...flattenEvidence(item.sourceEvidence).map((evidence) => evidence.excerpt)
  ].join(" "), 3000);
}

function hasAcceptingAvailabilityEvidence(text) {
  return /\b(accepting new|taking new|taking on new|currently accepting|appointments? available|available appointments?|book online|booking available|open for referrals|available for new)\b/i.test(text || "");
}

function hasSelfReferralEvidence(text) {
  return /\b(self[- ]?refer|refer yourself|no referral|without referral|book directly|contact us directly|self referral)\b/i.test(text || "");
}

function sanitiseCorrectedFields(fields, guardrails, options = {}) {
  const correctedFields = {};
  for (const [field, value] of Object.entries(fields || {})) {
    if (!ALLOWED_CORRECTED_FIELDS.has(field)) {
      guardrails.push(`Removed unsafe corrected field: ${field}`);
      continue;
    }
    if (RISKY_FIELDS.has(field) && !options.allowVerificationFields) {
      guardrails.push(`Removed verification field from AI draft: ${field}`);
      continue;
    }
    correctedFields[field] = value;
  }
  return correctedFields;
}

function sourceExcerptFor(item, proposal) {
  return compact(proposal.sourceExcerpt || item.sourceEvidenceSummary || flattenEvidence(item.sourceEvidence)[0]?.excerpt || "", 1200);
}

export function normaliseAiReviewProposal(item, rawProposal, config = {}) {
  const guardrailsApplied = [];
  let proposal;
  try {
    proposal = parseJsonObject(rawProposal);
  } catch (error) {
    proposal = {
      action: "needs_more_info",
      confidence: "low",
      correctedFields: {},
      reviewNotes: `AI response could not be parsed: ${error.message}`,
      riskFlags: ["parse-failed"],
      followUp: ["Run this item again or review manually."]
    };
    guardrailsApplied.push("Converted unparseable AI response to needs_more_info.");
  }

  let action = VALID_DECISIONS.has(proposal.action) ? proposal.action : "needs_more_info";
  if (action !== proposal.action) guardrailsApplied.push(`Unsupported action "${proposal.action}" changed to needs_more_info.`);

  const confidence = ["high", "medium", "low"].includes(proposal.confidence) ? proposal.confidence : "low";
  let correctedFields = sanitiseCorrectedFields(proposal.correctedFields || {}, guardrailsApplied, config);
  const combinedEvidence = evidenceText(item, proposal);

  if (correctedFields.availabilityStatus === "accepting" && !hasAcceptingAvailabilityEvidence(combinedEvidence)) {
    delete correctedFields.availabilityStatus;
    guardrailsApplied.push("Removed accepting availability because explicit availability evidence was missing.");
  }

  if (item.type === "psychiatrist" && correctedFields.referralType === "self" && !hasSelfReferralEvidence(combinedEvidence)) {
    delete correctedFields.referralType;
    guardrailsApplied.push("Removed psychiatrist self-referral because explicit self-referral evidence was missing.");
  }

  if (action === "adjust" && Object.keys(correctedFields).length === 0) {
    action = "needs_more_info";
    guardrailsApplied.push("Changed adjust to needs_more_info because no safe corrected fields remained.");
  }

  if (action === "approve" && !sourceExcerptFor(item, proposal)) {
    action = "needs_more_info";
    guardrailsApplied.push("Changed approve to needs_more_info because no source excerpt was available.");
  }

  if (action === "move_to_watchlist" && !sourceExcerptFor(item, proposal)) {
    action = "needs_more_info";
    guardrailsApplied.push("Changed move_to_watchlist to needs_more_info because no availability excerpt was available.");
  }

  if (action === "duplicate" && !proposal.keptProviderId) {
    action = "needs_more_info";
    guardrailsApplied.push("Changed duplicate to needs_more_info because keptProviderId was missing.");
  }

  return {
    providerId: item.providerId,
    providerName: item.name,
    action,
    reviewDecision: action,
    correctedFields,
    keptProviderId: action === "duplicate" ? proposal.keptProviderId || "" : "",
    reviewer: config.reviewer || DEFAULTS.reviewer,
    reviewedDate: new Date().toISOString().slice(0, 10),
    sourceUrl: proposal.sourceUrl || firstSourceUrl(item),
    sourceExcerpt: sourceExcerptFor(item, proposal),
    sourceEvidenceSummary: compact(item.sourceEvidenceSummary || "", 1200),
    auditRulesResolved: asArray(proposal.auditRulesResolved).filter((rule) => asArray(item.auditRules).includes(rule)),
    reviewNotes: compact(proposal.reviewNotes || "AI review draft. Confirm before applying to live provider data.", 1400),
    aiReview: {
      generatedAt: new Date().toISOString(),
      model: config.model || DEFAULTS.model,
      reviewId: item.reviewId,
      confidence,
      originalAction: proposal.action || "",
      riskFlags: asArray(proposal.riskFlags).map((value) => compact(value, 180)),
      followUp: asArray(proposal.followUp).map((value) => compact(value, 240)),
      guardrailsApplied
    },
    requiresHumanApproval: true
  };
}

function heuristicProposal(item, reason) {
  return {
    action: "needs_more_info",
    confidence: "low",
    correctedFields: {},
    sourceUrl: firstSourceUrl(item),
    sourceExcerpt: "",
    auditRulesResolved: [],
    reviewNotes: [
      reason || "No AI API call was made.",
      `Review priority: ${item.reviewPriority || "unknown"}.`,
      item.sourceEvidenceSummary ? `Evidence summary available: ${compact(item.sourceEvidenceSummary, 320)}` : "No strong captured evidence summary was available."
    ].join(" "),
    riskFlags: ["not-ai-reviewed"],
    followUp: [
      "Open the source links and capture evidence, or rerun with AI_REVIEW_API_KEY / OPENAI_API_KEY set.",
      "Apply nothing to live provider data until the controlled review decision path passes validation."
    ]
  };
}

async function callOpenAiCompatible(prompt, config) {
  const url = `${String(config.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || DEFAULTS.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }
    const code = parsed.error?.code || "";
    const message = parsed.error?.message || compact(body, 600) || response.statusText;
    throw new AiReviewRequestError(`AI review request failed with ${response.status}: ${message}`, {
      status: response.status,
      code,
      fatal: response.status === 401 || response.status === 403 || code === "insufficient_quota"
    });
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI review response did not contain message content.");
  return content;
}

function matchesFilters(item, config) {
  if (config.providerId && item.providerId !== config.providerId) return false;
  if (config.priority && item.reviewPriority !== config.priority) return false;
  if (config.severity && item.auditSeverity !== config.severity) return false;
  if (config.region && item.region !== config.region) return false;
  if (config.type && item.type !== config.type) return false;
  return true;
}

function loadOrBuildQueue(config) {
  if (fs.existsSync(config.queue)) return readJsonIfExists(config.queue, { items: [] });
  const queue = buildProviderReviewQueue({});
  writeJson(config.queue, queue);
  return queue;
}

function countBy(values, picker) {
  return values.reduce((acc, value) => {
    const key = picker(value) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function markdownReport(result) {
  const lines = [
    "# Provider AI Review Report",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Queue: ${result.queuePath}`,
    `- Model: ${result.model}`,
    `- Network AI call: ${result.noNetwork ? "no" : "yes"}`,
    `- Items selected: ${result.summary.itemsSelected}`,
    `- Decisions drafted: ${result.summary.decisionsDrafted}`,
    `- Parse/API errors: ${result.summary.errors}`,
    `- Apply safety: AI drafts are blocked by \`apply-provider-review-decisions.mjs\` unless explicitly allowed.`,
    "",
    "## Drafted Actions",
    ""
  ];

  for (const [action, count] of Object.entries(result.summary.byAction)) {
    lines.push(`- ${action}: ${count}`);
  }

  lines.push("", "## Guardrails Applied", "");
  const guardrails = countBy(
    result.decisions.flatMap((decision) => decision.aiReview?.guardrailsApplied || []),
    (item) => item
  );
  if (Object.keys(guardrails).length) {
    for (const [guardrail, count] of Object.entries(guardrails)) lines.push(`- ${guardrail}: ${count}`);
  } else {
    lines.push("- No local guardrails changed AI output.");
  }

  lines.push("", "## Next Steps", "");
  lines.push("1. Inspect `data/provider-ai-review-decisions.json` before applying anything.");
  lines.push("2. If you intentionally want to apply AI-reviewed decisions, use `npm run apply:review -- --decisions data/provider-ai-review-decisions.json --allow-ai-review-decisions --dry-run` first.");
  lines.push("3. Run `npm test`, `npm run validate:data`, and the provider audits after any apply.");
  lines.push("4. Do not apply AI approve/import decisions for high-risk provider records without stronger human or source verification.");

  if (result.errors.length) {
    lines.push("", "## Errors", "");
    for (const error of result.errors.slice(0, 50)) lines.push(`- ${error.providerId || error.reviewId}: ${error.error}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function buildAiReviewDraft(config = {}) {
  const merged = { ...DEFAULTS, ...config };
  const queue = loadOrBuildQueue(merged);
  const allItems = asArray(queue.items).filter((item) => matchesFilters(item, merged));
  const selected = (merged.includeAll ? allItems : allItems.filter((item) => item.reviewPriority !== "low"))
    .slice(0, Number.isFinite(merged.limit) && merged.limit > 0 ? merged.limit : allItems.length);
  const noNetwork = merged.noNetwork || merged.promptsOnly || !merged.apiKey;
  const decisions = [];
  const prompts = [];
  const errors = [];
  let fatalAiError = null;

  for (const item of selected) {
    const prompt = buildAiReviewPrompt(item);
    prompts.push({
      reviewId: item.reviewId,
      providerId: item.providerId,
      providerName: item.name,
      prompt
    });

    if (merged.promptsOnly) continue;

    try {
      const raw = noNetwork
        ? heuristicProposal(item, merged.apiKey ? "AI network calls were disabled by --no-network." : "No AI API key was available.")
        : fatalAiError
          ? heuristicProposal(item, `AI review skipped after a fatal API error: ${fatalAiError.message}`)
        : await callOpenAiCompatible(prompt, merged);
      decisions.push(normaliseAiReviewProposal(item, raw, { ...merged, model: noNetwork ? "heuristic-no-network" : merged.model }));
    } catch (error) {
      errors.push({ reviewId: item.reviewId, providerId: item.providerId, error: error.message });
      decisions.push(normaliseAiReviewProposal(item, heuristicProposal(item, `AI review failed: ${error.message}`), { ...merged, model: merged.model }));
      if (error.fatal) fatalAiError = error;
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "provider-ai-reviewer",
    queuePath: merged.queue,
    model: noNetwork ? "heuristic-no-network" : merged.model,
    noNetwork,
    filters: {
      limit: merged.limit,
      priority: merged.priority,
      severity: merged.severity,
      region: merged.region,
      type: merged.type,
      providerId: merged.providerId,
      includeAll: merged.includeAll
    },
    summary: {
      queueItems: asArray(queue.items).length,
      itemsMatched: allItems.length,
      itemsSelected: selected.length,
      promptsWritten: prompts.length,
      decisionsDrafted: decisions.length,
      errors: errors.length,
      byAction: countBy(decisions, (decision) => decision.action)
    },
    prompts,
    decisions,
    errors
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const result = await buildAiReviewDraft(config);
  writeJson(config.promptsOut, {
    version: result.version,
    generatedAt: result.generatedAt,
    model: result.model,
    prompts: result.prompts
  });
  if (!config.promptsOnly) {
    writeJson(config.decisionsOut, {
      version: result.version,
      generatedAt: result.generatedAt,
      generatedBy: result.generatedBy,
      model: result.model,
      noNetwork: result.noNetwork,
      summary: result.summary,
      decisions: result.decisions
    });
  }
  writeText(config.reportOut, markdownReport(result));
  console.log(`Selected ${result.summary.itemsSelected} provider review item(s).`);
  console.log(`Wrote ${result.prompts.length} AI review prompt(s) to ${config.promptsOut}.`);
  if (!config.promptsOnly) console.log(`Drafted ${result.decisions.length} AI review decision proposal(s) to ${config.decisionsOut}.`);
  if (result.noNetwork && !config.promptsOnly) console.log("No AI API key/network call was used; decisions are conservative needs_more_info placeholders.");
  if (result.errors.length) console.log(`Completed with ${result.errors.length} AI review error(s); see ${config.reportOut}.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
