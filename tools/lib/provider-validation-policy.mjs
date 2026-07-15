import crypto from "node:crypto";
import {
  confidenceRank,
  normaliseComparable,
  sourceDomain,
  sourceTrust,
  unique
} from "./provider-evidence-scorer.mjs";
import { defaultProviderValidation } from "./provider-canonical.mjs";

export const VALIDATION_ENGINE_VERSION = "1.0.0";

export const claimCadenceDays = {
  availability_accepting: 1,
  availability_waitlist: 30,
  availability_restrictive: 1,
  contact: 90,
  referral: 90,
  cost: 90,
  scope: 180,
  cultural: 180,
  telehealth: 180,
  registration: 365,
  identity: 365,
  location: 180
};

export const sensitivePreferenceTags = new Set([
  "maori",
  "pasifika",
  "asian",
  "rainbow",
  "trauma-informed",
  "telehealth"
]);

export const broadNeedTags = new Set(["depression", "anxiety", "trauma", "addiction", "work"]);
export const supportedEvidenceTags = new Set([
  ...broadNeedTags,
  ...sensitivePreferenceTags,
  "sexual-harm",
  "sensitive-claims",
  "alcohol",
  "drug",
  "gambling",
  "rehabilitation",
  "acc",
  "concussion",
  "pain",
  "return-to-work",
  "vocational",
  "relationships",
  "grief"
]);
export const rankingSensitiveFields = new Set([
  "tags",
  "needScope",
  "specialties",
  "advertisedSpecialties",
  "advertisedSpecialtyEvidence",
  "specialtyTagsSource",
  "patientGroups",
  "ageGroups",
  "providerGender",
  "providerGenderEvidence",
  "providerGenderSource",
  "onlineAvailable",
  "phoneSupport",
  "inPerson",
  "availabilityStatus",
  "availabilityEvidence",
  "availabilitySource",
  "referralType",
  "requiresReferral",
  "cost"
]);

const trustedClaimSources = new Set([
  "provider_owned",
  "clinic_owned",
  "healthpoint",
  "official_register",
  "professional_directory",
  "ngo_directory"
]);
const ownerSources = new Set(["provider_owned", "clinic_owned"]);
const restrictiveAvailability = new Set(["not_accepting", "referrals_paused"]);
const clinicalFields = new Set([
  "tags",
  "needScope",
  "specialties",
  "advertisedSpecialties",
  "patientGroups",
  "ageGroups",
  "providerGender",
  "onlineAvailable",
  "phoneSupport",
  "inPerson",
  "availabilityStatus"
]);
const arrayClaimFields = new Set(["tags", "needScope", "specialties", "advertisedSpecialties", "patientGroups", "ageGroups", "services", "languages"]);

function isoAddDays(value, days) {
  const date = new Date(value || Date.now());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function categoryForClaim(field, value) {
  if (/availability/i.test(field)) {
    if (value === "accepting") return "availability_accepting";
    if (value === "waitlist") return "availability_waitlist";
    return "availability_restrictive";
  }
  if (["phone", "text", "email", "website", "bookingUrl"].includes(field)) return "contact";
  if (/referral|requiresReferral/i.test(field)) return "referral";
  if (field === "cost") return "cost";
  if (["address", "city", "region", "lat", "lon"].includes(field)) return "location";
  if (["registration", "membership", "qualification", "type"].includes(field)) return "registration";
  if (["name", "clinicianName", "practiceName"].includes(field)) return "identity";
  if (field === "onlineAvailable" || (field === "tags" && value === "telehealth")) return "telehealth";
  if (field === "tags" && sensitivePreferenceTags.has(value)) return "cultural";
  return "scope";
}

export function claimExpiresAt(field, value, capturedAt = new Date().toISOString()) {
  const cadence = claimCadenceDays[categoryForClaim(field, value)] || 180;
  return isoAddDays(capturedAt, cadence);
}

export function isClaimStale(claim, now = new Date()) {
  const expiry = claim.expiresAt || claimExpiresAt(claim.field, claim.value, claim.capturedAt);
  return !expiry || new Date(expiry).getTime() < now.getTime();
}

export function isValidNzPhone(value = "") {
  const compact = String(value).replace(/[^\d+]/g, "");
  return /^(?:\+64|0)(?:2\d{7,9}|[3-9]\d{7,9})$/.test(compact);
}

export function isValidEmail(value = "") {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value).trim());
}

