import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchSources } from "./lib/source-fetcher.mjs";
import {
  capturedPageEvidenceText,
  containsPromptInjectionAttempt,
  pageIdentityMatchesProvider
} from "./lib/provider-validation-evidence.mjs";
import { exactExcerptMatches } from "./lib/provider-validation-policy.mjs";
import { normaliseComparable, sourceDomain, sourceTypeFromUrl } from "./lib/provider-evidence-scorer.mjs";

const SAFE_ACTIONS = new Set(["adjust", "move_to_watchlist", "needs_more_info"]);
const ARRAY_FIELDS = new Set(["tags", "needScope", "specialties", "advertisedSpecialties", "services", "patientGroups", "ageGroups"]);
const CONTACT_FIELDS = new Set(["phone", "text", "email", "website", "bookingUrl"]);
const IDENTITY_LOCATION_FIELDS = new Set(["name", "clinicianName", "practiceName", "region", "city", "address"]);
const NEVER_AUTONOMOUS_FIELDS = new Set([
  "lat",
  "lon",
  "coordinateSource",
  "coordinatePrecision",
  "coordinateConfidence",
  "geocodeNeedsManualReview",
  "verified",
  "lastVerified",
  "needsManualVerification",
  "type",
  "baselineScope",
  "baselineScopeSource",
  "baselineScopeNote"
]);
const RESTRICTIVE_AVAILABILITY = new Set(["waitlist", "not_accepting", "referrals_paused"]);

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

function decisionsList(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value.decisions) ? value.decisions : [];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseSourceEvidence(decision) {
  const evidence = asArray(decision.sourceEvidence).filter((item) => item && typeof item === "object");
  if (evidence.length) return evidence;
  if (!decision.sourceUrl || !decision.sourceExcerpt) return [];
  return [{
    field: "identity",
    value: decision.providerName || decision.providerId || "",
    sourceUrl: decision.sourceUrl,
    excerpt: decision.sourceExcerpt
  }];
}

function providerIdentityMatches(provider, sourceUrl, text) {
  if (pageIdentityMatchesProvider(provider, text)) return true;
  const comparableText = normaliseComparable(text);
  const names = unique([provider.name, provider.clinicianName, provider.practiceName])
    .map(normaliseComparable)
    .filter((name) => name.length >= 5);
  const nameMatch = names.some((name) => comparableText.includes(name));
  const sourceHost = sourceDomain(sourceUrl);
  const knownHosts = unique([provider.website, provider.source, provider.bookingUrl].map(sourceDomain));
  const knownDomainMatch = Boolean(sourceHost && knownHosts.includes(sourceHost));
  const distinctiveBrandMatch = names
    .flatMap((name) => name.split(" "))
    .filter((part) => part.length >= 5)
    .some((part) => sourceHost.includes(part) && comparableText.includes(part));
  return Boolean(knownDomainMatch && (nameMatch || (!provider.clinicianName && distinctiveBrandMatch)));
}

function valueAppearsInEvidence(value, evidence, field = "") {
  if (["phone", "text"].includes(field)) {
    const expectedDigits = String(value || "").replace(/\D/g, "");
    return expectedDigits.length >= 7 && evidence.some((item) => String(item.excerpt || "").replace(/\D/g, "").includes(expectedDigits));
  }
  if (field === "email") {
    const expectedEmail = String(value || "").trim().toLowerCase();
    return expectedEmail.includes("@") && evidence.some((item) => String(item.excerpt || "").toLowerCase().includes(expectedEmail));
  }
  const expected = normaliseComparable(value);
  if (!expected) return false;
  return evidence.some((item) => {
    const text = normaliseComparable(item.excerpt || "");
    return text.includes(expected) || expected.includes(text);
  });
}

function fieldEvidence(evidence, field) {
  return evidence.filter((item) => item.field === field || item.field === `correctedFields.${field}`);
}

function addedValues(before, after) {
  const beforeSet = new Set(asArray(before));
  return asArray(after).filter((value) => !beforeSet.has(value));
}

