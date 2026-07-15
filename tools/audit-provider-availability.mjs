import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  availabilityCadenceDays,
  availabilityEvidenceText,
  availabilityStatuses,
  daysSince,
  detectAvailabilityFromText,
  directAvailabilityTypes,
  isAvailabilityStale,
  isCrisisProvider,
  isDirectoryLike,
  normaliseAvailabilityStatus,
  providerAvailability,
  requiresAvailabilityMetadata,
  restrictiveStatuses,
  statusFromWatchlistItem
} from "./lib/provider-availability.mjs";

const defaultPaths = {
  providers: "providers.json",
  watchlist: "data/monitors/provider-availability-watchlist.json",
  allowlist: "data/provider-availability-allowlist.json",
  recheck: "data/provider-availability-recheck-results.json",
  json: "data/provider-availability-audit.json",
  markdown: "AVAILABILITY_RECHECK_REPORT.md"
};

const currentBehaviour = {
  scheduledRecheckPreviouslyExisted: true,
  notes: [
    "Before this availability-freshness layer, unavailable providers were usually removed from providers.json and stored in data/monitors/provider-availability-watchlist.json.",
    "The weekly GitHub Actions workflow already ran tools/check-provider-availability.mjs against that watchlist and uploaded data/reports/provider-availability-monitor.json.",
    "Live providers did not have explicit availabilityStatus metadata, and the UI ranking did not use availability status directly.",
    "The link checker checked reachability only; it did not infer provider availability."
  ]
};