export function exactExcerptMatches(claim = {}, capturedText = "") {
  const excerpt = String(claim.excerpt || "");
  if (!excerpt || !capturedText) return false;
  return String(capturedText).includes(excerpt);
}

function sourceCanProveClaim(claim) {
  if (!trustedClaimSources.has(claim.sourceType)) return false;
  if (claim.sourceType === "professional_directory" && ["availabilityStatus", "bookingUrl"].includes(claim.field)) return false;
  return true;
}

function explicitAvailabilityEvidence(claim) {
  const excerpt = String(claim.excerpt || "");
  if (claim.value === "accepting") {
    return /\b(?:currently\s+)?(?:accepting|taking)\s+(?:on\s+)?new\s+(?:clients|patients|referrals)|new\s+(?:patient\s+)?enrolments?\s+(?:are\s+)?open|currently\s+available\s+to\s+see\s+new\s+clients\b/i.test(excerpt)
      || claim.evidenceKind === "visible_selectable_appointment";
  }
  if (claim.value === "waitlist") return /\bwait\s*list|waiting\s+list|limited\s+availability|appointment\s+wait\b/i.test(excerpt);
  if (restrictiveAvailability.has(claim.value)) return /\bnot\s+(?:currently\s+)?(?:taking|accepting)|books?\s+(?:are\s+)?closed|referrals?\s+(?:are\s+)?(?:paused|closed)|no\s+(?:current\s+)?availability|fully\s+booked|closing\s+(?:our|its|their)\s+doors?\b/i.test(excerpt);
  return false;
}

function explicitSelfReferralEvidence(claim) {
  return /\bself[- ]?referr?al|self refer|refer yourself|no referral required|without a referral|book directly\b/i.test(String(claim.excerpt || ""));
}

function explicitSensitivePreferenceEvidence(claim) {
  const excerpt = String(claim.excerpt || "");
  if (claim.value === "maori") return /\b(kaupapa maori|kaupapa māori|maori clients?|māori clients?|tangata whenua|taha maori|taha māori|te ao maori|te ao māori)\b/i.test(excerpt);
  if (claim.value === "pasifika") return /\b(pasifika|pacific peoples?|pacific clients?|pacific communities|(?:support|services?|counselling|therapy|language)\s+(?:for|in)\s+(?:samoan|tongan|cook islands maori|cook islands māori)|(?:speaks?|fluent in|sessions? in)\s+(?:samoan|tongan))\b/i.test(excerpt);
  if (claim.value === "asian") return /\b(asian clients?|asian communities|asian services?|(?:support|services?|counselling|therapy|language)\s+(?:for|in)\s+(?:chinese|korean|indian|mandarin|cantonese|hindi|japanese|vietnamese|filipino|thai)|(?:speaks?|fluent in|sessions? in)\s+(?:mandarin|cantonese|hindi|korean|japanese|vietnamese|filipino|thai))\b/i.test(excerpt);
  if (claim.value === "rainbow") return /\b(rainbow|lgbtqia?\+?|lgbtq\+?|gender diverse|transgender|takatapui|takatāpui|queer affirming)\b/i.test(excerpt);
  if (claim.value === "trauma-informed") return /\btrauma[- ]informed\b/i.test(excerpt);
  if (claim.value === "telehealth") return /\btelehealth|online (?:appointments?|sessions?|consultations?)|video (?:appointments?|sessions?|consultations?)|phone (?:appointments?|sessions?|consultations?)\b/i.test(excerpt);
  return false;
}

function explicitTagEvidence(claim) {
  const excerpt = String(claim.excerpt || "");
  if (broadNeedTags.has(claim.value)) {
    const patterns = {
      depression: /\b(depression|depressive disorders?|low mood|mood disorders?)\b/i,
      anxiety: /\b(anxiety|panic attacks?|panic disorder|obsessive[- ]compulsive|ocd|overwhelm)\b/i,
      trauma: /\b(trauma|post[- ]traumatic stress|ptsd|sexual harm|sexual abuse|sensitive claims|emdr)\b/i,
      addiction: /\b(addiction|alcohol and other drugs?|alcohol|drug|gambling harm|substance use|aod)\b/i,
      work: /\b(work(?:place)? stress|burnout|employment|return to work|vocational|study stress|housing stress|financial stress|money stress)\b/i
    };
    return patterns[claim.value].test(excerpt);
  }
  if (sensitivePreferenceTags.has(claim.value)) return explicitSensitivePreferenceEvidence(claim);
  const patterns = {
    "sexual-harm": /\b(sexual harm|sexual abuse|rape|sensitive claims?)\b/i,
    "sensitive-claims": /\b(acc sensitive claims?|sensitive claims?)\b/i,
    alcohol: /\balcohol\b/i,
    drug: /\b(drugs?|substance use|aod)\b/i,
    gambling: /\bgambl(?:ing|e)\b/i,
    rehabilitation: /\brehabilitat(?:ion|ive)\b/i,
    acc: /\bacc\b/i,
    concussion: /\bconcussion\b/i,
    pain: /\b(?:chronic|persistent)?\s*pain\b/i,
    "return-to-work": /\breturn to work\b/i,
    vocational: /\bvocational\b/i,
    relationships: /\brelationships?|couples?\b/i,
    grief: /\bgrief|bereavement|loss\b/i
  };
  return Boolean(patterns[claim.value]?.test(excerpt));
}

