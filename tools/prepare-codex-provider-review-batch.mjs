import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PRIORITY_SCORE = { critical: 400, high: 300, medium: 200, low: 100 };
const SEVERITY_SCORE = { high: 30, medium: 20, low: 10, none: 0 };
const TYPE_SCORE = {
  psychiatrist: 90,
  psychologist: 80,
  counsellor: 70,
  "mens-centre": 65,
  youth: 60,
  addiction: 55,
  "public-service": 50,
  directory: 30,
  unknown: 20,
  gp: 0
};

const DEFAULTS = {
  queue: "data/provider-review-queue.json",
  providers: "providers.json",
  progress: "data/provider-validation/codex-progress.json",
  out: "data/provider-validation/codex-current-batch.json",
  markdown: "CODEX_PROVIDER_VALIDATION_BATCH.md",
  limit: 3,
  includeGps: false,
  claimLeaseHours: 12
};

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function queueItems(value) {
  if (Array.isArray(value)) return value;
  return asArray(value.items || value.queue);
}

function itemScore(item) {
  return (PRIORITY_SCORE[item.reviewPriority] || 0)
    + (SEVERITY_SCORE[item.auditSeverity] || 0)
    + (TYPE_SCORE[item.type] || 0);
}

function reviewMode(item) {
  const text = `${asArray(item.auditRules).join(" ")} ${asArray(item.auditIssues).join(" ")} ${item.reviewCategory || ""}`.toLowerCase();
  if (/not.accept|referrals?.paused|waitlist|availability/.test(text)) return "restrictive_availability_or_evidence_only";
  if (/unsupported|broad.tag|specialt|cultural|preference|telehealth|source.fit/.test(text)) return "safe_removal_or_evidence_only";
  if (/contact|phone|email|website|address|geocode|location/.test(text)) return "contact_or_location_corroboration";
  return "evidence_only";
}

function progressEntryIsEligible(entry, now, leaseHours) {
  if (!entry) return true;
  if (entry.status === "completed") return false;
  if (entry.nextEligibleAt && new Date(entry.nextEligibleAt).getTime() > now.getTime()) return false;
  if (entry.status !== "in_progress") return true;
  const startedAt = new Date(entry.startedAt || 0).getTime();
  return !startedAt || now.getTime() - startedAt >= leaseHours * 60 * 60 * 1000;
}

function compactRecord(item) {
  return {
    name: item.name || "",
    clinicianName: item.clinicianName || "",
    practiceName: item.practiceName || "",
    type: item.type || "unknown",
    region: item.region || "",
    city: item.city || "",
    address: item.address || "",
    phone: item.phone || "",
    text: item.text || "",
    email: item.email || "",
    website: item.website || "",
    bookingUrl: item.bookingUrl || "",
    source: item.source || "",
    availabilityStatus: item.availabilityStatus || "",
    availabilityEvidence: item.availabilityEvidence || "",
    requiresReferral: item.requiresReferral,
    referralType: item.referralType || "",
    referralSourceExcerpt: item.referralSourceExcerpt || "",
    tags: asArray(item.tags),
    needScope: asArray(item.needScope),
    advertisedSpecialties: asArray(item.advertisedSpecialties),
    specialties: asArray(item.specialties),
    services: asArray(item.services),
    patientGroups: asArray(item.patientGroups),
    ageGroups: asArray(item.ageGroups),
    onlineAvailable: item.onlineAvailable,
    phoneSupport: item.phoneSupport,
    inPerson: item.inPerson,
    cost: item.cost || ""
  };
}

function mergeProviderItems(items) {
  const sorted = [...items].sort((a, b) => itemScore(b) - itemScore(a) || String(a.reviewId).localeCompare(String(b.reviewId)));
  const first = sorted[0];
  return {
    providerId: first.providerId,
    reviewIds: sorted.map((item) => item.reviewId),
    reviewPriority: first.reviewPriority || "low",
    auditSeverity: first.auditSeverity || "none",
    reviewModes: unique(sorted.map(reviewMode)),
    reviewCategories: unique(sorted.map((item) => item.reviewCategory)),
    auditRules: unique(sorted.flatMap((item) => asArray(item.auditRules))),
    auditIssues: unique(sorted.flatMap((item) => asArray(item.auditIssues))),
    suggestedFixes: unique(sorted.flatMap((item) => asArray(item.suggestedFixes))),
    reviewReasons: unique(sorted.flatMap((item) => asArray(item.reviewReasons))),
    sourceUrls: unique(sorted.flatMap((item) => [
      ...asArray(item.sourceUrls),
      item.source,
      item.website,
      item.bookingUrl,
      item.availabilitySource,
      item.referralSourceUrl
    ])),
    sourceEvidenceSummary: unique(sorted.map((item) => item.sourceEvidenceSummary)).join("\n"),
    currentRecord: compactRecord(first),
    score: itemScore(first)
  };
}