function readJsonIfExists(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readRequiredJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required JSON file not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function hasExplicitAcceptingEvidence(provider, detected) {
  if (detected.status === "accepting" && detected.evidence) return true;
  return /\baccepting new|taking new|currently available|self-referral is currently available|book (?:a )?(?:session|appointment|consultation) online\b/i
    .test(`${provider.availabilityEvidence || ""} ${provider.availabilityNote || ""}`);
}

function severityForStaleStatus(status) {
  if (status === "not_accepting" || status === "referrals_paused") return "high";
  if (status === "waitlist" || status === "accepting") return "medium";
  return "low";
}

function severityForStaleWatchlistStatus(status) {
  // A stale restrictive watchlist record remains excluded from normal first
  // recommendations. It is operationally urgent to recheck, but it is not the
  // same public-safety risk as stale restrictive metadata on a live provider.
  if (status === "not_accepting" || status === "referrals_paused" || status === "accepting") return "medium";
  return severityForStaleStatus(status);
}

function addFinding(findings, item) {
  findings.push({
    providerId: item.providerId || "",
    providerName: item.providerName || "",
    region: item.region || "",
    city: item.city || "",
    type: item.type || "",
    source: item.source || "",
    availabilityStatus: item.availabilityStatus || "",
    availabilityCheckedAt: item.availabilityCheckedAt || "",
    rule: item.rule,
    severity: item.severity,
    issue: item.issue,
    suggestedAction: item.suggestedAction
  });
}

function allowlistKey(providerId, rule = "") {
  return `${providerId}::${rule || "*"}`;
}

function normaliseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function datePart(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isExpired(value, today = new Date()) {
  const date = normaliseDate(value);
  if (!date) return true;
  return new Date(`${date}T23:59:59Z`) < today;
}

function buildAllowlist(entries, today = new Date()) {
  const map = new Map();
  const expired = [];
  for (const item of Array.isArray(entries) ? entries : []) {
    if (!item?.id || !item.reason || !item.reviewedBy || !item.reviewedDate || !item.expiryDate) {
      expired.push({ ...item, invalid: true });
      continue;
    }
    if (isExpired(item.expiryDate, today)) {
      expired.push(item);
      continue;
    }
    map.set(allowlistKey(item.id, item.rule), item);
  }
  return { map, expired };
}

function applyAllowlist(findings, allowlistEntries, today) {
  const { map, expired } = buildAllowlist(allowlistEntries, today);
  const withAllowlist = findings.map((finding) => {
    const specific = map.get(allowlistKey(finding.providerId, finding.rule));
    const broad = map.get(allowlistKey(finding.providerId));
    const item = specific || broad || null;
    return item ? { ...finding, allowlisted: true, allowlist: item } : { ...finding, allowlisted: false };
  });

  for (const item of expired) {
    withAllowlist.push({
      providerId: item.id || "",
      providerName: item.id || "(unknown)",
      region: "",
      city: "",
      type: "",
      source: "",
      availabilityStatus: "",
      availabilityCheckedAt: "",
      rule: "expired-or-invalid-availability-allowlist",
      severity: "high",
      issue: item.invalid
        ? "Availability allowlist item is missing required review metadata."
        : "Availability allowlist item has expired.",
      suggestedAction: "Review the provider again, then remove or renew the allowlist item with a fresh expiry date.",
      allowlisted: false
    });
  }

  return withAllowlist;
}

function auditProvider(provider, findings, today) {
  const status = normaliseAvailabilityStatus(provider.availabilityStatus);
  const detected = detectAvailabilityFromText(availabilityEvidenceText(provider));
  const availability = providerAvailability(provider);
  const checkedAt = provider.availabilityCheckedAt || availability.checkedAt;
  const source = provider.availabilitySource || provider.source || provider.website || "";
  const requiresMetadata = requiresAvailabilityMetadata(provider);
  const liveDirect = directAvailabilityTypes.has(provider.type) && !isDirectoryLike(provider);

  if (!status) {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      rule: "missing-or-invalid-availability-status",
      severity: "high",
      issue: provider.availabilityStatus
        ? `Invalid availabilityStatus "${provider.availabilityStatus}".`
        : "Provider is missing availabilityStatus.",
      suggestedAction: "Set availabilityStatus to accepting, waitlist, not_accepting, referrals_paused, unknown, or not_published."
    });
  }

  if (requiresMetadata && !checkedAt) {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      rule: "missing-availability-checked-at",
      severity: "high",
      issue: "Direct provider has no availabilityCheckedAt date.",
      suggestedAction: "Add the month/date when availability was last checked or mark the record for manual review."
    });
  }

  if (status && checkedAt && isAvailabilityStale(status, checkedAt, today) && requiresMetadata) {
    const age = daysSince(checkedAt, today);
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "stale-availability",
      severity: severityForStaleStatus(status),
      issue: `${status} availability is ${age} days old; target cadence is ${availabilityCadenceDays[status]} days.`,
      suggestedAction: "Recheck the provider source or add a manual review item. Do not infer accepting from silence."
    });
  }

  if (status === "accepting" && !hasExplicitAcceptingEvidence(provider, detected)) {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "accepting-without-explicit-evidence",
      severity: "high",
      issue: "Provider is marked accepting without explicit accepting-new-clients evidence in stored source fields.",
      suggestedAction: "Change to unknown/not_published or add a short availabilityEvidence excerpt from the source."
    });
  }

  if (restrictiveStatuses.has(detected.status) && status && !restrictiveStatuses.has(status)) {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "restrictive-evidence-status-mismatch",
      severity: "high",
      issue: `Stored source fields contain restrictive availability evidence: "${detected.evidence}".`,
      suggestedAction: "Move to the unavailable watchlist or set not_accepting/referrals_paused and keep it out of first recommendations."
    });
  }

  if (isDirectoryLike(provider) && status === "accepting") {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "directory-marked-accepting",
      severity: "high",
      issue: "A directory/navigator is marked as accepting like a direct provider.",
      suggestedAction: "Use not_published or unknown for directories; do not rank them as direct accepting providers."
    });
  }

  if (isCrisisProvider(provider) && status === "accepting") {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "crisis-routine-availability",
      severity: "medium",
      issue: "Crisis-only support is marked as accepting routine care.",
      suggestedAction: "Keep crisis guidance prominent, but avoid presenting crisis teams as normal routine-care availability."
    });
  }

  if (liveDirect && restrictiveStatuses.has(status)) {
    addFinding(findings, {
      providerId: provider.id,
      providerName: provider.name,
      region: provider.region,
      city: provider.city,
      type: provider.type,
      source,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "live-provider-unavailable",
      severity: "high",
      issue: "Live provider is marked unavailable or referrals paused.",
      suggestedAction: "Keep out of first recommendations and consider moving to the availability watchlist until rechecked."
    });
  }
}

function addWatchlistRecheckFinding(item, result, findings) {
  const sourceStatus = normaliseAvailabilityStatus(item.availabilityStatus) || statusFromWatchlistItem(item);
  const detectedStatus = result.detectedStatus || "unknown";
  const isPossiblyAvailable = ["possibly_available", "accepting"].includes(detectedStatus);

  addFinding(findings, {
    providerId: item.id,
    providerName: item.name,
    region: item.region,
    city: item.city,
    type: item.type,
    source: item.url,
    availabilityStatus: detectedStatus,
    availabilityCheckedAt: datePart(result.checkedAt),
    rule: isPossiblyAvailable ? "watchlist-possibly-available" : "watchlist-availability-not-confirmed",
    severity: "medium",
    issue: isPossiblyAvailable
      ? `Fresh recheck found possible availability for a watchlist provider previously marked ${sourceStatus}.`
      : `Fresh recheck could not confirm the stored ${sourceStatus} watchlist evidence.`,
    suggestedAction: isPossiblyAvailable
      ? "Manually verify before moving this provider back into live recommendations."
      : "Keep suppressed from first recommendations until a manual browser/call/email review confirms availability."
  });
}