function subjectCanOwnClaim(claim, provider) {
  if (!claim.subjectMatched) return false;
  if (!clinicalFields.has(claim.field)) return true;
  if (claim.subjectType === "clinician") return true;
  return !provider.clinicianName && (claim.subjectType === "provider" || claim.subjectType === "practice");
}

function corroboratedClaim(claim, allClaims) {
  const comparable = normaliseComparable(Array.isArray(claim.value) ? claim.value.join("|") : claim.value);
  const sources = unique(allClaims
    .filter((candidate) => candidate.field === claim.field)
    .filter((candidate) => normaliseComparable(Array.isArray(candidate.value) ? candidate.value.join("|") : candidate.value) === comparable)
    .filter((candidate) => sourceCanProveClaim(candidate))
    .map((candidate) => `${candidate.sourceType}:${sourceDomain(candidate.sourceUrl)}`));
  return sources.length >= 2;
}

function modelVerified(claim) {
  return claim.verification?.decision === "supported"
    && ["high", "medium"].includes(claim.verification?.confidence)
    && claim.verification?.excerptMatched !== false;
}

export function evaluateEvidenceClaim(claim, context = {}) {
  const provider = context.provider || {};
  const allClaims = context.allClaims || [];
  const reasons = [];
  if (!claim?.field) reasons.push("missing-field");
  if (!claim?.excerpt || claim.exactExcerpt === false) reasons.push("missing-exact-excerpt");
  if (!sourceCanProveClaim(claim)) reasons.push("source-cannot-prove-claim");
  if (!subjectCanOwnClaim(claim, provider)) reasons.push("subject-not-matched");
  if (isClaimStale(claim, context.now || new Date())) reasons.push("stale-claim");

  const isContact = ["phone", "text", "email", "website", "bookingUrl"].includes(claim.field);
  if (claim.field === "email" && !isValidEmail(claim.value)) reasons.push("invalid-email-format");
  if (["phone", "text"].includes(claim.field) && !isValidNzPhone(claim.value)) reasons.push("invalid-nz-phone-format");
  const directoryNavigation = provider.type === "directory"
    && claim.field === "website"
    && ["professional_directory", "healthpoint", "official_register", "ngo_directory"].includes(claim.sourceType);
  if (isContact && !directoryNavigation && !ownerSources.has(claim.sourceType) && !corroboratedClaim(claim, allClaims)) reasons.push("contact-not-owner-or-corroborated");

  if (claim.field === "availabilityStatus") {
    if (!ownerSources.has(claim.sourceType)) reasons.push("availability-not-provider-owned");
    if (!explicitAvailabilityEvidence(claim)) reasons.push("availability-not-explicit");
    if (claim.evidenceKind === "generic_booking_button") reasons.push("generic-booking-is-not-availability");
  }

  if (provider.type === "psychiatrist" && claim.field === "referralType" && claim.value === "self") {
    if (!ownerSources.has(claim.sourceType)) reasons.push("self-referral-not-provider-owned");
    if (!explicitSelfReferralEvidence(claim)) reasons.push("self-referral-not-explicit");
  }

  if (claim.field === "advertisedSpecialties" && !String(claim.excerpt || "").trim()) reasons.push("advertised-specialty-not-explicit");
  if (claim.field === "tags" && !supportedEvidenceTags.has(claim.value)) reasons.push("unsupported-ranking-tag-value");
  if (claim.field === "tags" && !claim.subjectMatched) reasons.push("ranking-tag-not-subject-matched");
  if (claim.field === "tags" && sensitivePreferenceTags.has(claim.value) && !explicitTagEvidence(claim)) reasons.push("support-preference-not-explicit");
  if (claim.field === "tags" && supportedEvidenceTags.has(claim.value) && !sensitivePreferenceTags.has(claim.value) && !explicitTagEvidence(claim)) reasons.push("ranking-tag-not-explicit");
  if (claim.field === "providerGender" && !/\b(?:she\/her|he\/him|female|male|woman|man)\b/i.test(claim.excerpt || "")) reasons.push("gender-not-explicit");
  if (claim.field === "onlineAvailable" && !/\btelehealth|online (?:appointments?|sessions?|consultations?)|video (?:appointments?|sessions?|consultations?)|phone (?:appointments?|sessions?|consultations?)\b/i.test(claim.excerpt || "")) reasons.push("telehealth-not-explicit");
  if (claim.field === "phoneSupport" && !/\bphone (?:support|appointments?|sessions?|consultations?)|call (?:us|the service|our team)|helpline\b/i.test(claim.excerpt || "")) reasons.push("phone-support-not-explicit");
  if (claim.field === "inPerson" && !/\bin[- ]person|face[- ]to[- ]face|at (?:our|the) (?:clinic|practice|rooms?)|clinic appointments?\b/i.test(claim.excerpt || "")) reasons.push("in-person-not-explicit");

  if (context.requireModelVerification !== false && !modelVerified(claim)) reasons.push("independent-model-verification-missing");
  if ((context.pageApplicationCount || 0) > 5 && !claim.practiceWide) reasons.push("source-page-applied-to-too-many-providers");

  return {
    accepted: reasons.length === 0,
    reasons,
    score: Number(Math.max(0, Math.min(1,
      (sourceTrust[claim.sourceType] || sourceTrust.unknown)
      + (claim.exactExcerpt === false ? -0.35 : 0.08)
      + (claim.subjectMatched ? 0.08 : -0.35)
      + (modelVerified(claim) ? 0.08 : -0.2)
      + (corroboratedClaim(claim, allClaims) ? 0.08 : 0)
    )).toFixed(3))
  };
}

