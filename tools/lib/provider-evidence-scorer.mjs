import crypto from "node:crypto";

export const sourceTrust = {
  provider_owned: 0.95,
  clinic_owned: 0.9,
  healthpoint: 0.88,
  official_register: 0.85,
  professional_directory: 0.78,
  ngo_directory: 0.72,
  google_places: 0.55,
  linkedIn_public: 0.45,
  search_result: 0.25,
  third_party_directory: 0.5,
  unknown: 0.25
};

export const confidenceRank = { high: 3, medium: 2, low: 1, none: 0 };

export function compact(value, max = 360) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normaliseComparable(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value) {
  return normaliseComparable(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

export function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== ""))];
}

export function sourceDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function emailDomain(value) {
  return String(value || "").split("@")[1]?.toLowerCase() || "";
}

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function sourceTypeFromUrl(url = "") {
  const host = sourceDomain(url);
  if (!host) return "unknown";
  const matches = (...domains) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (matches("healthpoint.co.nz")) return "healthpoint";
  if (matches("yourhealthinmind.org", "ranzcp.org", "mcnz.org.nz", "psychologistsboard.org.nz")) return "official_register";
  if (matches("nzccp.co.nz", "psychologytoday.com", "talkingworks.co.nz")) return "professional_directory";
  if (matches("linkedin.com")) return "linkedIn_public";
  if (matches("google.com", "bing.com")) return "search_result";
  if (matches("doctorpricer.co.nz")) return "third_party_directory";
  if (matches("mentalhealth.org.nz", "health.nz", "healthnz.govt.nz")) return "ngo_directory";
  // Domain shape alone cannot prove that a page belongs to the provider named
  // in a record. Ownership is promoted only after subject/identity matching.
  return "unknown";
}

export function classifyProviderSource({ url = "", provider = {}, pageText = "", allowIdentityMatchedDomain = false } = {}) {
  const classified = sourceTypeFromUrl(url);
  if (classified !== "unknown") return classified;

  const host = sourceDomain(url);
  if (!host) return "unknown";
  const knownDomains = unique([
    sourceDomain(provider.website),
    sourceDomain(provider.source),
    emailDomain(provider.email)
  ]);
  const knownDomain = knownDomains.includes(host);
  if (!knownDomain && !allowIdentityMatchedDomain) return "unknown";

  const text = normaliseComparable(pageText);
  const clinician = normaliseComparable(provider.clinicianName || "");
  const practice = normaliseComparable(provider.practiceName || provider.name || "");
  const providerName = normaliseComparable(provider.name || "");
  const clinicianMatched = clinician && text.includes(clinician);
  const practiceMatched = practice && text.includes(practice);
  const providerMatched = providerName && text.includes(providerName);

  if (!clinicianMatched && !practiceMatched && !providerMatched) return "unknown";
  if (!knownDomain) {
    const hostComparable = normaliseComparable(host.replace(/\.(?:co\.)?nz$|\.(?:com|org|net)$/i, ""));
    const ownershipNames = unique([provider.practiceName, provider.clinicianName, provider.name]).filter(Boolean);
    const ignored = new Set(["clinic", "clinical", "health", "psychology", "psychiatry", "psychologist", "psychiatrist", "counselling", "counseling", "therapy", "services", "centre", "center", "doctor", "dr"]);
    const brandTokens = ownershipNames.flatMap((name) => normaliseComparable(name).split(" "))
      .filter((token) => token.length >= 4 && !ignored.has(token));
    const brandDomainMatch = brandTokens.some((token) => hostComparable.includes(token));
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pageEmailDomainMatch = new RegExp(`@[a-z0-9.-]*${escapedHost}\\b`, "i").test(String(pageText || ""));
    if (!brandDomainMatch && !pageEmailDomainMatch) return "unknown";
  }
  return provider.clinicianName && practiceMatched
    ? "clinic_owned"
    : "provider_owned";
}

export function evidenceItem({
  field,
  value,
  sourceUrl,
  sourceType,
  excerpt,
  capturedAt,
  confidence = "low",
  extractor = "manual",
  needsManualReview = true,
  subjectType = "provider",
  subjectId = "",
  subjectName = "",
  pageHash = "",
  expiresAt = "",
  conflicts = [],
  extractorVersion = ""
}) {
  return {
    field,
    value: value ?? "",
    sourceUrl: sourceUrl || "",
    sourceType: sourceType || sourceTypeFromUrl(sourceUrl),
    excerpt: compact(excerpt, 700),
    capturedAt: capturedAt || new Date().toISOString(),
    confidence,
    extractor,
    extractorVersion: extractorVersion || extractor,
    needsManualReview: needsManualReview !== false,
    subjectType,
    subjectId,
    subjectName,
    pageHash,
    expiresAt,
    conflicts: Array.isArray(conflicts) ? conflicts : []
  };
}

