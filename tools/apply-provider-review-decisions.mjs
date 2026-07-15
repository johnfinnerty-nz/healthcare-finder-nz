import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  baselinePsychiatristScope,
  baselinePsychiatristScopeNote,
  baselinePsychiatristScopeSource
} from "./lib/provider-scope.mjs";

export const ALLOWED_CORRECTED_FIELDS = new Set([
  "name",
  "clinicianName",
  "practiceName",
  "type",
  "region",
  "city",
  "address",
  "lat",
  "lon",
  "coordinateSource",
  "coordinatePrecision",
  "coordinateConfidence",
  "geocodeNeedsManualReview",
  "phone",
  "text",
  "email",
  "website",
  "bookingUrl",
  "source",
  "sourceQuality",
  "confidence",
  "needsManualVerification",
  "verified",
  "lastVerified",
  "availabilityStatus",
  "availabilityCheckedAt",
  "availabilityEvidence",
  "availabilitySource",
  "availabilityNeedsManualReview",
  "requiresReferral",
  "referralType",
  "referralSourceUrl",
  "referralSourceExcerpt",
  "referralConfidence",
  "referralLastChecked",
  "referralNeedsManualReview",
  "tags",
  "needScope",
  "baselineScope",
  "baselineScopeSource",
  "baselineScopeNote",
  "advertisedSpecialties",
  "advertisedSpecialtyEvidence",
  "specialtyTagsSource",
  "specialties",
  "services",
  "patientGroups",
  "ageGroups",
  "onlineAvailable",
  "phoneSupport",
  "inPerson",
  "crisisOnly",
  "firstStep",
  "fit",
  "cost",
  "hours"
]);

const VALID_DECISIONS = new Set(["approve", "adjust", "reject", "move_to_watchlist", "duplicate", "needs_more_info"]);
const SUPPORT_TAGS = new Set(["maori", "pasifika", "asian", "rainbow"]);
const TELEHEALTH_TAGS = new Set(["telehealth", "online"]);
const BROAD_TAGS = new Set(["depression", "anxiety", "trauma", "addiction", "work", "stress", "relationships", "grief"]);
const AVAILABILITY_STATUSES = new Set(["accepting", "waitlist", "not_accepting", "referrals_paused", "unknown", "not_published"]);
const PROVIDER_TYPES = new Set(["gp", "counsellor", "psychologist", "psychiatrist", "helpline", "mens-centre", "youth", "addiction", "directory", "public-service"]);
const PROVIDER_REGIONS = new Set([
  "Northland",
  "Auckland",
  "Waikato",
  "Bay of Plenty",
  "Rotorua and Taupo",
  "Tairawhiti",
  "Hawke's Bay",
  "Taranaki",
  "Manawatu-Whanganui",
  "Wairarapa",
  "Wellington",
  "Nelson Marlborough Tasman",
  "Canterbury",
  "South Canterbury",
  "West Coast",
  "Otago",
  "Southland",
  "National"
]);
const PROVIDER_CONFIDENCE = new Set(["high", "medium", "low"]);
const CODEX_SAFE_ACTIONS = new Set(["adjust", "move_to_watchlist", "needs_more_info"]);
const CODEX_ARRAY_FIELDS = new Set(["tags", "needScope", "specialties", "advertisedSpecialties", "services", "patientGroups", "ageGroups"]);
const CODEX_CONTACT_FIELDS = new Set(["phone", "text", "email", "website", "bookingUrl"]);

