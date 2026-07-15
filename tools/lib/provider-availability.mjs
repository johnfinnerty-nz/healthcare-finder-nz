export const availabilityStatuses = new Set([
  "accepting",
  "waitlist",
  "not_accepting",
  "referrals_paused",
  "unknown",
  "not_published"
]);

export const directAvailabilityTypes = new Set([
  "addiction",
  "counsellor",
  "gp",
  "mens-centre",
  "psychiatrist",
  "psychologist",
  "public-service",
  "youth"
]);

export const restrictiveStatuses = new Set(["not_accepting", "referrals_paused"]);

export const availabilityCadenceDays = {
  accepting: 1,
  waitlist: 30,
  not_accepting: 1,
  referrals_paused: 1,
  unknown: 90,
  not_published: 90
};

const restrictivePatterns = [
  {
    status: "referrals_paused",
    pattern: /\b(?:referrals?\s+(?:are\s+)?(?:paused|closed)|not\s+(?:currently\s+)?accepting\s+new\s+referrals?|closed\s+to\s+new\s+referrals?|no\s+new\s+(?:psychiatry\s+)?referrals?\s+(?:are\s+)?(?:being\s+)?(?:taken|accepted))\b/i
  },
  {
    status: "not_accepting",
    pattern: /\b(?:full\s+capacity|currently\s+full|books?\s+(?:are\s+)?closed|wait\s*list\s+(?:is\s+)?closed|not\s+(?:currently\s+)?(?:taking|accepting)\s+(?:on\s+)?new\s+(?:clients|patients)|unable\s+to\s+(?:take\s+on|accept|see)\s+new\s+(?:clients|patients)|no\s+(?:current\s+)?availability|not\s+available\s+for\s+new\s+(?:clients|patients)|currently\s+unavailable|fully\s+booked|closing\s+(?:its|our|their)\s+doors?\s+shortly)\b/i
  }
];

const waitlistPatterns = [
  /\b(?:wait\s*list|waitlist|waiting\s+list|limited\s+availability|very\s+limited|appointment\s+wait\s*:?\s*(?:less\s+than|1\s*-\s*3|3\s*-\s*6|6\+|within\s+\d+)|(?:approximate\s+)?wait\s*time\s+for\s+(?:a\s+)?first\s+appointment\s*:\s*(?:less\s+than\s+)?\d+\s*(?:days?|weeks?|months?)|(?:assessment|appointment|psychiatrist)?\s*wait[- ]time\s+(?:is|of)\s+(?:\d+|a\s+few|few|several|a\s+couple\s+of)\s*(?:days?|weeks?|months?)|next\s+available\s+appointment)\b/i
];

const acceptingPatterns = [
  /\b(?:currently\s+available\s+to\s+see\s+new\s+clients|accepting\s+new\s+(?:private\s+)?clients\s+now|accepting\s+new\s+(?:clients|patients|referrals)|taking\s+new\s+(?:clients|patients|referrals)|new\s+(?:patient\s+)?enrolments?\s+(?:are\s+)?open|enrolments?\s+(?:are\s+)?open|new\s+client\s+enquir(?:y|ies)\s+(?:welcome|open)|self-referral\s+(?:is\s+)?currently\s+available|book\s+(?:a\s+)?(?:session|consultation|appointment)\s+(?:now|online))\b/i
];

const htmlBreakPattern = /<\/?(?:p|div|li|section|article|h[1-6]|br)\b[^>]*>/gi;

export function normaliseAvailabilityText(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(htmlBreakPattern, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function availabilityEvidenceText(provider = {}) {
  return normaliseAvailabilityText([
    provider.availabilityEvidence,
    provider.availabilityNote,
    provider.appointmentWait ? `appointment wait: ${provider.appointmentWait}` : "",
    provider.hours,
    provider.cost,
    provider.fit,
    provider.firstStep,
    ...(provider.specialties || []),
    ...(provider.services || []),
    ...(provider.patientGroups || []),
    ...(provider.ageGroups || [])
  ].filter(Boolean).join("\n"));
}

function contextSuggestsQuestionOrCaution(text, index) {
  const before = text.slice(Math.max(0, index - 90), index).toLowerCase();
  return /\b(?:ask|confirm|check|whether|if|when|until|before|no longer says|does not say|not)\b/.test(before);
}

function firstMatch(patterns, text, { requireDirectEvidence = false } = {}) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || typeof match.index !== "number") continue;
    if (requireDirectEvidence && contextSuggestsQuestionOrCaution(text, match.index)) continue;
    return {
      evidence: match[0].slice(0, 320),
      pattern: String(pattern)
    };
  }
  return null;
}