export function buildCodexProviderReviewBatch({ queue, progress = {}, providerIds = null, limit = 3, includeGps = false, now = new Date(), claimLeaseHours = 12 } = {}) {
  const progressItems = progress.items || {};
  const eligible = queueItems(queue)
    .filter((item) => item.providerId && item.reviewId)
    .filter((item) => !providerIds || providerIds.has(item.providerId))
    .filter((item) => includeGps || item.type !== "gp")
    .filter((item) => progressEntryIsEligible(progressItems[item.reviewId], now, claimLeaseHours));
  const byProvider = new Map();
  for (const item of eligible) {
    const items = byProvider.get(item.providerId) || [];
    items.push(item);
    byProvider.set(item.providerId, items);
  }
  const items = [...byProvider.values()]
    .map(mergeProviderItems)
    .sort((a, b) => b.score - a.score || String(a.providerId).localeCompare(String(b.providerId)))
    .slice(0, Math.max(0, Number(limit) || 0));
  const generatedAt = now.toISOString();
  const batchId = `codex-${generatedAt.replace(/\D/g, "").slice(0, 14)}-${crypto.createHash("sha256").update(items.map((item) => item.providerId).join("|")).digest("hex").slice(0, 8)}`;
  return {
    version: 1,
    batchId,
    generatedAt,
    policy: "codex-safe-remediation-v1",
    constraints: [
      "Use public professional sources only and never bypass access controls.",
      "Do not add new providers in this lane.",
      "Do not set accepting availability or psychiatry self-referral.",
      "Do not add cultural, telehealth, condition, gender, age-group, or advertised-specialty claims.",
      "Safe actions are exact contact/location corrections, removal of unsupported positive claims, explicit restrictive availability, or needs_more_info.",
      "Every applied field needs an exact excerpt and source URL; uncertainty fails closed."
    ],
    items
  };
}

export function claimBatch(progress = {}, batch, now = new Date()) {
  const next = structuredClone(progress && typeof progress === "object" ? progress : {});
  next.version = 1;
  next.updatedAt = now.toISOString();
  next.items ||= {};
  next.batches ||= [];
  next.batches.push({ batchId: batch.batchId, generatedAt: batch.generatedAt, providerIds: batch.items.map((item) => item.providerId) });
  next.batches = next.batches.slice(-250);
  for (const item of batch.items) {
    for (const reviewId of item.reviewIds) {
      const previous = next.items[reviewId] || {};
      next.items[reviewId] = {
        ...previous,
        reviewId,
        providerId: item.providerId,
        status: "in_progress",
        batchId: batch.batchId,
        startedAt: now.toISOString(),
        attempts: Number(previous.attempts || 0) + 1
      };
    }
  }
  return next;
}

function markdown(batch) {
  const lines = [
    "# Codex Provider Validation Batch",
    "",
    `Generated: ${batch.generatedAt}`,
    `Batch: ${batch.batchId}`,
    `Providers: ${batch.items.length}`,
    "",
    "This is a local, no-API-key safe-remediation batch. Positive high-risk claims are prohibited.",
    ""
  ];
  for (const [index, item] of batch.items.entries()) {
    lines.push(`## ${index + 1}. ${item.currentRecord.name || item.providerId}`);
    lines.push("");
    lines.push(`- Provider ID: \`${item.providerId}\``);
    lines.push(`- Type/location: ${item.currentRecord.type} | ${item.currentRecord.city || "unknown city"} | ${item.currentRecord.region || "unknown region"}`);
    lines.push(`- Priority: ${item.reviewPriority} / ${item.auditSeverity}`);
    lines.push(`- Modes: ${item.reviewModes.join(", ")}`);
    lines.push(`- Rules: ${item.auditRules.join(", ") || "none"}`);
    lines.push(`- Sources: ${item.sourceUrls.join(" | ") || "none"}`);
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const config = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--queue") config.queue = argv[++index];
    else if (arg === "--providers") config.providers = argv[++index];
    else if (arg === "--progress") config.progress = argv[++index];
    else if (arg === "--out") config.out = argv[++index];
    else if (arg === "--markdown") config.markdown = argv[++index];
    else if (arg === "--limit") config.limit = Number(argv[++index]);
    else if (arg === "--include-gps") config.includeGps = true;
    else if (arg === "--claim-lease-hours") config.claimLeaseHours = Number(argv[++index]);
  }
  return config;
}

export function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const now = new Date();
  const queue = readJson(config.queue, { items: [] });
  const providers = readJson(config.providers, []);
  const progress = readJson(config.progress, { version: 1, items: {}, batches: [] });
  const batch = buildCodexProviderReviewBatch({ ...config, queue, progress, providerIds: new Set(providers.map((provider) => provider.id)), now });
  writeJson(config.out, batch);
  writeText(config.markdown, markdown(batch));
  writeJson(config.progress, claimBatch(progress, batch, now));
  console.log(`Prepared ${batch.items.length} provider(s) in ${batch.batchId}.`);
  console.log(`JSON: ${config.out}`);
  return batch;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
