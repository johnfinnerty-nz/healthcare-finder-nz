import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normaliseComparable,
  slugify,
  sourceDomain,
  unique
} from "./provider-evidence-scorer.mjs";

export const CANONICAL_VERSION = 1;
export const VALIDATION_STATES = new Set(["verified", "limited", "suppressed", "unverifiable", "monitoring"]);
const clinicianTypes = new Set(["psychiatrist", "psychologist", "counsellor"]);
const sharedDirectoryDomains = new Set([
  "healthpoint.co.nz",
  "nzccp.co.nz",
  "psychologistsboard.org.nz",
  "psychologytoday.com",
  "talkingpoint.co.nz",
  "talkingworks.co.nz",
  "yourhealthinmind.org"
]);

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function personLikeName(value = "") {
  const text = String(value || "").trim();
  if (!text || /\b(clinic|centre|center|service|services|group|trust|health|psychology|psychiatry|therapy|counselling|medical|programme|program|directory)\b/i.test(text)) return "";
  return /^(?:Dr|Mr|Mrs|Ms|Miss|Mx|Prof(?:essor)?)?\s*[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,4}$/.test(text) ? text : "";
}

function practiceIdentity(provider = {}) {
  const name = provider.practiceName || (!personLikeName(provider.name) ? provider.name : "");
  if (!name) return null;
  const domain = sourceDomain(provider.website || provider.source || "");
  const safeDomain = domain && !sharedDirectoryDomains.has(domain) ? domain : "";
  const place = provider.address || `${provider.city || ""}|${provider.region || ""}`;
  const key = `${normaliseComparable(name)}|${safeDomain || normaliseComparable(place)}`;
  return {
    practiceId: `practice-${slugify(name).slice(0, 54) || "provider"}-${hash(key).slice(0, 10)}`,
    name,
    domain: safeDomain,
    key
  };
}

function clinicianIdentity(provider = {}) {
  const name = provider.clinicianName || (clinicianTypes.has(provider.type) ? personLikeName(provider.name) : "");
  if (!name) return null;
  // The provider ID remains part of the identity key so clinicians who share a
  // practice, phone, or email can never be collapsed by accident.
  return {
    clinicianId: `clinician-${slugify(name).slice(0, 54) || "provider"}-${hash(`${provider.id}|${normaliseComparable(name)}`).slice(0, 10)}`,
    name
  };
}

function contactSnapshot(provider = {}) {
  return {
    address: provider.address || "",
    city: provider.city || "",
    region: provider.region || "",
    lat: provider.lat ?? null,
    lon: provider.lon ?? null,
    phone: provider.phone || "",
    text: provider.text || "",
    email: provider.email || "",
    website: provider.website || "",
    bookingUrl: provider.bookingUrl || ""
  };
}

export function defaultProviderValidation(provider = {}, previous = {}) {
  const status = VALIDATION_STATES.has(previous.status) ? previous.status : "monitoring";
  return {
    providerId: provider.id,
    status,
    fetchOutcome: previous.fetchOutcome || "not_checked",
    lastRunId: previous.lastRunId || "",
    lastCheckedAt: previous.lastCheckedAt || "",
    firstUnreachableAt: previous.firstUnreachableAt || "",
    consecutiveFetchFailures: Number(previous.consecutiveFetchFailures || 0),
    approvedClaims: previous.approvedClaims || {},
    rejectedClaims: previous.rejectedClaims || {},
    conflicts: previous.conflicts || [],
    observations: previous.observations || [],
    reasons: previous.reasons || ["Awaiting first autonomous validation pass."],
    legacySafeguardsActive: previous.legacySafeguardsActive !== false,
    lastPublicProjectionHash: previous.lastPublicProjectionHash || ""
  };
}