export function detectAvailabilityFromText(textValue = "") {
  const text = normaliseAvailabilityText(textValue);
  if (!text) return { status: "not_published", evidence: "", matchedPattern: "" };

  for (const item of restrictivePatterns) {
    const match = firstMatch([item.pattern], text);
    if (match) return { status: item.status, ...match };
  }

  const waitlist = firstMatch(waitlistPatterns, text);
  if (waitlist) return { status: "waitlist", ...waitlist };

  const accepting = firstMatch(acceptingPatterns, text, { requireDirectEvidence: true });
  if (accepting) return { status: "accepting", ...accepting };

  return { status: "not_published", evidence: "", matchedPattern: "" };
}

export function normaliseAvailabilityStatus(value) {
  return availabilityStatuses.has(value) ? value : "";
}

export function isDirectoryLike(provider = {}) {
  return provider.type === "directory" || provider.tags?.includes("directory");
}

export function isCrisisProvider(provider = {}) {
  return provider.crisisOnly === true || provider.tags?.includes("crisis") || provider.id?.startsWith("crisis-");
}

export function requiresAvailabilityMetadata(provider = {}) {
  if (!directAvailabilityTypes.has(provider.type)) return false;
  if (isDirectoryLike(provider)) return false;
  if (provider.type === "helpline") return false;
  if (isCrisisProvider(provider)) return false;
  return Boolean(provider.website || provider.source || provider.phone || provider.email || provider.text);
}

export function providerAvailability(provider = {}) {
  const existingStatus = normaliseAvailabilityStatus(provider.availabilityStatus);
  if (existingStatus) {
    return {
      status: existingStatus,
      checkedAt: provider.availabilityCheckedAt || "",
      evidence: provider.availabilityEvidence || "",
      source: provider.availabilitySource || provider.source || provider.website || "",
      needsManualReview: Boolean(provider.availabilityNeedsManualReview),
      stale: false
    };
  }

  const detected = detectAvailabilityFromText(availabilityEvidenceText(provider));
  return {
    status: detected.status,
    checkedAt: provider.lastVerified || provider.verified || "",
    evidence: detected.evidence,
    source: provider.source || provider.website || "",
    needsManualReview: detected.status === "not_published",
    stale: false
  };
}

export function withAvailabilityDefaults(provider = {}, defaults = {}) {
  const record = { ...provider };
  const detected = detectAvailabilityFromText(availabilityEvidenceText(record));
  const status = normaliseAvailabilityStatus(record.availabilityStatus) || detected.status || "not_published";
  const checkedAt = record.availabilityCheckedAt
    || defaults.checkedAt
    || record.lastVerified
    || record.verified
    || new Date().toISOString().slice(0, 7);
  const source = record.availabilitySource
    || record.source
    || record.website
    || defaults.source
    || "";
  const evidence = record.availabilityEvidence || detected.evidence || "";

  record.availabilityStatus = status;
  record.availabilityCheckedAt = checkedAt;
  record.availabilityEvidence = evidence;
  record.availabilitySource = source;

  if (typeof record.availabilityNeedsManualReview !== "boolean") {
    record.availabilityNeedsManualReview = requiresAvailabilityMetadata(record)
      && (status !== "accepting" || !evidence);
  }

  return record;
}

export function parseDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return new Date(`${text}-01T00:00:00Z`);
  return null;
}

export function daysSince(value, today = new Date()) {
  const date = parseDate(value);
  if (!date) return Infinity;
  return Math.floor((today.getTime() - date.getTime()) / 86400000);
}

export function isAvailabilityStale(status, checkedAt, today = new Date()) {
  const cadence = availabilityCadenceDays[status];
  if (!cadence) return false;
  return daysSince(checkedAt, today) > cadence;
}

export function statusFromWatchlistItem(item = {}) {
  const text = `${item.reason || ""} ${(item.unavailablePatterns || []).join(" ")} ${item.lastKnownStatus || ""}`;
  if (/referrals?|referral/i.test(text) && /not|closed|paused|unavailable/i.test(text)) return "referrals_paused";
  return "not_accepting";
}

export function availabilityLabel(status) {
  return {
    accepting: "Listed as accepting new clients. Please confirm directly with the provider.",
    waitlist: "May have a waitlist. Could still be worth contacting if this provider feels like a strong fit.",
    not_accepting: "Currently listed as not accepting new clients. This may have changed - check with the provider before ruling them out.",
    referrals_paused: "Referrals appear to be paused. This may have changed - check with the provider directly.",
    unknown: "Availability is not clearly published. Please confirm directly with the provider.",
    not_published: "Availability is not clearly published. Please confirm directly with the provider."
  }[status] || "Please confirm availability directly with the provider.";
}
