import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stripInternalProviderFields } from "./provider-canonical.mjs";
import {
  broadNeedTags
} from "./provider-validation-policy.mjs";
import { normaliseComparable, sourceTrust, unique } from "./provider-evidence-scorer.mjs";

const directTypes = new Set(["gp", "counsellor", "psychologist", "psychiatrist", "mens-centre", "addiction", "youth", "public-service"]);

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function materialProvider(provider = {}) {
  if (!provider) return null;
  const copy = structuredClone(provider);
  delete copy.verificationStatus;
  delete copy.lastAutomatedCheck;
  delete copy.validationRunId;
  delete copy.validationEvidenceCoverage;
  return copy;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function acceptedEvidenceClaims(decision = {}, field = "") {
  return (decision.evaluatedClaims || [])
    .filter((claim) => claim.policy?.accepted)
    .filter((claim) => !field || claim.field === field);
}

function bestEvidenceClaim(decision = {}) {
  const fieldPriority = new Set(["clinicianName", "name", "practiceName", "type", "registration", "phone", "email", "website"]);
  return [...acceptedEvidenceClaims(decision)].sort((a, b) => (
    Number(fieldPriority.has(b.field)) - Number(fieldPriority.has(a.field))
    || (sourceTrust[b.sourceType] || 0) - (sourceTrust[a.sourceType] || 0)
    || String(b.capturedAt || "").localeCompare(String(a.capturedAt || ""))
  ))[0];
}

function checkedDates(decision = {}) {
  const date = new Date(decision.lastCheckedAt || Date.now());
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function safeFirstStep(provider = {}) {
  if (provider.type === "psychiatrist" && provider.requiresReferral) {
    return "Ask your GP or usual clinician about a referral, then confirm the clinic's current requirements.";
  }
  if (provider.email) return "Email the provider to ask about fit, fees, and current availability.";
  if (provider.phone) return "Call the provider to ask about fit, fees, and current availability.";
  if (provider.text) return "Text the service to ask about fit and current availability.";
  if (provider.website) return provider.type === "directory"
    ? "Open the directory to look for a suitable provider."
    : "Open the provider's website to check its current contact or booking options.";
  return "Confirm current contact details before relying on this record.";
}

function addressSupportsStoredCoordinates(provider = {}, approvedAddress = "") {
  const current = normaliseComparable(provider.address);
  const approved = normaliseComparable(approvedAddress);
  const sameAddress = current && approved && (current === approved || current.includes(approved) || approved.includes(current));
  return Boolean(sameAddress
    && Number.isFinite(Number(provider.lat))
    && Number.isFinite(Number(provider.lon))
    && provider.coordinateConfidence === "high"
    && provider.geocodeNeedsManualReview === false);
}

function applyFieldLevelDecisions(provider, decision) {
  const output = stripInternalProviderFields(provider);
  const approved = decision.approvedClaims || {};
  const dates = checkedDates(decision);

  for (const field of [
    "specialties",
    "advertisedSpecialties",
    "advertisedSpecialtyEvidence",
    "patientGroups",
    "ageGroups",
    "services",
    "needScope"
  ]) output[field] = [];
  for (const field of [
    "providerGender",
    "providerGenderEvidence",
    "providerGenderSource",
    "onlineAvailable",
    "phoneSupport",
    "inPerson",
    "appointmentWait",
    "eligibility"
  ]) delete output[field];
  if (!("practiceName" in approved)) delete output.practiceName;
  if (provider.clinicianName && !("clinicianName" in approved)) delete output.clinicianName;

  for (const [field, value] of Object.entries(approved)) {
    if (field === "tags") continue;
    output[field] = value;
  }

  const approvedTags = new Set(arrayValue(approved.tags));
  output.tags = unique([
    output.type,
    output.type === "directory" ? "directory" : "",
    output.crisisOnly === true ? "crisis" : "",
    ...approvedTags,
    approved.onlineAvailable === true ? "telehealth" : ""
  ]);
  output.needScope = unique([
    ...[...approvedTags].filter((tag) => broadNeedTags.has(tag)),
    ...([...approvedTags].some((tag) => ["sexual-harm", "sensitive-claims"].includes(tag)) ? ["trauma"] : []),
    ...([...approvedTags].some((tag) => ["alcohol", "drug", "gambling"].includes(tag)) ? ["addiction"] : []),
    ...([...approvedTags].some((tag) => ["rehabilitation", "return-to-work", "vocational"].includes(tag)) ? ["work"] : [])
  ]);

  const specialtyClaims = acceptedEvidenceClaims(decision, "advertisedSpecialties");
  output.advertisedSpecialties = arrayValue(approved.advertisedSpecialties);
  output.advertisedSpecialtyEvidence = specialtyClaims.map((claim) => ({
    specialty: claim.value,
    sourceUrl: claim.sourceUrl,
    excerpt: claim.excerpt,
    capturedAt: claim.capturedAt,
    confidence: claim.verification?.confidence || claim.confidence
  }));
  if (output.type === "psychiatrist") {
    output.specialtyTagsSource = specialtyClaims.length
      ? unique(specialtyClaims.map((claim) => claim.sourceUrl)).join("; ")
      : "No source-backed advertised specialties retained; baseline psychiatrist scope only.";
  } else if (!specialtyClaims.length) delete output.specialtyTagsSource;

  const genderClaim = acceptedEvidenceClaims(decision, "providerGender")[0];
  if (genderClaim) {
    output.providerGenderEvidence = genderClaim.excerpt;
    output.providerGenderSource = genderClaim.sourceUrl;
  }

  for (const field of ["phone", "text", "email", "website", "bookingUrl"]) {
    if (!(field in approved)) delete output[field];
  }
  if (!("address" in approved)) {
    delete output.address;
    delete output.lat;
    delete output.lon;
    delete output.coordinateSource;
    delete output.coordinatePrecision;
    delete output.coordinateConfidence;
    delete output.geocodeNeedsManualReview;
  } else if (!addressSupportsStoredCoordinates(provider, approved.address)) {
    delete output.lat;
    delete output.lon;
    delete output.coordinateSource;
    delete output.coordinatePrecision;
    delete output.coordinateConfidence;
    delete output.geocodeNeedsManualReview;
  }

  const availabilityClaim = acceptedEvidenceClaims(decision, "availabilityStatus")[0];
  if (!availabilityClaim) {
    output.availabilityStatus = "not_published";
    output.availabilityCheckedAt = dates.day;
    output.availabilityEvidence = "";
    output.availabilitySource = output.source || provider.source || provider.website;
    output.availabilityNeedsManualReview = true;
  } else {
    output.availabilityStatus = availabilityClaim.value;
    output.availabilityCheckedAt = String(availabilityClaim.capturedAt || dates.day).slice(0, 10);
    output.availabilityEvidence = availabilityClaim.excerpt;
    output.availabilitySource = availabilityClaim.sourceUrl;
    output.availabilityNeedsManualReview = false;
  }

  if (output.type === "psychiatrist") {
    if (approved.referralType === "self") {
      output.referralType = "self";
      output.requiresReferral = false;
    } else if (["gp", "specialist"].includes(output.referralType)) {
      // Existing conservative referral guidance is retained until stronger
      // provider-owned evidence proves that direct self-referral is allowed.
      output.requiresReferral = true;
    } else {
      output.referralType = approved.referralType || "unknown";
      output.requiresReferral = output.referralType === "gp" || output.referralType === "specialist";
    }
    const referralClaim = acceptedEvidenceClaims(decision, "referralType")[0];
    if (referralClaim) {
      output.referralSourceUrl = referralClaim.sourceUrl;
      output.referralSourceExcerpt = referralClaim.excerpt;
      output.referralConfidence = referralClaim.verification?.confidence || referralClaim.confidence;
      output.referralLastChecked = String(referralClaim.capturedAt || dates.day).slice(0, 10);
      output.referralNeedsManualReview = false;
    } else {
      output.referralNeedsManualReview = true;
    }
  }

  const sourceClaim = bestEvidenceClaim(decision);
  if (sourceClaim?.sourceUrl) output.source = sourceClaim.sourceUrl;
  if (!availabilityClaim) output.availabilitySource = output.source || provider.source || provider.website;
  output.sourceQuality = sourceClaim?.sourceType || "automated_public_evidence";
  output.confidence = decision.status === "verified" ? "high" : "medium";
  output.verified = dates.month;
  output.lastVerified = dates.month;
  output.cost = approved.cost || "Ask the provider about current fees and funding options.";
  output.hours = "Check with provider";
  output.fit = "Contact this provider to ask whether their service fits what you need and to confirm current availability.";
  output.firstStep = safeFirstStep(output);

  output.verificationStatus = decision.status;
  output.lastAutomatedCheck = decision.lastCheckedAt || "";
  output.validationRunId = decision.lastRunId || "";
  output.validationEvidenceCoverage = decision.evidenceSummary || { total: 0, accepted: 0, rejected: 0 };
  output.needsManualVerification = decision.status !== "verified";
  return output;
}

function coverageSummary(providers, requiredRegions = []) {
  const regions = unique([...requiredRegions, ...providers.map((provider) => provider.region).filter(Boolean)]).sort();
  const national = providers.filter((provider) => /national|online across new zealand/i.test(`${provider.region || ""} ${(provider.tags || []).join(" ")}`));
  return regions.map((region) => {
    const local = providers.filter((provider) => provider.region === region && directTypes.has(provider.type));
    const directories = providers.filter((provider) => provider.region === region && provider.type === "directory");
    return {
      region,
      localDirectProviders: local.length,
      localTypes: unique(local.map((provider) => provider.type)).sort(),
      directoryFallbacks: directories.length,
      nationalFallbacks: national.length,
      deadEnd: local.length === 0 && directories.length === 0 && national.length === 0
    };
  });
}

function hasPublishableCore(provider = {}) {
  const identityAndLocation = Boolean(provider.name && provider.type && provider.region && provider.city);
  if (!identityAndLocation) return false;
  if (provider.type === "directory") return Boolean(provider.website);
  if (directTypes.has(provider.type)) return Boolean(provider.phone || provider.text || provider.email || provider.website);
  return true;
}

export function compilePublicProviderProjection(canonical, validationState = {}, options = {}) {
  const stateById = validationState.providers || validationState;
  const applyProviderIds = options.applyProviderIds ? new Set(options.applyProviderIds) : null;
  const hasPublicBaseline = Array.isArray(options.publicProviders);
  const publicById = new Map((options.publicProviders || []).map((provider) => [provider.id, provider]));
  const providers = [];
  const changes = [];
  const suppressions = [];

  for (const canonicalProvider of canonical.providers || []) {
    const previousPublic = publicById.has(canonicalProvider.id)
      ? structuredClone(publicById.get(canonicalProvider.id))
      : hasPublicBaseline
        ? null
        : stripInternalProviderFields(canonicalProvider);
    const decision = stateById[canonicalProvider.id] || canonicalProvider.validation;
    const selected = decision && (!applyProviderIds || applyProviderIds.has(canonicalProvider.id));
    if (selected && ["suppressed", "unverifiable"].includes(decision.status) && decision.legacySafeguardsActive === false) {
      if (previousPublic) {
        suppressions.push({
          providerId: canonicalProvider.id,
          providerName: canonicalProvider.name,
          reason: (decision.reasons || []).join(" "),
          oldProvider: previousPublic,
          newProvider: null
        });
      }
      continue;
    }

    const nextPublic = selected && decision.legacySafeguardsActive === false
      ? applyFieldLevelDecisions(canonicalProvider, decision)
      : previousPublic;
    if (!nextPublic) continue;
    if (selected && decision.legacySafeguardsActive === false && !hasPublishableCore(nextPublic)) {
      if (previousPublic) {
        suppressions.push({
          providerId: canonicalProvider.id,
          providerName: canonicalProvider.name,
          reason: "The autonomous projection did not retain a complete identity, location, and safe contact path.",
          oldProvider: previousPublic,
          newProvider: null
        });
      }
      continue;
    }
    providers.push(nextPublic);

    const materialChanged = !previousPublic
      || hash(materialProvider(previousPublic)) !== hash(materialProvider(nextPublic));
    if (materialChanged) {
      changes.push({
        providerId: canonicalProvider.id,
        providerName: canonicalProvider.name,
        oldProvider: previousPublic,
        newProvider: nextPublic,
        reason: (decision?.reasons || []).join(" "),
        evidenceClaimIds: decision?.approvedClaimIds || []
      });
    }
  }

  const total = Math.max(1, canonical.providers?.length || 0);
  const materiallyAffected = changes.length + suppressions.length;
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    runId: options.runId || validationState.runId || "",
    providers,
    changes,
    suppressions,
    summary: {
      canonicalProviders: canonical.providers?.length || 0,
      publicProviders: providers.length,
      materialChanges: changes.length,
      suppressions: suppressions.length,
      materiallyAffected,
      materiallyAffectedPercent: Number(((materiallyAffected / total) * 100).toFixed(3)),
      verificationStates: providers.reduce((counts, provider) => {
        const key = provider.verificationStatus || "legacy";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {})
    },
    coverage: coverageSummary(providers, (canonical.providers || []).map((provider) => provider.region).filter(Boolean))
  };
}

export function evaluatePublishGates({ projection, run = {}, rollout = {}, maxChangePercent = 2 } = {}) {
  const failures = [];
  if (!run.modelCredentialsPresent) failures.push("model-credentials-missing");
  if (!run.modelComplete) failures.push("model-validation-incomplete");
  if ((run.schemaErrors || 0) > 0) failures.push("structured-output-schema-errors");
  if ((run.unexplainedConflicts || 0) > 0) failures.push("unexplained-conflicts");
  if ((run.pageFanoutViolations || 0) > 0) failures.push("source-page-fanout-violation");
  if ((projection?.summary?.materiallyAffectedPercent || 0) > maxChangePercent) failures.push("provider-change-threshold-exceeded");
  if ((projection?.coverage || []).some((region) => region.deadEnd)) failures.push("regional-dead-end-created");
  if ((run.claimPrecision || 0) < 0.995) failures.push("claim-evaluation-precision-below-99.5-percent");
  if (rollout.stage === "shadow") failures.push("shadow-rollout-not-ready-for-publish");
  if ((rollout.cleanRunsAtStage || 0) < 3) failures.push("rollout-stage-needs-three-clean-runs");
  return { passed: failures.length === 0, failures };
}

export function appendProjectionChangeLog(filePath, projection, metadata = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const generatedAt = metadata.generatedAt || new Date().toISOString();
  const events = [...projection.changes, ...projection.suppressions].map((change) => ({
    eventId: `validation-event-${crypto.randomUUID()}`,
    runId: projection.runId,
    providerId: change.providerId,
    providerName: change.providerName,
    action: change.newProvider ? "update" : "suppress",
    reason: change.reason || "",
    evidenceClaimIds: change.evidenceClaimIds || [],
    oldProvider: change.oldProvider,
    newProvider: change.newProvider,
    rollback: change.oldProvider ? { restoreProvider: change.oldProvider } : { removeProvider: true },
    generatedAt,
    engineVersion: metadata.engineVersion || ""
  }));
  if (events.length) fs.appendFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return events;
}

export function writePublicProjection(filePath, projection) {
  fs.mkdirSync(path.dirname(filePath) || ".", { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(projection.providers, null, 2)}\n`);
}