function positiveClaimErrors(provider, decision) {
  const corrected = decision.correctedFields || {};
  const errors = [];
  if (decision.newProviderCandidate) errors.push("new providers are not allowed in the no-key Codex lane");
  if (!SAFE_ACTIONS.has(decision.action || decision.reviewDecision)) errors.push("action is outside the safe no-key Codex lane");
  if (corrected.availabilityStatus === "accepting") errors.push("accepting availability cannot be added in the no-key Codex lane");
  if (corrected.referralType === "self" || corrected.requiresReferral === false) errors.push("psychiatry self-referral or removal of referral guidance cannot be added in the no-key Codex lane");
  if (corrected.onlineAvailable === true && provider.onlineAvailable !== true) errors.push("telehealth cannot be added in the no-key Codex lane");
  if (corrected.phoneSupport === true && provider.phoneSupport !== true) errors.push("phone support cannot be added in the no-key Codex lane");
  if (corrected.inPerson === true && provider.inPerson !== true) errors.push("in-person capability cannot be added in the no-key Codex lane");
  for (const field of ARRAY_FIELDS) {
    const additions = addedValues(provider[field], corrected[field]);
    if (additions.length) errors.push(`${field} adds positive values: ${additions.join(", ")}`);
  }
  for (const field of NEVER_AUTONOMOUS_FIELDS) {
    if (Object.hasOwn(corrected, field)) errors.push(`${field} is not allowed in the no-key Codex lane`);
  }
  if (Object.hasOwn(corrected, "providerGender") && corrected.providerGender) errors.push("clinician gender cannot be added in the no-key Codex lane");
  if (corrected.availabilityNeedsManualReview === false && !RESTRICTIVE_AVAILABILITY.has(corrected.availabilityStatus)) {
    errors.push("availability review cannot be cleared without a restrictive status in the no-key Codex lane");
  }
  return errors;
}

function fieldSupportErrors(provider, decision, evidence) {
  const corrected = decision.correctedFields || {};
  const errors = [];
  for (const [field, value] of Object.entries(corrected)) {
    if (ARRAY_FIELDS.has(field)) continue;
    if (["onlineAvailable", "phoneSupport", "inPerson", "availabilityNeedsManualReview", "referralNeedsManualReview", "requiresReferral"].includes(field)) continue;
    if (["source", "sourceQuality", "confidence", "availabilityCheckedAt", "referralLastChecked"].includes(field)) continue;
    const matching = fieldEvidence(evidence, field);
    if (!matching.length) {
      errors.push(`${field} has no field-matched source evidence`);
      continue;
    }
    if ((CONTACT_FIELDS.has(field) || IDENTITY_LOCATION_FIELDS.has(field) || ["cost", "hours", "appointmentWait", "eligibility"].includes(field))
      && !valueAppearsInEvidence(value, matching, field)) {
      errors.push(`${field} value is not present in its exact source excerpt`);
    }
  }

  if (decision.action === "move_to_watchlist" || RESTRICTIVE_AVAILABILITY.has(corrected.availabilityStatus)) {
    const availabilityEvidence = fieldEvidence(evidence, "availabilityStatus");
    const text = availabilityEvidence.map((item) => item.excerpt).join(" ");
    if (!/\bnot\s+(?:currently\s+)?(?:taking|accepting)|no\s+longer\s+(?:seeing|taking|accepting)\s+new\s+(?:clients|patients|referrals)|books?\s+(?:are\s+)?(?:currently\s+)?(?:closed|filled)|closed\s+(?:his|her|their|the)\s+books?|referrals?\s+(?:are\s+)?(?:paused|closed)|no\s+new\s+(?:psychiatry\s+)?referrals?\s+(?:are\s+)?(?:being\s+)?(?:taken|accepted)|no\s+(?:current\s+)?availability|fully\s+booked|wait\s*list|waiting\s+list|(?:approximate\s+)?wait\s*time\s+for\s+(?:a\s+)?first\s+appointment\s*:\s*(?:less\s+than\s+)?\d+(?:\s*-\s*\d+)?\s*(?:days?|weeks?|months?)|(?:assessment|appointment|psychiatrist)?\s*wait[- ]time\s+(?:is|of)\s+(?:\d+|a\s+few|few|several|a\s+couple\s+of)\s*(?:days?|weeks?|months?)\b/i.test(text)) {
      errors.push("restrictive availability needs an explicit field-matched excerpt");
    }
  }
  if (["gp", "specialist"].includes(corrected.referralType)) {
    const referralEvidence = fieldEvidence(evidence, "referralType");
    if (!/\b(?:gp|general practitioner|doctor|specialist|clinician)\s+referr|referrals?\s+(?:from|required|by)\b/i.test(referralEvidence.map((item) => item.excerpt).join(" "))) {
      errors.push("referral guidance needs an explicit field-matched excerpt");
    }
  }
  return errors;
}