function auditWatchlistItem(item, findings, today, recheckById = new Map()) {
  const status = normaliseAvailabilityStatus(item.availabilityStatus) || statusFromWatchlistItem(item);
  const checkedAt = item.availabilityCheckedAt || item.checkedAt || "";
  const age = daysSince(checkedAt, today);
  const result = item.id ? recheckById.get(item.id) : null;
  const recheckDate = result ? datePart(result.checkedAt) : "";
  const hasFreshRecheck = recheckDate && !isAvailabilityStale(status, recheckDate, today);

  if (!item.id || !item.url || !item.providerCandidate) {
    addFinding(findings, {
      providerId: item.id,
      providerName: item.name,
      region: item.region,
      city: item.city,
      type: item.type,
      source: item.url,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "watchlist-missing-required-fields",
      severity: "high",
      issue: "Watchlist item is missing id, url, or providerCandidate.",
      suggestedAction: "Repair the watchlist item before the next recheck."
    });
  }

  if (!checkedAt || isAvailabilityStale(status, checkedAt, today)) {
    if (hasFreshRecheck) {
      if (restrictiveStatuses.has(result.detectedStatus) && result.detectedStatus === status) return;
      if (["check_failed", "blocked", "unreachable"].includes(result.detectedStatus) || result.blocked) return;
      addWatchlistRecheckFinding(item, result, findings);
      return;
    }

    addFinding(findings, {
      providerId: item.id,
      providerName: item.name,
      region: item.region,
      city: item.city,
      type: item.type,
      source: item.url,
      availabilityStatus: status,
      availabilityCheckedAt: checkedAt,
      rule: "stale-watchlist-availability",
      severity: severityForStaleWatchlistStatus(status),
      issue: checkedAt
        ? `Watchlist ${status} evidence is ${age} days old; target cadence is ${availabilityCadenceDays[status]} days.`
        : "Watchlist item has no checkedAt or availabilityCheckedAt date.",
      suggestedAction: "Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation."
    });
  }
}

function auditRecheckResult(result, findings) {
  if (result.changed) {
    addFinding(findings, {
      providerId: result.id,
      providerName: result.name,
      region: result.region,
      city: result.city,
      type: result.type,
      source: result.url,
      availabilityStatus: result.detectedStatus,
      availabilityCheckedAt: datePart(result.checkedAt),
      rule: "availability-recheck-status-changed",
      severity: "medium",
      issue: `Availability recheck detected "${result.detectedStatus}" where the stored status is "${result.currentStatus || "unknown"}".`,
      suggestedAction: "Review the source manually before changing live recommendations or watchlist status."
    });
    return;
  }

  if (!["check_failed", "blocked", "unreachable"].includes(result.detectedStatus) && !result.blocked) return;
  addFinding(findings, {
    providerId: result.id,
    providerName: result.name,
    region: result.region,
    city: result.city,
    type: result.type,
    source: result.url,
    availabilityStatus: result.detectedStatus,
    availabilityCheckedAt: result.checkedAt,
    rule: "blocked-or-unreachable-source",
    severity: "medium",
    issue: `Availability recheck could not read the source (${result.httpStatus || result.error || "unknown"}).`,
    suggestedAction: "Create a manual call/email/browser review item. Do not infer accepting or unavailable from a blocked page."
  });
}

function countBy(items, keyer) {
  const counts = {};
  for (const item of items) {
    const key = keyer(item) || "missing";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function regionsAffectedByUnavailable(providers, watchlistItems) {
  return countBy([
    ...providers.filter((provider) => restrictiveStatuses.has(provider.availabilityStatus)),
    ...watchlistItems
  ], (item) => item.region);
}

export function auditAvailability({
  providers,
  watchlistItems = [],
  allowlistEntries = [],
  recheckResults = [],
  generatedAt = new Date().toISOString()
}) {
  const today = new Date(generatedAt);
  const findings = [];
  const recheckById = new Map(recheckResults.filter((result) => result?.id).map((result) => [result.id, result]));

  for (const provider of providers) auditProvider(provider, findings, today);
  for (const item of watchlistItems) auditWatchlistItem(item, findings, today, recheckById);
  for (const result of recheckResults) auditRecheckResult(result, findings);

  const findingsWithAllowlist = applyAllowlist(findings, allowlistEntries, today)
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity]
        || a.providerId.localeCompare(b.providerId)
        || a.rule.localeCompare(b.rule);
    });

  const highFindings = findingsWithAllowlist.filter((finding) => finding.severity === "high");
  const highUnallowlisted = highFindings.filter((finding) => !finding.allowlisted);

  const liveStatusCounts = countBy(providers, (provider) => provider.availabilityStatus);
  const watchlistStatusCounts = countBy(watchlistItems, (item) =>
    normaliseAvailabilityStatus(item.availabilityStatus) || statusFromWatchlistItem(item)
  );

  return {
    generatedAt,
    currentBehaviour,
    providersScanned: providers.length,
    watchlistItemsScanned: watchlistItems.length,
    recheckResultsScanned: recheckResults.length,
    allowedAvailabilityStatuses: [...availabilityStatuses],
    cadenceDays: availabilityCadenceDays,
    statusCounts: {
      liveProviders: liveStatusCounts,
      watchlist: watchlistStatusCounts
    },
    regionsAffectedByUnavailable: regionsAffectedByUnavailable(providers, watchlistItems),
    findings: findingsWithAllowlist,
    summary: {
      total: findingsWithAllowlist.length,
      high: highFindings.length,
      medium: findingsWithAllowlist.filter((finding) => finding.severity === "medium").length,
      low: findingsWithAllowlist.filter((finding) => finding.severity === "low").length,
      highUnallowlisted: highUnallowlisted.length,
      allowlisted: findingsWithAllowlist.filter((finding) => finding.allowlisted).length
    }
  };
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function listCounts(counts) {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- none";
}