function parseArgs(argv = process.argv.slice(2)) {
  const config = {
    decisions: "data/provider-review-decisions.json",
    providers: "providers.json",
    watchlist: "data/monitors/provider-availability-watchlist.json",
    log: "data/provider-review-log.jsonl",
    allowUnsafeFields: false,
    allowAiReviewDecisions: false,
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--decisions") config.decisions = argv[++index];
    else if (arg === "--providers") config.providers = argv[++index];
    else if (arg === "--watchlist") config.watchlist = argv[++index];
    else if (arg === "--log") config.log = argv[++index];
    else if (arg === "--allow-unsafe-fields") config.allowUnsafeFields = true;
    else if (arg === "--allow-ai-review-decisions") config.allowAiReviewDecisions = true;
    else if (arg === "--dry-run") config.dryRun = true;
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

function appendJsonl(filePath, events) {
  if (!events.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

function monthFromDate(value) {
  if (/^\d{4}-\d{2}/.test(value || "")) return String(value).slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function decisionList(input) {
  if (Array.isArray(input)) return input;
  return Array.isArray(input.decisions) ? input.decisions : [];
}

function providerLabel(provider) {
  return provider?.name || provider?.id || "(unknown provider)";
}

function explicitApprovals(decision) {
  return new Set(Array.isArray(decision.explicitApprovals) ? decision.explicitApprovals : []);
}

function isCodexAutomationDecision(decision) {
  return decision.generatedBy === "codex-autonomous-reviewer";
}

function codexVerifiedEvidence(decision) {
  return asArray(decision.sourceEvidence).filter((item) => item?.verified === true && item.pageHash && item.sourceUrl && item.excerpt);
}

function codexAddedValues(before, after) {
  const beforeSet = new Set(asArray(before));
  return asArray(after).filter((value) => !beforeSet.has(value));
}

export function validateCodexAutomationDecision(provider, decision, action = decision.action || decision.reviewDecision) {
  if (!CODEX_SAFE_ACTIONS.has(action)) throw new Error(`Codex autonomous action "${action}" is outside the safe local lane.`);
  if (decision.newProviderCandidate || !provider) throw new Error("Codex autonomous review cannot add a new provider.");
  if (decision.codexEvidenceVerified !== true || decision.codexEvidencePolicy !== "codex-safe-remediation-v1") {
    throw new Error("Codex autonomous review requires the deterministic evidence gate.");
  }
  const researchPassId = decision.codexReview?.researchPassId || "";
  const verificationPassId = decision.codexReview?.verificationPassId || "";
  if (!researchPassId || !verificationPassId || researchPassId === verificationPassId) {
    throw new Error("Codex autonomous review requires distinct research and verification pass IDs.");
  }
  if (action !== "needs_more_info" && decision.codexReview?.verificationConclusion !== "accept") {
    throw new Error("Codex autonomous verification did not accept this decision.");
  }
  const evidence = codexVerifiedEvidence(decision);
  if (action !== "needs_more_info" && !evidence.length) throw new Error("Codex autonomous changes require exact verified source evidence.");
  if (asArray(decision.sourceEvidence).some((item) => item?.verified !== true)) {
    throw new Error("Codex autonomous decision contains unverified source evidence.");
  }

  const corrected = decision.correctedFields || {};
  if (decision.correctedFields?.availabilityStatus === "accepting") throw new Error("Codex autonomous review cannot publish accepting availability.");
  if (corrected.referralType === "self" || corrected.requiresReferral === false) throw new Error("Codex autonomous review cannot publish psychiatry self-referral or remove referral guidance.");
  if (corrected.onlineAvailable === true && provider.onlineAvailable !== true) throw new Error("Codex autonomous review cannot add telehealth capability.");
  if (corrected.phoneSupport === true && provider.phoneSupport !== true) throw new Error("Codex autonomous review cannot add phone support.");
  if (corrected.inPerson === true && provider.inPerson !== true) throw new Error("Codex autonomous review cannot add in-person capability.");
  if (corrected.providerGender) throw new Error("Codex autonomous review cannot add clinician gender.");
  for (const field of CODEX_ARRAY_FIELDS) {
    const additions = codexAddedValues(provider[field], corrected[field]);
    if (additions.length) throw new Error(`Codex autonomous review cannot add ${field}: ${additions.join(", ")}.`);
  }
  for (const field of ["type", "lat", "lon", "verified", "lastVerified", "needsManualVerification", "baselineScope", "baselineScopeSource", "baselineScopeNote"]) {
    if (Object.hasOwn(corrected, field)) throw new Error(`Codex autonomous review cannot change ${field}.`);
  }
  for (const field of CODEX_CONTACT_FIELDS) {
    if (!Object.hasOwn(corrected, field)) continue;
    if (!evidence.some((item) => item.field === field || item.field === `correctedFields.${field}`)) {
      throw new Error(`Codex autonomous ${field} correction lacks field-matched verified evidence.`);
    }
  }
  if (action === "move_to_watchlist" && !evidence.some((item) => item.field === "availabilityStatus")) {
    throw new Error("Codex autonomous watchlist moves require field-matched restrictive availability evidence.");
  }
}

function decisionEvidenceText(decision, provider, nextProvider = provider) {
  return [
    decision.sourceExcerpt,
    decision.reviewNotes,
    decision.notes,
    decision.sourceEvidenceSummary,
    decision.correctedFields?.availabilityEvidence,
    decision.correctedFields?.referralSourceExcerpt,
    nextProvider?.availabilityEvidence,
    nextProvider?.referralSourceExcerpt,
    provider?.availabilityEvidence,
    provider?.referralSourceExcerpt
  ].filter(Boolean).join(" ");
}

function hasAnyEvidence(decision, provider, nextProvider = provider) {
  return /\S{12,}/.test(decisionEvidenceText(decision, provider, nextProvider));
}

function hasExplicitAvailabilityEvidence(provider, decision) {
  return /\b(accepting new|taking new|currently available|available for new|no waitlists?|book (?:your |a )?(?:session|appointment|consultation)|new client enqu)/i
    .test(`${provider.availabilityEvidence || ""} ${decision.sourceExcerpt || ""} ${decision.correctedFields?.availabilityEvidence || ""}`);
}

function hasExplicitSelfReferralEvidence(provider, decision) {
  return /\b(self[- ]referr|self referrals?|refer yourself|direct referrals?|without (?:a )?referral|no referral required|contact (?:us|the practice) directly|book directly)\b/i
    .test(`${provider.referralSourceExcerpt || ""} ${decision.sourceExcerpt || ""} ${decision.correctedFields?.referralSourceExcerpt || ""}`);
}

function sourceHost(value) {
  try {
    return new URL(value || "").hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRegisterOrDirectorySource(provider) {
  return /register|directory|professional/i.test(`${provider.sourceQuality || ""} ${provider.source || ""} ${provider.website || ""}`);
}

function isSameSourceWebsite(provider) {
  return sourceHost(provider.source) && sourceHost(provider.source) === sourceHost(provider.website);
}

function hasDirectPracticeContact(provider) {
  return Boolean(provider.phone || provider.email || provider.bookingUrl)
    || (provider.website && !isRegisterOrDirectorySource(provider));
}

function ensureAllowedFields(correctedFields, allowUnsafeFields) {
  if (allowUnsafeFields) return;
  const unsafe = Object.keys(correctedFields || {}).filter((field) => !ALLOWED_CORRECTED_FIELDS.has(field));
  if (unsafe.length) throw new Error(`Unsafe correctedFields rejected: ${unsafe.join(", ")}`);
}

function changedArrayValues(before = [], after = []) {
  const beforeSet = new Set(Array.isArray(before) ? before : []);
  return (Array.isArray(after) ? after : []).filter((value) => !beforeSet.has(value));
}

function specialtySupportedByText(specialty, text) {
  const value = String(specialty || "").replace(/\s+/g, " ").trim().toLowerCase();
  const source = String(text || "").toLowerCase();
  if (!value) return true;
  if (source.includes(value)) return true;
  const words = value
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 4 && !["disorder", "disorders", "support", "therapy", "assessment"].includes(word));
  return words.length > 0 && words.some((word) => source.includes(word));
}

function validateSafety(provider, nextProvider, decision) {
  const approvals = explicitApprovals(decision);
  const action = decision.action || decision.reviewDecision;
  const evidenceText = decisionEvidenceText(decision, provider, nextProvider);

  if (action === "approve" && provider.needsManualVerification && !hasAnyEvidence(decision, provider, nextProvider)) {
    throw new Error(`${providerLabel(provider)} cannot be approved without source evidence or review notes.`);
  }

  if (nextProvider.availabilityStatus && !AVAILABILITY_STATUSES.has(nextProvider.availabilityStatus)) {
    throw new Error(`${providerLabel(provider)} has invalid availabilityStatus "${nextProvider.availabilityStatus}".`);
  }

  if (nextProvider.availabilityStatus === "accepting" && !hasExplicitAvailabilityEvidence(nextProvider, decision)) {
    throw new Error(`${providerLabel(provider)} cannot be marked accepting without explicit accepting-new-clients evidence.`);
  }

  if (/blocked|unreachable|403|404|timeout|could not read/i.test(`${decision.sourceStatus || ""} ${decision.sourceExcerpt || ""}`) && nextProvider.availabilityStatus === "accepting") {
    throw new Error(`${providerLabel(provider)} cannot use blocked or unreachable pages as availability evidence.`);
  }

  const isPsychiatry = nextProvider.type === "psychiatrist" || nextProvider.tags?.includes("psychiatry-service");
  if (isPsychiatry && nextProvider.referralType === "self" && !hasExplicitSelfReferralEvidence(nextProvider, decision)) {
    throw new Error(`${providerLabel(provider)} cannot be marked self-referral without explicit self-referral evidence.`);
  }

  if (isPsychiatry && provider.id?.startsWith("ranzcp-")
    && (provider.referralType === "gp" || provider.requiresReferral === true)
    && (nextProvider.referralType === "self" || nextProvider.requiresReferral === false)
    && (!hasExplicitSelfReferralEvidence(nextProvider, decision) || !approvals.has("ranzcp-referral-change"))) {
    throw new Error(`${providerLabel(provider)} is a RANZCP GP-referral record; changing to self-referral requires explicit source evidence and ranzcp-referral-change approval.`);
  }

  const addedTags = changedArrayValues(provider.tags, nextProvider.tags);
  const addedSupport = addedTags.filter((tag) => SUPPORT_TAGS.has(tag));
  if (addedSupport.length && !approvals.has("support-preference-tags") && !addedSupport.every((tag) => approvals.has(`tag:${tag}`)) && !evidenceText) {
    throw new Error(`${providerLabel(provider)} cannot add support-preference tags without evidence or explicit reviewer approval.`);
  }

  const addedTelehealth = addedTags.filter((tag) => TELEHEALTH_TAGS.has(tag));
  const telehealthTurnedOn = (provider.onlineAvailable !== true && nextProvider.onlineAvailable === true)
    || (provider.phoneSupport !== true && nextProvider.phoneSupport === true);
  if ((addedTelehealth.length || telehealthTurnedOn) && !approvals.has("telehealth") && !/\b(telehealth|online|video|zoom|phone appointment|remote|virtual)\b/i.test(evidenceText)) {
    throw new Error(`${providerLabel(provider)} cannot add telehealth/online claims without evidence or explicit telehealth approval.`);
  }

  const addedBroadTags = addedTags.filter((tag) => BROAD_TAGS.has(tag));
  if (addedBroadTags.length && !approvals.has("broad-tags") && !addedBroadTags.every((tag) => approvals.has(`tag:${tag}`)) && !evidenceText) {
    throw new Error(`${providerLabel(provider)} cannot add broad need tags without source evidence or explicit reviewer approval.`);
  }

  const addedAdvertisedSpecialties = changedArrayValues(provider.advertisedSpecialties, nextProvider.advertisedSpecialties);
  const unsupportedAdvertisedSpecialties = addedAdvertisedSpecialties.filter((specialty) => !specialtySupportedByText(specialty, evidenceText));
  if (unsupportedAdvertisedSpecialties.length && !approvals.has("advertised-specialties")) {
    throw new Error(`${providerLabel(provider)} cannot add advertised specialties without source evidence that names the specialty or explicit advertised-specialties approval.`);
  }

  if ((provider.type === "directory" || provider.tags?.includes("directory")) && nextProvider.type !== "directory" && !hasDirectPracticeContact(nextProvider)) {
    throw new Error(`${providerLabel(provider)} cannot be changed from directory to direct provider without direct provider contact/source.`);
  }

  if (["psychologist", "psychiatrist"].includes(nextProvider.type)
    && isRegisterOrDirectorySource(nextProvider)
    && isSameSourceWebsite(nextProvider)
    && !hasDirectPracticeContact(nextProvider)) {
    throw new Error(`${providerLabel(provider)} is register/directory-only and cannot become a public contact provider without separate practice contact evidence.`);
  }
}

function oldFieldsFor(provider, correctedFields) {
  return Object.fromEntries(Object.keys(correctedFields || {}).map((field) => [field, provider[field]]));
}

function applyCorrectedFields(provider, correctedFields) {
  return { ...provider, ...clone(correctedFields || {}) };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function hasUsablePublicContact(provider) {
  return Boolean(provider.phone || provider.text || provider.email || provider.website || provider.bookingUrl);
}

function normaliseImportedProviderId(providerId) {
  const id = String(providerId || "").trim();
  if (!id) throw new Error("New provider import requires providerId.");
  if (!/^[a-z0-9][a-z0-9-]{2,}$/.test(id)) throw new Error(`New provider id "${id}" must be a stable lowercase slug.`);
  return id;
}

function reviewedSourceExcerpt(decision) {
  return String(decision.sourceExcerpt || "").trim();
}

function strongNewProviderEvidence(decision) {
  const text = reviewedSourceExcerpt(decision);
  if (text.replace(/\s+/g, "").length < 20) return false;
  if (/seed value from google places|google places candidate export|search result snippet|linkedin signal|blocked|unreachable|captcha|403|404|timeout/i.test(text)) return false;
  return true;
}

function defaultImportedProviderFields(decision, correctedFields) {
  const reviewedMonth = monthFromDate(decision.reviewedDate);
  const sourceUrl = decision.sourceUrl || correctedFields.source || correctedFields.website || correctedFields.bookingUrl || "";
  const type = correctedFields.type || "";
  const tags = asArray(correctedFields.tags);
  return {
    id: normaliseImportedProviderId(decision.providerId),
    name: "",
    clinicianName: "",
    practiceName: "",
    type,
    region: "",
    city: "",
    address: "",
    lat: "",
    lon: "",
    phone: "",
    text: "",
    email: "",
    website: "",
    bookingUrl: "",
    hours: "Ask the provider about current hours.",
    cost: "Ask the provider about current fees, funding options, and eligibility.",
    tags: type && !tags.includes(type) ? [type, ...tags] : tags,
    needScope: [],
    specialties: [],
    services: [],
    patientGroups: [],
    ageGroups: [],
    fit: "",
    firstStep: "Contact the provider and ask about availability, referral requirements, fees, and whether this is the right service.",
    source: sourceUrl,
    verified: reviewedMonth,
    lastVerified: reviewedMonth,
    confidence: "medium",
    sourceQuality: "reviewed public source",
    needsManualVerification: false,
    availabilityStatus: "not_published",
    availabilityCheckedAt: decision.reviewedDate || reviewedMonth,
    availabilityEvidence: "",
    availabilitySource: sourceUrl,
    availabilityNeedsManualReview: true,
    onlineAvailable: false,
    phoneSupport: false,
    inPerson: true,
    crisisOnly: false
  };
}

function withPsychiatryDefaults(provider, decision) {
  if (provider.type !== "psychiatrist") return provider;
  const reviewedMonth = monthFromDate(decision.reviewedDate);
  return {
    ...provider,
    requiresReferral: typeof provider.requiresReferral === "boolean" ? provider.requiresReferral : false,
    referralType: provider.referralType || "unknown",
    referralSourceUrl: provider.referralSourceUrl || decision.sourceUrl || provider.source || provider.website || "",
    referralSourceExcerpt: provider.referralSourceExcerpt || "Referral requirements are not clearly published in the reviewed source.",
    referralConfidence: provider.referralConfidence || "low",
    referralLastChecked: provider.referralLastChecked || reviewedMonth,
    referralNeedsManualReview: typeof provider.referralNeedsManualReview === "boolean" ? provider.referralNeedsManualReview : true,
    baselineScope: asArray(provider.baselineScope).length ? provider.baselineScope : [...baselinePsychiatristScope],
    baselineScopeSource: provider.baselineScopeSource || baselinePsychiatristScopeSource,
    baselineScopeNote: provider.baselineScopeNote || baselinePsychiatristScopeNote,
    advertisedSpecialties: asArray(provider.advertisedSpecialties),
    advertisedSpecialtyEvidence: asArray(provider.advertisedSpecialtyEvidence),
    specialtyTagsSource: provider.specialtyTagsSource || "no advertised specialties captured yet"
  };
}

function makeNewProviderFromDecision(decision, correctedFields) {
  const provider = withPsychiatryDefaults({
    ...defaultImportedProviderFields(decision, correctedFields),
    ...clone(correctedFields || {}),
    id: normaliseImportedProviderId(decision.providerId)
  }, decision);
  if (!provider.availabilitySource) provider.availabilitySource = provider.source || provider.website || decision.sourceUrl || "";
  if (!provider.source && decision.sourceUrl) provider.source = decision.sourceUrl;
  if (!provider.website && provider.source && !/healthpoint|register|directory/i.test(provider.sourceQuality || "")) provider.website = provider.source;
  if (provider.inPerson === true && !provider.address && (provider.onlineAvailable || provider.phoneSupport)) provider.inPerson = false;
  provider.tags = asArray(provider.tags);
  if (provider.type && !provider.tags.includes(provider.type)) provider.tags = [provider.type, ...provider.tags];
  return provider;
}

function validateNewProviderImport(provider, decision, existingProviders) {
  if (decision.newProviderCandidate !== true && !explicitApprovals(decision).has("new-provider-import")) {
    throw new Error("New provider import requires newProviderCandidate true or explicit new-provider-import approval.");
  }
  if ((decision.action || decision.reviewDecision) !== "approve") {
    throw new Error("New provider import requires an approve decision after source review.");
  }
  if (existingProviders.some((existing) => existing.id === provider.id)) throw new Error(`Provider id "${provider.id}" already exists.`);
  if (!PROVIDER_TYPES.has(provider.type)) throw new Error(`${providerLabel(provider)} has invalid type "${provider.type}".`);
  if (!PROVIDER_REGIONS.has(provider.region)) throw new Error(`${providerLabel(provider)} has invalid region "${provider.region}".`);
  if (!PROVIDER_CONFIDENCE.has(provider.confidence)) throw new Error(`${providerLabel(provider)} has invalid confidence "${provider.confidence}".`);
  for (const field of ["name", "city", "fit", "firstStep", "cost", "source", "sourceQuality", "verified", "lastVerified", "availabilityCheckedAt", "availabilitySource"]) {
    if (!provider[field] || !String(provider[field]).trim()) throw new Error(`${providerLabel(provider)} missing required field "${field}".`);
  }
  if (!Array.isArray(provider.tags)) throw new Error(`${providerLabel(provider)} tags must be an array.`);
  if (!Array.isArray(provider.needScope)) throw new Error(`${providerLabel(provider)} needScope must be an array.`);
  if (!hasUsablePublicContact(provider)) throw new Error(`${providerLabel(provider)} needs at least one public contact route before import.`);
  for (const field of ["source", "website", "bookingUrl", "availabilitySource", "referralSourceUrl"]) {
    if (provider[field] && !isUrl(provider[field])) throw new Error(`${providerLabel(provider)} has invalid ${field}.`);
  }
  if (!strongNewProviderEvidence(decision)) {
    throw new Error(`${providerLabel(provider)} needs a human-captured source excerpt before import; discovery snippets, blocked pages, and Google Places seed text are not enough.`);
  }
}

function newProviderCandidateStub(decision, correctedFields = {}) {
  return {
    id: String(decision.providerId || "").trim(),
    name: correctedFields.name || decision.providerName || decision.name || String(decision.providerId || "").trim(),
    type: correctedFields.type || "",
    region: correctedFields.region || "",
    city: correctedFields.city || "",
    source: decision.sourceUrl || correctedFields.source || correctedFields.website || ""
  };
}

function makeWatchlistItem(provider, decision) {
  const checkedDate = decision.reviewedDate || new Date().toISOString().slice(0, 10);
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    region: provider.region,
    city: provider.city,
    url: decision.sourceUrl || provider.availabilitySource || provider.source || provider.website || "",
    lastKnownStatus: "unavailable",
    reason: decision.sourceExcerpt || provider.availabilityEvidence || decision.reviewNotes || "Moved from live providers by manual review decision.",
    unavailablePatterns: [
      "not\\s+(?:currently\\s+)?(?:taking|accepting)\\s+(?:on\\s+)?new\\s+(?:clients|patients|referrals)",
      "books?\\s+(?:are\\s+)?closed",
      "no\\s+(?:current\\s+)?availability",
      "no\\s+new\\s+(?:psychiatry\\s+)?referrals?\\s+(?:are\\s+)?(?:being\\s+)?(?:taken|accepted)",
      "referrals?\\s+(?:are\\s+)?paused"
    ],
    availabilityStatus: provider.availabilityStatus || "not_accepting",
    availabilityCheckedAt: provider.availabilityCheckedAt || checkedDate,
    availabilityEvidence: provider.availabilityEvidence || decision.sourceExcerpt || "",
    availabilitySource: provider.availabilitySource || decision.sourceUrl || provider.source || provider.website || "",
    availabilityNeedsManualReview: Boolean(provider.availabilityNeedsManualReview),
    availablePatterns: [
      "taking\\s+new\\s+(?:clients|patients|referrals)",
      "accepting\\s+new\\s+(?:clients|patients|referrals)",
      "new\\s+client\\s+enquir(?:y|ies)",
      "book\\s+(?:an\\s+)?appointment"
    ],
    checkedAt: checkedDate,
    providerCandidate: {
      name: provider.name,
      clinicianName: provider.clinicianName || "",
      practiceName: provider.practiceName || "",
      type: provider.type,
      region: provider.region,
      city: provider.city,
      address: provider.address || "",
      phone: provider.phone || "",
      text: provider.text || "",
      email: provider.email || "",
      website: provider.website || "",
      source: provider.source || "",
      tags: provider.tags || [],
      needScope: provider.needScope || [],
      fit: provider.fit || "",
      firstStep: provider.firstStep || "",
      cost: provider.cost || "",
      confidence: provider.confidence || "low",
      sourceQuality: provider.sourceQuality || "",
      availabilityStatus: provider.availabilityStatus || "not_accepting",
      availabilityCheckedAt: provider.availabilityCheckedAt || checkedDate,
      availabilityEvidence: provider.availabilityEvidence || decision.sourceExcerpt || "",
      availabilitySource: provider.availabilitySource || decision.sourceUrl || provider.source || provider.website || "",
      availabilityNeedsManualReview: Boolean(provider.availabilityNeedsManualReview)
    }
  };
}

function updateWatchlist(watchlist, item) {
  const next = Array.isArray(watchlist) ? { version: 1, updated: new Date().toISOString().slice(0, 10), items: watchlist } : clone(watchlist || { version: 1, items: [] });
  next.version = next.version || 1;
  next.updated = new Date().toISOString().slice(0, 10);
  next.items = Array.isArray(next.items) ? next.items : [];
  const index = next.items.findIndex((existing) => existing.id === item.id);
  if (index >= 0) next.items[index] = { ...next.items[index], ...item };
  else next.items.push(item);
  return next;
}

function makeLogEvent({ provider, action, decision, oldFields, newFields, correctedFields }) {
  return {
    eventId: crypto.randomUUID(),
    providerId: provider?.id || decision.providerId || "",
    providerName: provider?.name || decision.providerName || "",
    action,
    reviewer: decision.reviewer || "",
    reviewedDate: decision.reviewedDate || "",
    sourceUrl: decision.sourceUrl || decision.correctedFields?.source || provider?.source || provider?.website || "",
    sourceExcerpt: decision.sourceExcerpt || decision.correctedFields?.availabilityEvidence || decision.correctedFields?.referralSourceExcerpt || "",
    auditRulesResolved: Array.isArray(decision.auditRulesResolved) ? decision.auditRulesResolved : [],
    oldFields,
    newFields,
    correctedFields: correctedFields || {},
    notes: decision.reviewNotes || decision.notes || "",
    generatedAt: new Date().toISOString()
  };
}

export function applyReviewDecisions({
  providers,
  decisions,
  watchlist = { version: 1, items: [] },
  allowUnsafeFields = false,
  allowAiReviewDecisions = false
}) {
  const nextProviders = clone(providers);
  let nextWatchlist = clone(watchlist);
  const events = [];
  const errors = [];
  const applied = [];

  for (const decision of decisionList(decisions)) {
    const action = decision.action || decision.reviewDecision;
    if (!VALID_DECISIONS.has(action)) {
      errors.push({ providerId: decision.providerId || "", action, error: `Unsupported review decision "${action}".` });
      continue;
    }
    if ((decision.aiReview || decision.generatedBy === "provider-ai-reviewer" || isCodexAutomationDecision(decision)) && !allowAiReviewDecisions) {
      errors.push({
        providerId: decision.providerId || "",
        action,
        error: "AI review decisions are draft proposals. Re-run with --allow-ai-review-decisions only after intentional review and dry-run validation."
      });
      continue;
    }
    const index = nextProviders.findIndex((provider) => provider.id === decision.providerId);
    const provider = index >= 0 ? nextProviders[index] : null;

    try {
      if (isCodexAutomationDecision(decision)) validateCodexAutomationDecision(provider, decision, action);
      ensureAllowedFields(decision.correctedFields || {}, allowUnsafeFields);
      const correctedFields = clone(decision.correctedFields || {});
      let oldFields = {};
      let newFields = {};

      if (!provider) {
        const isNewCandidate = decision.newProviderCandidate === true || explicitApprovals(decision).has("new-provider-import");
        if (!isNewCandidate) {
          errors.push({ providerId: decision.providerId || "", action, error: "Provider not found in providers.json." });
          continue;
        }
        const candidateStub = newProviderCandidateStub(decision, correctedFields);
        if (action === "reject" || action === "needs_more_info") {
          newFields = action === "reject" ? { rejectedNewProviderCandidate: true } : {};
          events.push(makeLogEvent({ provider: candidateStub, action, decision, oldFields, newFields, correctedFields }));
          applied.push({ providerId: candidateStub.id, action });
          continue;
        }
        if (action !== "approve") {
          throw new Error("New provider candidates can only be imported with approve, or recorded as reject/needs_more_info.");
        }
        const newProvider = makeNewProviderFromDecision(decision, correctedFields);
        validateNewProviderImport(newProvider, decision, nextProviders);
        validateSafety({ ...newProvider, needsManualVerification: true, tags: [], advertisedSpecialties: [] }, newProvider, decision);
        newFields = clone(newProvider);
        nextProviders.push(newProvider);
        events.push(makeLogEvent({ provider: newProvider, action: "add_new_provider", decision, oldFields, newFields, correctedFields }));
        applied.push({ providerId: newProvider.id, action: "add_new_provider" });
        continue;
      }

      if (action === "needs_more_info") {
        oldFields = {};
        newFields = {};
      } else if (action === "approve") {
        const reviewedMonth = monthFromDate(decision.reviewedDate);
        const nextProvider = {
          ...provider,
          needsManualVerification: false,
          lastVerified: provider.lastVerified || reviewedMonth,
          verified: provider.verified || reviewedMonth,
          ...correctedFields
        };
        validateSafety(provider, nextProvider, decision);
        oldFields = oldFieldsFor(provider, { needsManualVerification: false, lastVerified: nextProvider.lastVerified, verified: nextProvider.verified, ...correctedFields });
        newFields = {
          needsManualVerification: nextProvider.needsManualVerification,
          lastVerified: nextProvider.lastVerified,
          verified: nextProvider.verified,
          ...correctedFields
        };
        nextProviders[index] = nextProvider;
      } else if (action === "adjust") {
        const nextProvider = applyCorrectedFields(provider, correctedFields);
        validateSafety(provider, nextProvider, decision);
        oldFields = oldFieldsFor(provider, correctedFields);
        newFields = Object.fromEntries(Object.keys(correctedFields).map((field) => [field, nextProvider[field]]));
        nextProviders[index] = nextProvider;
      } else if (action === "reject") {
        oldFields = clone(provider);
        newFields = { excludedFromLiveProviders: true };
        nextProviders.splice(index, 1);
      } else if (action === "move_to_watchlist") {
        const nextProvider = applyCorrectedFields(provider, correctedFields);
        validateSafety(provider, nextProvider, decision);
        const watchlistItem = makeWatchlistItem(nextProvider, decision);
        nextWatchlist = updateWatchlist(nextWatchlist, watchlistItem);
        oldFields = clone(provider);
        newFields = { movedToWatchlist: watchlistItem.id, ...correctedFields };
        nextProviders.splice(index, 1);
      } else if (action === "duplicate") {
        if (!decision.keptProviderId) throw new Error("duplicate decision requires keptProviderId.");
        if (!nextProviders.some((candidate) => candidate.id === decision.keptProviderId)) throw new Error(`keptProviderId "${decision.keptProviderId}" was not found.`);
        oldFields = clone(provider);
        newFields = { duplicateOf: decision.keptProviderId };
        nextProviders.splice(index, 1);
      }

      events.push(makeLogEvent({ provider, action, decision, oldFields, newFields, correctedFields }));
      applied.push({ providerId: provider.id, action });
    } catch (error) {
      errors.push({ providerId: decision.providerId || "", action, error: error.message });
    }
  }

  return { providers: nextProviders, watchlist: nextWatchlist, events, errors, applied };
}

export function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const providers = readJsonIfExists(config.providers, []);
  const decisions = readJsonIfExists(config.decisions, { decisions: [] });
  const watchlist = readJsonIfExists(config.watchlist, { version: 1, items: [] });
  const result = applyReviewDecisions({
    providers,
    decisions,
    watchlist,
    allowUnsafeFields: config.allowUnsafeFields,
    allowAiReviewDecisions: config.allowAiReviewDecisions
  });

  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR ${error.providerId} ${error.action}: ${error.error}`);
    process.exitCode = 1;
    return result;
  }

  if (!config.dryRun) {
    writeJson(config.providers, result.providers);
    writeJson(config.watchlist, result.watchlist);
    appendJsonl(config.log, result.events);
  }

  console.log(`${config.dryRun ? "Validated" : "Applied"} ${result.applied.length} provider review decision(s).`);
  console.log(`Review log events: ${result.events.length}${config.dryRun ? " (dry run; not written)" : ""}.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