export function buildCanonicalProviderDataset(publicProviders = [], options = {}) {
  const previousState = options.previousState?.providers || options.previousState || {};
  const practices = new Map();
  const clinicians = [];
  const providers = [];

  for (const original of publicProviders) {
    if (!original?.id) continue;
    const provider = structuredClone(original);
    const practice = practiceIdentity(provider);
    const clinician = clinicianIdentity(provider);

    if (practice) {
      const current = practices.get(practice.practiceId) || {
        practiceId: practice.practiceId,
        name: practice.name,
        domain: practice.domain,
        providerIds: [],
        contactCandidates: [],
        inheritancePolicy: "Contact fields may be inherited only with explicit practice-wide evidence. Clinical scope, clinician gender, availability, and specialties never inherit automatically."
      };
      current.providerIds.push(provider.id);
      current.contactCandidates.push({
        providerId: provider.id,
        ...contactSnapshot(provider),
        sourceUrl: provider.source || provider.website || ""
      });
      practices.set(practice.practiceId, current);
    }

    if (clinician) {
      clinicians.push({
        clinicianId: clinician.clinicianId,
        providerId: provider.id,
        practiceId: practice?.practiceId || "",
        name: clinician.name,
        type: provider.type || "",
        sourceUrls: unique([provider.website, provider.source])
      });
    }

    provider._canonical = {
      clinicianId: clinician?.clinicianId || "",
      practiceId: practice?.practiceId || "",
      importedFromPublicAt: options.generatedAt || new Date().toISOString()
    };
    provider.validation = defaultProviderValidation(provider, previousState[provider.id] || {});
    providers.push(provider);
  }

  const generatedAt = options.generatedAt || new Date().toISOString();
  const sourceSnapshotHash = hash(JSON.stringify(publicProviders));
  return {
    version: CANONICAL_VERSION,
    generatedAt,
    source: options.source || "providers.json migration",
    sourceSnapshotHash,
    providerCount: providers.length,
    practiceCount: practices.size,
    clinicianCount: clinicians.length,
    practices: [...practices.values()].map((practice) => ({
      ...practice,
      providerIds: unique(practice.providerIds),
      contactCandidates: practice.contactCandidates
    })),
    clinicians,
    providers
  };
}

export function refreshCanonicalProviderDataset(existingCanonical = {}, publicProviders = [], options = {}) {
  const publicById = new Map(publicProviders.filter((provider) => provider?.id).map((provider) => [provider.id, provider]));
  const combined = [];
  const seen = new Set();

  for (const existing of existingCanonical.providers || []) {
    if (!existing?.id) continue;
    const currentPublic = publicById.get(existing.id);
    const retained = structuredClone(existing);
    if (currentPublic) {
      for (const [field, value] of Object.entries(currentPublic)) {
        if (!(field in retained)) retained[field] = structuredClone(value);
      }
    }
    combined.push(retained);
    seen.add(existing.id);
  }

  for (const provider of publicProviders) {
    if (!provider?.id || seen.has(provider.id)) continue;
    combined.push(structuredClone(provider));
    seen.add(provider.id);
  }

  const externalState = options.previousState?.providers || options.previousState || {};
  const previousState = {};
  for (const provider of existingCanonical.providers || []) {
    if (provider?.id && provider.validation) previousState[provider.id] = provider.validation;
  }
  Object.assign(previousState, externalState);

  return buildCanonicalProviderDataset(combined, {
    ...options,
    previousState,
    source: options.source || existingCanonical.source || "canonical refresh"
  });
}

export function readCanonicalDataset(filePath, fallbackProvidersPath = "providers.json") {
  if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  const publicProviders = JSON.parse(fs.readFileSync(fallbackProvidersPath, "utf8"));
  return buildCanonicalProviderDataset(publicProviders);
}

export function writeCanonicalDataset(filePath, canonical) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(canonical, null, 2)}\n`);
}

export function stripInternalProviderFields(provider = {}) {
  const output = {};
  for (const [key, value] of Object.entries(provider)) {
    if (key.startsWith("_") || key === "validation" || key === "sourceEvidence" || key === "confidenceByField") continue;
    output[key] = value;
  }
  return output;
}