function claimKey(claim) {
  return `${claim.field}:${normaliseComparable(Array.isArray(claim.value) ? claim.value.join("|") : claim.value)}`;
}

function fieldMap(claims) {
  const output = {};
  for (const claim of claims) {
    if (arrayClaimFields.has(claim.field) || Array.isArray(claim.value)) {
      output[claim.field] = unique([...(output[claim.field] || []), ...(Array.isArray(claim.value) ? claim.value : [claim.value])]);
    } else {
      const current = output[claim.field];
      if (!current || (confidenceRank[claim.confidence] || 0) > (confidenceRank[current.confidence] || 0)) output[claim.field] = claim;
    }
  }
  for (const [field, value] of Object.entries(output)) {
    if (!Array.isArray(value) && value && typeof value === "object" && "value" in value) output[field] = value.value;
  }
  return output;
}

function negativeAvailabilityObservations(previous, acceptedClaims, runId) {
  const previousObservations = (previous.observations || []).filter((item) => item.kind === "restrictive_availability");
  const newObservations = acceptedClaims
    .filter((claim) => claim.field === "availabilityStatus" && restrictiveAvailability.has(claim.value))
    .map((claim) => ({
      kind: "restrictive_availability",
      runId,
      value: claim.value,
      sourceUrl: claim.sourceUrl,
      sourceHash: claim.pageHash || "",
      excerpt: claim.excerpt,
      capturedAt: claim.capturedAt
    }));
  const seen = new Set();
  return [...previousObservations, ...newObservations].filter((item) => {
    const key = `${item.runId}|${item.sourceUrl}|${item.sourceHash}|${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-20);
}

export function decideProviderValidation({ provider, claims = [], previous = {}, fetchOutcome = "not_checked", runId = "", modelComplete = false, now = new Date(), pageApplicationCount = {} } = {}) {
  const base = defaultProviderValidation(provider, previous);
  const evaluated = claims.map((claim) => ({
    ...claim,
    policy: evaluateEvidenceClaim(claim, {
      provider,
      allClaims: claims,
      now,
      requireModelVerification: true,
      pageApplicationCount: pageApplicationCount[claim.sourceUrl] || 0
    })
  }));
  const acceptedClaims = evaluated.filter((claim) => claim.policy.accepted);
  const rejectedClaims = evaluated.filter((claim) => !claim.policy.accepted);
  const observations = negativeAvailabilityObservations(base, acceptedClaims, runId);
  const restrictiveRuns = unique(observations.map((item) => item.runId).filter(Boolean));
  const restrictiveValues = unique(observations.map((item) => item.value));
  const conflicts = [];

  for (const field of unique(acceptedClaims.map((claim) => claim.field)).filter((field) => !arrayClaimFields.has(field))) {
    const values = unique(acceptedClaims.filter((claim) => claim.field === field).map((claim) => JSON.stringify(claim.value)));
    if (values.length > 1) conflicts.push({ field, values: values.map((value) => JSON.parse(value)) });
  }

  let firstUnreachableAt = base.firstUnreachableAt;
  let consecutiveFetchFailures = base.consecutiveFetchFailures;
  if (["blocked", "unreachable", "failed"].includes(fetchOutcome)) {
    firstUnreachableAt ||= now.toISOString();
    consecutiveFetchFailures += 1;
  } else if (fetchOutcome === "fetched") {
    firstUnreachableAt = "";
    consecutiveFetchFailures = 0;
  }
  const unreachableDays = firstUnreachableAt ? Math.floor((now.getTime() - new Date(firstUnreachableAt).getTime()) / 86400000) : 0;

  let status = "monitoring";
  const reasons = [];
  if (!modelComplete) reasons.push("Model extraction and independent verification did not complete; publish is blocked.");
  if (conflicts.length) reasons.push("Unresolved field conflicts remain.");
  if (restrictiveRuns.length >= 2 && restrictiveValues.length === 1) {
    status = "suppressed";
    reasons.push(`Explicit ${restrictiveValues[0]} evidence was confirmed in two independent runs.`);
  } else if (restrictiveRuns.length === 1) {
    status = "monitoring";
    reasons.push("Restrictive availability needs a second independent fetch before suppression.");
  } else if (unreachableDays >= 30 && consecutiveFetchFailures >= 3) {
    status = "unverifiable";
    reasons.push("All known source paths have remained unreachable for at least 30 days.");
  } else if (["blocked", "unreachable", "failed"].includes(fetchOutcome)) {
    status = base.status;
    reasons.push("A source fetch failed, so the previous validation state was retained.");
  } else if (modelComplete && !conflicts.length) {
    const acceptedFields = new Set(acceptedClaims.map((claim) => claim.field));
    const identity = provider.clinicianName
      ? acceptedFields.has("clinicianName")
      : ["name", "practiceName"].some((field) => acceptedFields.has(field));
    const professionalRole = ["type", "registration"].some((field) => acceptedFields.has(field));
    const contact = ["phone", "text", "email", "website"].some((field) => acceptedFields.has(field));
    const location = acceptedFields.has("address") || (acceptedFields.has("city") && acceptedFields.has("region"));
    const rankingEvidence = acceptedClaims.some((claim) => rankingSensitiveFields.has(claim.field));
    status = identity && professionalRole && contact && location
      ? rankingEvidence ? "verified" : "limited"
      : "unverifiable";
    reasons.push(status === "verified"
      ? "Identity, professional role, location, contact, and at least one ranking-sensitive field passed evidence policy."
      : status === "limited"
        ? "Identity, professional role, location, and contact passed; unsupported ranking claims will fail closed."
        : "A publishable identity, professional role, location, and direct contact path were not all established.");
  }

  const publishableClaims = acceptedClaims.filter((claim) => !(claim.field === "availabilityStatus" && restrictiveAvailability.has(claim.value)));

  return {
    providerId: provider.id,
    status,
    fetchOutcome,
    lastRunId: runId,
    lastCheckedAt: now.toISOString(),
    firstUnreachableAt,
    consecutiveFetchFailures,
    approvedClaims: fieldMap(publishableClaims),
    approvedClaimIds: publishableClaims.map((claim) => claim.claimId),
    rejectedClaims: Object.fromEntries(rejectedClaims.map((claim) => [claim.claimId || claimKey(claim), claim.policy.reasons])),
    conflicts,
    observations,
    reasons: reasons.length ? reasons : ["No state transition was made."],
    legacySafeguardsActive: !modelComplete,
    evidenceSummary: {
      total: evaluated.length,
      accepted: acceptedClaims.length,
      rejected: rejectedClaims.length
    },
    evaluatedClaims: evaluated
  };
}

export function runIdFor(timestamp = new Date().toISOString()) {
  return `validation-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
}