function passMetadataErrors(decision) {
  const researchPassId = decision.codexReview?.researchPassId || "";
  const verificationPassId = decision.codexReview?.verificationPassId || "";
  const errors = [];
  if (!researchPassId || !verificationPassId) errors.push("research and verification pass IDs are required");
  if (researchPassId && researchPassId === verificationPassId) errors.push("research and verification pass IDs must be distinct");
  if (decision.codexReview?.verificationConclusion !== "accept" && (decision.action || decision.reviewDecision) !== "needs_more_info") {
    errors.push("verification pass did not explicitly accept the evidence");
  }
  return errors;
}

async function fetchEvidencePages(sourceUrls, fetcher, options) {
  const results = await fetcher(sourceUrls, {
    rateLimitMs: options.rateLimitMs ?? 1200,
    maxBytes: options.maxBytes || 1_500_000,
    timeoutMs: options.timeoutMs || 25_000
  });
  const byUrl = new Map();
  for (const result of results) {
    byUrl.set(result.url, result);
    if (result.finalUrl) byUrl.set(result.finalUrl, result);
  }
  return byUrl;
}

export async function verifyCodexReviewEvidence({ decisions, providers, fetcher = fetchSources, now = new Date(), ...options } = {}) {
  const providerById = new Map(asArray(providers).map((provider) => [provider.id, provider]));
  const output = [];
  const errors = [];

  for (const rawDecision of decisionsList(decisions)) {
    const decision = structuredClone(rawDecision);
    decision.generatedBy = "codex-autonomous-reviewer";
    decision.aiReview = true;
    decision.requiresHumanApproval = false;
    const provider = providerById.get(decision.providerId);
    const action = decision.action || decision.reviewDecision;
    const decisionErrors = [];
    if (!provider) decisionErrors.push("provider was not found in providers.json");
    if (provider) decisionErrors.push(...positiveClaimErrors(provider, decision));
    decisionErrors.push(...passMetadataErrors(decision));

    const sourceEvidence = normaliseSourceEvidence(decision);
    const sourceUrls = unique(sourceEvidence.map((item) => item.sourceUrl));
    let fetched = new Map();
    if (sourceUrls.length) fetched = await fetchEvidencePages(sourceUrls, fetcher, options);
    const verifiedEvidence = sourceEvidence.map((item) => {
      const result = fetched.get(item.sourceUrl);
      const evidenceText = result?.ok ? capturedPageEvidenceText(result.text) : "";
      const itemErrors = [];
      if (!result?.ok) itemErrors.push(`source fetch failed: ${result?.error || result?.status || "unknown error"}`);
      if (result?.ok && containsPromptInjectionAttempt(evidenceText)) itemErrors.push("source contains prompt-injection-like instructions");
      if (result?.ok && !exactExcerptMatches(item, evidenceText)) itemErrors.push("excerpt is not an exact captured-page substring");
      if (result?.ok && provider && !providerIdentityMatches(provider, result.finalUrl || item.sourceUrl, evidenceText)) itemErrors.push("source identity does not match the provider or known practice");
      return {
        ...item,
        sourceType: item.sourceType || sourceTypeFromUrl(result?.finalUrl || item.sourceUrl),
        finalUrl: result?.finalUrl || item.sourceUrl,
        capturedAt: result?.capturedAt || now.toISOString(),
        pageHash: result?.sourceHash || "",
        verified: itemErrors.length === 0,
        verificationErrors: itemErrors
      };
    });
    if (action !== "needs_more_info" && !verifiedEvidence.length) decisionErrors.push("an applied decision requires exact source evidence");
    for (const item of verifiedEvidence) {
      if (!item.verified) decisionErrors.push(...item.verificationErrors.map((error) => `${item.sourceUrl}: ${error}`));
    }
    if (provider && action !== "needs_more_info") decisionErrors.push(...fieldSupportErrors(provider, decision, verifiedEvidence));

    decision.sourceEvidence = verifiedEvidence;
    decision.codexEvidenceVerified = decisionErrors.length === 0;
    decision.codexEvidenceVerifiedAt = now.toISOString();
    decision.codexEvidencePolicy = "codex-safe-remediation-v1";
    if (!decision.sourceUrl && verifiedEvidence[0]) decision.sourceUrl = verifiedEvidence[0].finalUrl || verifiedEvidence[0].sourceUrl;
    if (!decision.sourceExcerpt && verifiedEvidence[0]) decision.sourceExcerpt = verifiedEvidence[0].excerpt;
    if (decisionErrors.length) {
      decision.processingStatus = "failed";
      decision.codexEvidenceErrors = unique(decisionErrors);
      errors.push({ providerId: decision.providerId || "", errors: decision.codexEvidenceErrors });
    } else {
      decision.processingStatus = "verified";
      decision.codexEvidenceErrors = [];
    }
    output.push(decision);
  }
  return {
    version: 1,
    generatedAt: now.toISOString(),
    policy: "codex-safe-remediation-v1",
    decisions: output,
    errors
  };
}