export function confidenceFromTrust(score) {
  if (score >= 0.82) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

export function scoreEvidence(item = {}) {
  const base = sourceTrust[item.sourceType] ?? sourceTrust.unknown;
  const hasExcerpt = item.excerpt ? 0.1 : -0.1;
  const manualPenalty = item.needsManualReview ? -0.05 : 0;
  const fieldPenalty = /availabilityStatus|referralType|tags|specialties|advertisedSpecialties/i.test(item.field || "") ? -0.08 : 0;
  const linkedInPenalty = item.sourceType === "linkedIn_public" && /availability|specialt|tags|referral/i.test(item.field || "") ? -0.3 : 0;
  const placesClinicalPenalty = item.sourceType === "google_places" && /type|availability|specialt|tags|referral|needScope|services|patientGroups|ageGroups|cost|telehealth/i.test(item.field || "") ? -0.25 : 0;
  const searchPenalty = item.sourceType === "search_result" ? -0.25 : 0;
  return Math.max(0, Math.min(1, base + hasExcerpt + manualPenalty + fieldPenalty + linkedInPenalty + placesClinicalPenalty + searchPenalty));
}

export function confidenceByField(claims = []) {
  const grouped = new Map();
  for (const claim of claims) {
    if (!claim.field) continue;
    const bucket = grouped.get(claim.field) || [];
    bucket.push(claim);
    grouped.set(claim.field, bucket);
  }

  const output = {};
  for (const [field, items] of grouped.entries()) {
    const values = unique(items.map((item) => String(item.value || "").trim()).filter(Boolean));
    const sources = unique(items.map((item) => item.sourceUrl).filter(Boolean));
    const bestScore = Math.max(...items.map(scoreEvidence));
    const corroborationBoost = values.length === 1 && sources.length > 1 ? 0.12 : 0;
    const conflictPenalty = values.length > 1 ? 0.25 : 0;
    const score = Math.max(0, Math.min(1, bestScore + corroborationBoost - conflictPenalty));
    output[field] = {
      confidence: confidenceFromTrust(score),
      score: Number(score.toFixed(2)),
      values,
      sources,
      conflicts: values.length > 1 ? values : []
    };
  }
  return output;
}

export function sourceEvidenceShape(claims = []) {
  const evidence = {
    contact: [],
    address: [],
    availability: [],
    referral: [],
    scope: [],
    tags: {},
    telehealth: [],
    cultural: [],
    cost: [],
    identity: []
  };

  for (const claim of claims) {
    if (["phone", "text", "email", "website", "bookingUrl"].includes(claim.field)) evidence.contact.push(claim);
    else if (["address", "city", "region", "lat", "lon"].includes(claim.field)) evidence.address.push(claim);
    else if (/availability/i.test(claim.field)) evidence.availability.push(claim);
    else if (/referral/i.test(claim.field)) evidence.referral.push(claim);
    else if (["tags"].includes(claim.field)) {
      const key = String(claim.value || "unknown");
      evidence.tags[key] = evidence.tags[key] || [];
      evidence.tags[key].push(claim);
      if (["maori", "pasifika", "asian", "rainbow"].includes(key)) evidence.cultural.push(claim);
      if (["telehealth", "online"].includes(key)) evidence.telehealth.push(claim);
    } else if (["cost", "funding"].includes(claim.field)) evidence.cost.push(claim);
    else if (["clinicianName", "practiceName", "name", "type"].includes(claim.field)) evidence.identity.push(claim);
    else evidence.scope.push(claim);
  }

  return evidence;
}

export function identitySignalsFromClaims(claims = []) {
  const valuesFor = (field) => unique(claims.filter((claim) => claim.field === field).map((claim) => claim.value));
  return {
    clinicianNames: valuesFor("clinicianName"),
    practiceNames: valuesFor("practiceName"),
    names: valuesFor("name"),
    phones: valuesFor("phone"),
    emails: valuesFor("email"),
    websites: valuesFor("website").map(sourceDomain).filter(Boolean),
    addresses: valuesFor("address"),
    cities: valuesFor("city"),
    regions: valuesFor("region")
  };
}

export function identityKeyFromSignals(signals = {}) {
  const domain = signals.websites?.[0];
  const clinician = signals.clinicianNames?.[0];
  if (clinician && domain) return `clinician-domain:${slugify(clinician)}:${domain}`;
  const email = signals.emails?.[0];
  const emailDomainValue = emailDomain(email);
  if (clinician && emailDomainValue) return `clinician-email-domain:${slugify(clinician)}:${emailDomainValue}`;
  const phone = signals.phones?.[0];
  if (clinician && phone) return `clinician-phone:${slugify(clinician)}:${normaliseComparable(phone)}`;
  const practice = signals.practiceNames?.[0] || signals.names?.[0];
  if (clinician && practice) return `clinician-practice:${slugify(clinician)}:${slugify(practice)}`;
  const city = signals.cities?.[0] || signals.regions?.[0] || "unknown";
  if (clinician) return `clinician-city:${slugify(clinician)}:${slugify(city)}`;
  if (email) return `email:${email.toLowerCase()}`;
  if (phone) return `phone:${normaliseComparable(phone)}`;
  if (practice && domain) return `practice-domain:${slugify(practice)}:${domain}`;
  if (practice) return `practice-city:${slugify(practice)}:${slugify(city)}`;
  return `candidate:${hashText(JSON.stringify(signals)).slice(0, 16)}`;
}

function inferredClinicianName(name = "", type = "") {
  if (!["psychiatrist", "psychologist"].includes(type)) return "";
  const firstPart = String(name || "").split(/,|\s+-\s+/)[0].trim();
  if (/^(dr|prof|associate professor|mr|mrs|ms|miss)\b/i.test(firstPart)) return firstPart;
  if (!/\b(clinic|centre|center|service|services|group|trust|health|psychology|psychiatry|therapy|counselling|counseling|medical|programme|program)\b/i.test(firstPart)
    && /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,4}$/.test(firstPart)) return firstPart;
  return "";
}