function markdownReport(report) {
  const lines = [
    "# Availability Recheck Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Current Behaviour Before This Change",
    "",
    `Scheduled recheck previously existed: ${report.currentBehaviour.scheduledRecheckPreviouslyExisted ? "yes" : "no"}.`,
    "",
    ...report.currentBehaviour.notes.map((note) => `- ${note}`),
    "",
    "## Recheck Cadence",
    "",
    "- not_accepting: recheck or flag daily until the provider reopens or the source changes",
    "- referrals_paused: recheck or flag every 14 days",
    "- waitlist: recheck or flag every 30 days",
    "- unknown / not_published: review every 90 days where practical",
    "- accepting: review daily and only use when explicit current source evidence exists",
    "",
    "Accepting is never inferred from silence. Blocked or unreachable pages create manual review items.",
    "",
    "## Status Counts",
    "",
    "Live providers:",
    "",
    listCounts(report.statusCounts.liveProviders),
    "",
    "Unavailable watchlist:",
    "",
    listCounts(report.statusCounts.watchlist),
    "",
    "Regions most affected by unavailable/watchlist records:",
    "",
    listCounts(report.regionsAffectedByUnavailable),
    "",
    `Findings: ${report.summary.total} total, ${report.summary.high} high (${report.summary.highUnallowlisted} unallowlisted), ${report.summary.medium} medium, ${report.summary.low} low.`,
    ""
  ];

  if (!report.findings.length) {
    lines.push("No availability freshness issues found.", "");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Severity | Provider | Region / city | Status | Checked | Issue | Suggested action | Source | Allowlisted |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const finding of report.findings) {
    lines.push([
      finding.severity,
      `${finding.providerId} - ${finding.providerName}`,
      `${finding.region} / ${finding.city}`,
      finding.availabilityStatus,
      finding.availabilityCheckedAt,
      finding.issue,
      finding.suggestedAction,
      finding.source,
      finding.allowlisted ? `yes: ${finding.allowlist.reason}` : "no"
    ].map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const config = { ...defaultPaths };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watchlist") config.watchlist = argv[++index];
    else if (arg === "--allowlist") config.allowlist = argv[++index];
    else if (arg === "--recheck") config.recheck = argv[++index];
    else if (arg === "--json-out") config.json = argv[++index];
    else if (arg === "--md-out") config.markdown = argv[++index];
    else if (arg === "--no-write") config.noWrite = true;
    else if (!arg.startsWith("--")) config.providers = arg;
  }
  return config;
}

export function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const providers = readRequiredJson(config.providers);
  const watchlist = readJsonIfExists(config.watchlist, { items: [] });
  const watchlistItems = Array.isArray(watchlist) ? watchlist : watchlist.items || [];
  const allowlistEntries = readJsonIfExists(config.allowlist, []);
  const recheckReport = readJsonIfExists(config.recheck, { results: [] });
  const recheckResults = Array.isArray(recheckReport) ? recheckReport : recheckReport.results || [];

  const report = auditAvailability({ providers, watchlistItems, allowlistEntries, recheckResults });

  if (!config.noWrite) {
    ensureParent(config.json);
    fs.writeFileSync(config.json, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(config.markdown, markdownReport(report));
  }

  console.log(`Provider availability audit: ${report.summary.total} findings; ${report.summary.highUnallowlisted} unallowlisted high severity.`);
  if (!config.noWrite) {
    console.log(`Wrote ${path.resolve(config.json)} and ${path.resolve(config.markdown)}.`);
  }
  process.exitCode = report.summary.highUnallowlisted ? 1 : 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