function report(result) {
  const verified = result.decisions.filter((decision) => decision.codexEvidenceVerified).length;
  const lines = [
    "# Codex Evidence Verification",
    "",
    `Generated: ${result.generatedAt}`,
    `Verified decisions: ${verified}/${result.decisions.length}`,
    `Errors: ${result.errors.length}`,
    ""
  ];
  for (const decision of result.decisions) {
    lines.push(`## ${decision.providerId || "unknown provider"}`);
    lines.push("");
    lines.push(`- Action: ${decision.action || decision.reviewDecision}`);
    lines.push(`- Evidence gate: ${decision.codexEvidenceVerified ? "passed" : "blocked"}`);
    for (const error of decision.codexEvidenceErrors || []) lines.push(`- Blocked: ${error}`);
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const config = {
    decisions: "data/provider-validation/codex-review-decisions.json",
    providers: "providers.json",
    out: "data/provider-validation/codex-verified-decisions.json",
    report: "CODEX_PROVIDER_EVIDENCE_REPORT.md",
    rateLimitMs: 1200
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--decisions") config.decisions = argv[++index];
    else if (arg === "--providers") config.providers = argv[++index];
    else if (arg === "--out") config.out = argv[++index];
    else if (arg === "--report") config.report = argv[++index];
    else if (arg === "--rate-limit-ms") config.rateLimitMs = Number(argv[++index]);
  }
  return config;
}

export async function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const decisions = readJson(config.decisions, { decisions: [] });
  const providers = readJson(config.providers, []);
  const result = await verifyCodexReviewEvidence({ decisions, providers, rateLimitMs: config.rateLimitMs });
  writeJson(config.out, result);
  writeText(config.report, report(result));
  console.log(`Verified ${result.decisions.filter((decision) => decision.codexEvidenceVerified).length}/${result.decisions.length} Codex decision(s).`);
  console.log(`Output: ${config.out}`);
  if (result.errors.length) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();