function isSharedProfessionalDirectoryDomain(domain = "") {
  return [
    "yourhealthinmind.org",
    "healthpoint.co.nz",
    "nzccp.co.nz",
    "psychologytoday.com",
    "talkingworks.co.nz",
    "talkingpoint.co.nz"
  ].includes(String(domain || "").replace(/^www\./, ""));
}

export function likelySameProvider(existing = {}, signals = {}) {
  const existingDomain = sourceDomain(existing.website || existing.source || "");
  const signalDomains = new Set(signals.websites || []);
  const existingEmailDomain = emailDomain(existing.email);
  const signalEmailDomains = new Set((signals.emails || []).map(emailDomain).filter(Boolean));
  const existingPhone = normaliseComparable(existing.phone || "");
  const existingName = normaliseComparable(existing.name || "");
  const existingClinician = normaliseComparable(existing.clinicianName || inferredClinicianName(existing.name, existing.type));
  const signalNames = [
    ...(signals.names || []),
    ...(signals.clinicianNames || []),
    ...(signals.practiceNames || [])
  ].map(normaliseComparable);
  const signalClinicians = (signals.clinicianNames || []).map(normaliseComparable).filter(Boolean);

  if (existingClinician && signalClinicians.length && !signalClinicians.includes(existingClinician)) return false;

  if (existing.phone && signalNames.length && (signals.phones || []).some((phone) => normaliseComparable(phone) === existingPhone)) return true;
  if (existing.email && (signals.emails || []).some((email) => email.toLowerCase() === existing.email.toLowerCase())) return true;
  if (existingDomain && signalDomains.has(existingDomain)) {
    if (signalNames.includes(existingClinician) || signalNames.includes(existingName)) return true;
    if (!isSharedProfessionalDirectoryDomain(existingDomain) && !existingClinician && !existingName) return true;
  }
  if (existingEmailDomain && signalEmailDomains.has(existingEmailDomain) && signalNames.some((name) => name && (name === existingName || name === existingClinician))) return true;
  return false;
}

export function detectConflicts(confidence = {}) {
  return Object.entries(confidence)
    .filter(([, value]) => Array.isArray(value.conflicts) && value.conflicts.length > 1)
    .map(([field, value]) => ({ field, values: value.conflicts }));
}

export function sourceTypeLabel(type) {
  return {
    provider_owned: "provider-owned page",
    clinic_owned: "clinic-owned page",
    healthpoint: "Healthpoint",
    official_register: "official register",
    professional_directory: "professional directory",
    ngo_directory: "NGO/health directory",
    google_places: "Google Places business listing",
    linkedIn_public: "public LinkedIn signal",
    search_result: "search result snippet",
    third_party_directory: "third-party directory",
    unknown: "unknown source"
  }[type] || type || "unknown source";
}

export const fieldRisk = {
  name: "low",
  clinicianName: "low",
  practiceName: "low",
  website: "low",
  phone: "low",
  text: "medium",
  email: "medium",
  bookingUrl: "medium",
  address: "low",
  city: "low",
  region: "low",
  lat: "low",
  lon: "low",
  coordinateSource: "low",
  coordinateConfidence: "low",
  type: "high",
  availabilityStatus: "high",
  availabilityEvidence: "high",
  referralType: "high",
  requiresReferral: "high",
  tags: "high",
  needScope: "high",
  specialties: "high",
  advertisedSpecialties: "high",
  patientGroups: "high",
  ageGroups: "high",
  onlineAvailable: "high",
  phoneSupport: "medium",
  inPerson: "medium",
  crisisOnly: "high",
  cost: "high",
  fit: "medium",
  firstStep: "medium"
};

export function riskLevelForField(field) {
  return fieldRisk[field] || "medium";
}

export function sourceOwnerTypeFromQuality(sourceQuality = "", sourceUrl = "") {
  const text = String(sourceQuality || "").toLowerCase();
  const sourceType = sourceTypeFromUrl(sourceUrl);
  if (/provider[- ]owned/.test(text)) return "provider_owned";
  if (/clinic[- ]owned|practice[- ]owned/.test(text)) return "clinic_owned";
  if (/healthpoint/.test(text)) return "healthpoint";
  if (/official|government|health nz|health agency/.test(text)) return "official";
  if (/professional register|professional directory|directory/.test(text)) return "professional_directory";
  if (/third-party|third party/.test(text)) return "third_party_directory";
  if (sourceType === "provider_owned") return "provider_owned";
  return sourceType || "unknown";
}
