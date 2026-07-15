import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyReviewDecisions } from "../tools/apply-provider-review-decisions.mjs";
import { buildProviderEvidenceGraph } from "../tools/build-provider-evidence-graph.mjs";
import { buildClaimBatchDecisionDraft } from "../tools/draft-claim-batch-review-decisions.mjs";
import { buildProviderAutoResolutionProposals } from "../tools/export-provider-auto-resolution-proposals.mjs";
import { buildProviderClaimReviewQueue } from "../tools/export-provider-claim-review-queue.mjs";
import { buildSourceFitEvidenceCapture } from "../tools/export-source-fit-evidence-capture.mjs";
import { buildSourceFitCaptureDecisionDraft } from "../tools/draft-source-fit-capture-decisions.mjs";
import { buildGpCorroborationDecisionDraft } from "../tools/draft-gp-corroboration-decisions.mjs";
import { buildLocationDistanceDecisionDraft } from "../tools/draft-location-distance-decisions.mjs";
import { buildGpSourceCorroborationQueue } from "../tools/export-gp-source-corroboration-queue.mjs";
import {
  buildGpCorroborationReviewPack,
  enrichGpCorroborationReviewPackWithSourceExcerpts
} from "../tools/export-gp-corroboration-review-pack.mjs";
import { buildLocationDistanceReviewPack } from "../tools/export-location-distance-review-pack.mjs";
import { buildRegionalDataQualityReport } from "../tools/export-regional-data-quality-report.mjs";
import { detectProviderConflicts } from "../tools/detect-provider-conflicts.mjs";
import { buildProviderMonitorQueue } from "../tools/export-provider-monitor-queue.mjs";
import { buildProviderReviewQueue } from "../tools/export-provider-review-queue.mjs";
import {
  buildAiReviewTask,
  normaliseAiReviewProposal
} from "../tools/ai-review-provider-queue.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "provider-review-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function baseProvider(overrides = {}) {
  return {
    id: "provider-base",
    name: "Base Provider",
    type: "psychologist",
    region: "Auckland",
    city: "Auckland",
    address: "1 Queen Street, Auckland",
    lat: -36.8485,
    lon: 174.7633,
    phone: "09 123 4567",
    text: "",
    email: "hello@example.org",
    website: "https://example.org",
    bookingUrl: "",
    source: "https://example.org/source",
    sourceQuality: "provider-owned public page",
    confidence: "medium",
    needsManualVerification: true,
    verified: "2026-05",
    lastVerified: "2026-05",
    availabilityStatus: "not_published",
    availabilityCheckedAt: "2026-05",
    availabilityEvidence: "",
    availabilitySource: "https://example.org/source",
    availabilityNeedsManualReview: true,
    tags: ["psychologist", "depression"],
    needScope: [],
    specialties: [],
    services: [],
    patientGroups: [],
    ageGroups: [],
    fit: "Provider offering mental health care.",
    firstStep: "Email the provider to ask about availability.",
    cost: "Ask about fees.",
    hours: "Ask about hours.",
    ...overrides
  };
}

function buildQueueFixture(providers, reports = {}) {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFit = path.join(dir, "source-fit.json");
  const availability = path.join(dir, "availability.json");
  const referrals = path.join(dir, "referrals.json");
  const watchlist = path.join(dir, "watchlist.json");
  writeJson(providersPath, providers);
  writeJson(sourceFit, { findings: reports.sourceFit || [] });
  writeJson(availability, { findings: reports.availability || [] });
  writeJson(referrals, { findings: reports.referrals || [] });
  writeJson(watchlist, reports.watchlist || { version: 1, items: [] });
  return buildProviderReviewQueue({
    providers: providersPath,
    sourceFitAudit: sourceFit,
    availabilityAudit: availability,
    referralAudit: referrals,
    watchlist,
    linkResults: path.join(dir, "missing-link-report.json"),
    identityScan: path.join(dir, "missing-identity-scan.json"),
    discoveryQueue: path.join(dir, "missing-discovery.json"),
    providerSuggestions: path.join(dir, "missing-provider-suggestions.json"),
    googlePlacesCandidates: path.join(dir, "missing-google-places.json"),
    skipAuditRun: true
  });
}

test("AI review tasks are evidence-bound and include controlled decision rules", () => {
  const provider = baseProvider({ id: "ai-task-provider", name: "AI Task Provider" });
  const queue = buildQueueFixture([provider], {
    sourceFit: [
      {
        providerId: provider.id,
        providerName: provider.name,
        rule: "unsupported-broad-tag",
        severity: "medium",
        issue: "Depression tag needs source evidence.",
        suggestedFix: "Remove unsupported broad tag unless source evidence supports it.",
        source: provider.source
      }
    ]
  });

  const task = buildAiReviewTask(queue.items[0]);
  assert.equal(task.currentPublicRecord.providerId, provider.id);
  assert.ok(task.allowedCorrectedFields.includes("phone"));
  assert.ok(task.decisionRules.some((rule) => /needs_more_info/i.test(rule)));
  assert.ok(task.decisionRules.some((rule) => /Do not clear needsManualVerification/i.test(rule)));
  assert.deepEqual(task.fieldsThatAffectRanking.tags, provider.tags);
});

test("AI review normalisation strips unsafe fields and keeps a guarded audit trail", () => {
  const provider = baseProvider({ id: "ai-normalise-provider", name: "AI Normalise Provider" });
  const item = buildQueueFixture([provider], {
    sourceFit: [
      {
        providerId: provider.id,
        providerName: provider.name,
        rule: "weak-contact-source",
        severity: "medium",
        issue: "Phone needs stronger source support.",
        suggestedFix: "Confirm public contact source.",
        source: provider.source
      }
    ]
  }).items[0];

  const decision = normaliseAiReviewProposal(item, {
    action: "adjust",
    confidence: "high",
    correctedFields: {
      phone: "09 999 0000",
      needsManualVerification: false,
      unsafeField: "must not pass"
    },
    sourceUrl: provider.source,
    sourceExcerpt: "The provider-owned contact page lists phone 09 999 0000.",
    auditRulesResolved: ["weak-contact-source"],
    reviewNotes: "Phone can be updated from the provider-owned contact page."
  });

  assert.equal(decision.action, "adjust");
  assert.deepEqual(decision.correctedFields, { phone: "09 999 0000" });
  assert.equal(decision.requiresHumanApproval, true);
  assert.ok(decision.aiReview.guardrailsApplied.some((item) => /unsafeField/.test(item)));
  assert.ok(decision.aiReview.guardrailsApplied.some((item) => /needsManualVerification/.test(item)));
});

test("AI review drafts cannot be applied unless explicitly allowed", () => {
  const provider = baseProvider({ id: "ai-apply-provider", name: "AI Apply Provider", phone: "09 111 1111" });
  const item = buildQueueFixture([provider], {
    sourceFit: [
      {
        providerId: provider.id,
        providerName: provider.name,
        rule: "weak-contact-source",
        severity: "medium",
        issue: "Phone needs stronger source support.",
        suggestedFix: "Confirm public contact source.",
        source: provider.source
      }
    ]
  }).items[0];
  const decision = normaliseAiReviewProposal(item, {
    action: "adjust",
    confidence: "high",
    correctedFields: { phone: "09 222 2222" },
    sourceUrl: provider.source,
    sourceExcerpt: "The provider-owned contact page lists phone 09 222 2222.",
    reviewNotes: "Phone can be updated."
  });

  const blocked = applyReviewDecisions({
    providers: [provider],
    decisions: { decisions: [decision] }
  });
  assert.equal(blocked.errors.length, 1);
  assert.match(blocked.errors[0].error, /AI review decisions are draft proposals/);
  assert.equal(blocked.providers[0].phone, "09 111 1111");

  const allowed = applyReviewDecisions({
    providers: [provider],
    decisions: { decisions: [decision] },
    allowAiReviewDecisions: true
  });
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.providers[0].phone, "09 222 2222");
});

test("AI review normalisation will not infer accepting availability from silence", () => {
  const provider = baseProvider({ id: "ai-availability-provider", name: "AI Availability Provider" });
  const item = buildQueueFixture([provider], {
    availability: [
      {
        providerId: provider.id,
        providerName: provider.name,
        rule: "availability-needs-review",
        severity: "medium",
        issue: "Availability needs manual review.",
        source: provider.source
      }
    ]
  }).items[0];

  const decision = normaliseAiReviewProposal(item, {
    action: "adjust",
    confidence: "medium",
    correctedFields: { availabilityStatus: "accepting" },
    sourceUrl: provider.source,
    sourceExcerpt: "The provider page lists a phone number and email address.",
    reviewNotes: "Contact details are present."
  });

  assert.equal(decision.action, "needs_more_info");
  assert.equal("availabilityStatus" in decision.correctedFields, false);
  assert.ok(decision.aiReview.guardrailsApplied.some((item) => /accepting availability/.test(item)));
});

test("export queue includes high source-fit findings and sorts high risk first", () => {
  const critical = baseProvider({ id: "critical-provider", name: "Critical Provider" });
  const lower = baseProvider({ id: "lower-provider", name: "Lower Provider", confidence: "high", needsManualVerification: false });
  const queue = buildQueueFixture([lower, critical], {
    sourceFit: [
      {
        providerId: "critical-provider",
        providerName: "Critical Provider",
        rule: "directory-treated-direct",
        severity: "high",
        issue: "Directory is treated as direct.",
        suggestedFix: "Remove direct-contact signals.",
        source: "https://example.org/source"
      },
      {
        providerId: "lower-provider",
        providerName: "Lower Provider",
        rule: "weak-telehealth-evidence",
        severity: "medium",
        issue: "Telehealth is weak.",
        suggestedFix: "Verify telehealth.",
        source: "https://example.org/source"
      }
    ]
  });

  assert.equal(queue.items[0].providerId, "critical-provider");
  assert.equal(queue.items[0].auditSeverity, "high");
  assert.ok(queue.items[0].auditRules.includes("directory-treated-direct"));
  assert.equal(queue.items[0].reviewCategory, "Directory/direct-contact confusion");
  assert.equal(queue.summary.byCategory["Directory/direct-contact confusion"], 1);
});

test("export queue includes availability risk, referral review, address concerns, broad tags, cultural tags, and telehealth claims", () => {
  const availabilityRisk = baseProvider({ id: "availability-risk", availabilityStatus: "accepting", availabilityEvidence: "" });
  const psychiatrist = baseProvider({
    id: "psychiatrist-review",
    type: "psychiatrist",
    referralType: "unknown",
    requiresReferral: false,
    referralSourceUrl: "https://example.org/referral",
    referralSourceExcerpt: "Referral pathway not published.",
    referralConfidence: "low",
    referralLastChecked: "2026-05",
    referralNeedsManualReview: true
  });
  const missingCoords = baseProvider({ id: "missing-coords", lat: "", lon: "" });
  const tagged = baseProvider({ id: "tagged-risk", tags: ["psychologist", "depression", "maori", "telehealth"] });

  const queue = buildQueueFixture([availabilityRisk, psychiatrist, missingCoords, tagged], {
    availability: [
      {
        providerId: "availability-risk",
        providerName: "Availability Risk",
        rule: "accepting-without-explicit-evidence",
        severity: "high",
        issue: "Accepting without evidence.",
        suggestedAction: "Add evidence.",
        source: "https://example.org"
      }
    ],
    referrals: [
      {
        providerId: "psychiatrist-review",
        name: "Psychiatrist Review",
        rule: "unknown-without-review",
        severity: "medium",
        issue: "Referral is unknown.",
        suggestedAction: "Review source.",
        sourceUrl: "https://example.org/referral"
      }
    ],
    sourceFit: [
      {
        providerId: "tagged-risk",
        providerName: "Tagged Risk",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag needs evidence.",
        suggestedFix: "Verify tag.",
        source: "https://example.org"
      },
      {
        providerId: "tagged-risk",
        providerName: "Tagged Risk",
        rule: "weak-maori-evidence",
        severity: "medium",
        issue: "Maori support tag needs evidence.",
        suggestedFix: "Verify cultural evidence.",
        source: "https://example.org"
      },
      {
        providerId: "tagged-risk",
        providerName: "Tagged Risk",
        rule: "weak-telehealth-evidence",
        severity: "medium",
        issue: "Telehealth needs evidence.",
        suggestedFix: "Verify telehealth.",
        source: "https://example.org"
      }
    ]
  });

  const ids = queue.items.map((item) => item.providerId);
  assert.ok(ids.includes("availability-risk"));
  assert.ok(ids.includes("psychiatrist-review"));
  assert.ok(ids.includes("missing-coords"));
  assert.ok(ids.includes("tagged-risk"));
  assert.ok(queue.items.find((item) => item.providerId === "tagged-risk").auditRules.includes("weak-maori-evidence"));
  assert.ok(queue.items.find((item) => item.providerId === "tagged-risk").auditRules.includes("weak-telehealth-evidence"));
  assert.equal(queue.items.find((item) => item.providerId === "availability-risk").reviewCategory, "Availability review");
  assert.equal(queue.items.find((item) => item.providerId === "psychiatrist-review").reviewCategory, "Referral pathway review");
  assert.equal(queue.items.find((item) => item.providerId === "missing-coords").reviewCategory, "Location and distance evidence");
  assert.equal(queue.items.find((item) => item.providerId === "tagged-risk").reviewCategory, "Sensitive tag or scope evidence");
});

test("focused export does not dump low-risk GP manual records by default", () => {
  const gp = baseProvider({ id: "gp-manual-only", type: "gp", name: "Manual GP", needsManualVerification: true, availabilityNeedsManualReview: true });
  const specialist = baseProvider({ id: "specialist-manual-only", type: "psychologist", name: "Manual Psychologist", needsManualVerification: true });
  const queue = buildQueueFixture([gp, specialist]);

  assert.equal(queue.items.some((item) => item.providerId === "gp-manual-only"), false);
  assert.equal(queue.items.some((item) => item.providerId === "specialist-manual-only"), true);
});

test("approve cannot invent evidence and accepting cannot be approved without explicit evidence", () => {
  const provider = baseProvider({ id: "approve-safety", availabilityStatus: "accepting", availabilityEvidence: "" });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "approve-safety",
          action: "approve",
          reviewer: "tester",
          reviewedDate: "2026-05-26",
          correctedFields: {}
        }
      ]
    }
  });

  assert.equal(result.applied.length, 0);
  assert.match(result.errors[0].error, /without source evidence|without explicit accepting/i);
});

test("psychiatrist referralType self cannot be applied without explicit source evidence", () => {
  const provider = baseProvider({
    id: "psych-self-unsafe",
    type: "psychiatrist",
    referralType: "unknown",
    requiresReferral: false,
    referralSourceUrl: "https://example.org",
    referralSourceExcerpt: "Referral pathway not published.",
    referralConfidence: "low",
    referralLastChecked: "2026-05",
    referralNeedsManualReview: true
  });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "psych-self-unsafe",
          action: "adjust",
          correctedFields: { referralType: "self" },
          sourceExcerpt: "Contact page.",
          reviewer: "tester",
          reviewedDate: "2026-05-26"
        }
      ]
    }
  });

  assert.equal(result.applied.length, 0);
  assert.match(result.errors[0].error, /self-referral/i);
});

test("adjust applies only allowed corrected fields and rejects unsafe fields", () => {
  const provider = baseProvider({ id: "field-safety" });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "field-safety",
          action: "adjust",
          correctedFields: { admin: true },
          sourceExcerpt: "Evidence",
          reviewer: "tester",
          reviewedDate: "2026-05-26"
        }
      ]
    }
  });

  assert.equal(result.applied.length, 0);
  assert.match(result.errors[0].error, /Unsafe correctedFields/);
});

test("adjust cannot add unsupported advertised specialties without evidence", () => {
  const provider = baseProvider({
    id: "advertised-specialty-safety",
    type: "psychiatrist",
    tags: [],
    advertisedSpecialties: [],
    advertisedSpecialtyEvidence: []
  });
  const rejected = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "advertised-specialty-safety",
          action: "adjust",
          correctedFields: { advertisedSpecialties: ["Depression"] },
          sourceExcerpt: "Profile says private psychiatrist.",
          reviewer: "tester",
          reviewedDate: "2026-05-26"
        }
      ]
    }
  });
  const accepted = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "advertised-specialty-safety",
          action: "adjust",
          correctedFields: {
            advertisedSpecialties: ["Depression"],
            advertisedSpecialtyEvidence: [{ sourceUrl: provider.source, excerpt: "Profile lists Depression as a special interest." }]
          },
          sourceExcerpt: "Profile lists Depression as a special interest.",
          reviewer: "tester",
          reviewedDate: "2026-05-26"
        }
      ]
    }
  });

  assert.equal(rejected.applied.length, 0);
  assert.match(rejected.errors[0].error, /advertised specialties/i);
  assert.equal(accepted.applied.length, 1);
  assert.deepEqual(accepted.providers[0].advertisedSpecialties, ["Depression"]);
});

test("reject removes provider safely and writes log event", () => {
  const provider = baseProvider({ id: "reject-me" });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: { decisions: [{ providerId: "reject-me", action: "reject", reviewer: "tester", reviewedDate: "2026-05-26", sourceExcerpt: "Bad record." }] }
  });

  assert.equal(result.providers.some((item) => item.id === "reject-me"), false);
  assert.equal(result.events[0].action, "reject");
  assert.equal(result.events[0].oldFields.id, "reject-me");
});

test("move_to_watchlist updates watchlist and removes provider from first recommendations", () => {
  const provider = baseProvider({ id: "watch-me", availabilityStatus: "not_accepting", availabilityEvidence: "Not accepting new clients." });
  const result = applyReviewDecisions({
    providers: [provider],
    watchlist: { version: 1, items: [] },
    decisions: { decisions: [{ providerId: "watch-me", action: "move_to_watchlist", reviewer: "tester", reviewedDate: "2026-05-26", sourceExcerpt: "Not accepting new clients." }] }
  });

  assert.equal(result.providers.some((item) => item.id === "watch-me"), false);
  assert.equal(result.watchlist.items.some((item) => item.id === "watch-me"), true);
  assert.equal(result.events[0].newFields.movedToWatchlist, "watch-me");
});

test("duplicate preserves kept-provider link in review log", () => {
  const duplicate = baseProvider({ id: "duplicate-provider" });
  const kept = baseProvider({ id: "kept-provider" });
  const result = applyReviewDecisions({
    providers: [duplicate, kept],
    decisions: { decisions: [{ providerId: "duplicate-provider", action: "duplicate", keptProviderId: "kept-provider", reviewer: "tester", reviewedDate: "2026-05-26" }] }
  });

  assert.equal(result.providers.some((item) => item.id === "duplicate-provider"), false);
  assert.equal(result.providers.some((item) => item.id === "kept-provider"), true);
  assert.equal(result.events[0].newFields.duplicateOf, "kept-provider");
});

test("needs_more_info leaves provider unchanged", () => {
  const provider = baseProvider({ id: "needs-more-info" });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: { decisions: [{ providerId: "needs-more-info", action: "needs_more_info", reviewer: "tester", reviewedDate: "2026-05-26" }] }
  });

  assert.deepEqual(result.providers, [provider]);
  assert.equal(result.events[0].action, "needs_more_info");
});

test("review log records old and new values for adjustments", () => {
  const provider = baseProvider({ id: "adjust-log", phone: "09 111 1111" });
  const result = applyReviewDecisions({
    providers: [provider],
    decisions: {
      decisions: [
        {
          providerId: "adjust-log",
          action: "adjust",
          correctedFields: { phone: "09 222 2222" },
          sourceExcerpt: "Phone 09 222 2222",
          reviewer: "tester",
          reviewedDate: "2026-05-26"
        }
      ]
    }
  });

  assert.equal(result.providers[0].phone, "09 222 2222");
  assert.equal(result.events[0].oldFields.phone, "09 111 1111");
  assert.equal(result.events[0].newFields.phone, "09 222 2222");
});

test("reviewed new provider import requires explicit candidate flag and human source evidence", () => {
  const correctedFields = {
    name: "Northland Psychiatry",
    practiceName: "Northland Psychiatry",
    type: "psychiatrist",
    region: "Northland",
    city: "Whangarei",
    address: "41 Whau Valley Road, Whangarei",
    phone: "09 553 3255",
    website: "https://www.northlandpsychiatry.co.nz/",
    source: "https://www.northlandpsychiatry.co.nz/",
    sourceQuality: "provider-owned page reviewed by auditor",
    confidence: "medium",
    tags: ["psychiatrist"],
    needScope: [],
    fit: "Private psychiatry practice in Whangarei. Ask about referral requirements, availability, fees, and whether this is the right service.",
    firstStep: "Contact the practice and ask about referral requirements, current availability, fees, and appointment options.",
    cost: "Private psychiatry fees may apply; ask about current costs and referral requirements.",
    availabilityStatus: "not_published",
    availabilityCheckedAt: "2026-06-01",
    availabilitySource: "https://www.northlandpsychiatry.co.nz/",
    availabilityNeedsManualReview: true,
    onlineAvailable: false,
    phoneSupport: false,
    inPerson: true
  };
  const decision = {
    providerId: "candidate-northland-psychiatry",
    action: "approve",
    newProviderCandidate: true,
    correctedFields,
    sourceUrl: "https://www.northlandpsychiatry.co.nz/",
    sourceExcerpt: "Northland Psychiatry public contact page lists the practice name, Whangarei address, and phone 09 553 3255.",
    reviewer: "tester",
    reviewedDate: "2026-06-01"
  };
  const accepted = applyReviewDecisions({
    providers: [],
    decisions: { decisions: [decision] }
  });
  const missingFlag = applyReviewDecisions({
    providers: [],
    decisions: { decisions: [{ ...decision, newProviderCandidate: false }] }
  });
  const weakEvidence = applyReviewDecisions({
    providers: [],
    decisions: { decisions: [{ ...decision, sourceExcerpt: "Seed value from Google Places candidate export: 09 553 3255." }] }
  });
  const rejectedCandidate = applyReviewDecisions({
    providers: [],
    decisions: { decisions: [{ providerId: "candidate-reject", action: "reject", newProviderCandidate: true, correctedFields: { name: "Bad Candidate" }, reviewer: "tester", reviewedDate: "2026-06-01", sourceExcerpt: "Wrong provider type." }] }
  });
  const needsMoreInfoCandidate = applyReviewDecisions({
    providers: [],
    decisions: { decisions: [{ providerId: "candidate-more-info", action: "needs_more_info", newProviderCandidate: true, correctedFields: { name: "Unclear Candidate" }, reviewer: "tester", reviewedDate: "2026-06-01" }] }
  });

  assert.equal(accepted.applied.length, 1);
  assert.equal(accepted.applied[0].action, "add_new_provider");
  assert.equal(accepted.providers[0].id, "candidate-northland-psychiatry");
  assert.equal(accepted.providers[0].type, "psychiatrist");
  assert.ok(accepted.providers[0].tags.includes("psychiatrist"));
  assert.equal(accepted.providers[0].referralType, "unknown");
  assert.equal(accepted.providers[0].referralNeedsManualReview, true);
  assert.ok(accepted.providers[0].baselineScope.includes("depression/mood disorders"));
  assert.equal(accepted.events[0].action, "add_new_provider");
  assert.equal(missingFlag.applied.length, 0);
  assert.match(missingFlag.errors[0].error, /Provider not found/i);
  assert.equal(weakEvidence.applied.length, 0);
  assert.match(weakEvidence.errors[0].error, /human-captured source excerpt/i);
  assert.equal(rejectedCandidate.applied[0].action, "reject");
  assert.deepEqual(rejectedCandidate.providers, []);
  assert.equal(rejectedCandidate.events[0].newFields.rejectedNewProviderCandidate, true);
  assert.equal(needsMoreInfoCandidate.applied[0].action, "needs_more_info");
  assert.deepEqual(needsMoreInfoCandidate.providers, []);
});

test("source-fit evidence capture separates supported claims from safe removal candidates", async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const auditPath = path.join(dir, "source-fit.json");
  writeJson(providersPath, [
    baseProvider({
      id: "supported-anxiety",
      name: "Supported Anxiety",
      source: "https://supported.example.nz",
      website: "https://supported.example.nz",
      tags: ["psychologist", "anxiety"]
    }),
    baseProvider({
      id: "unsupported-telehealth",
      name: "Unsupported Telehealth",
      source: "https://unsupported.example.nz",
      website: "https://unsupported.example.nz",
      tags: ["psychologist", "telehealth", "online"],
      onlineAvailable: true,
      phoneSupport: true
    }),
    baseProvider({
      id: "blocked-rainbow",
      name: "Blocked Rainbow",
      source: "https://blocked.example.nz",
      website: "https://blocked.example.nz",
      tags: ["psychologist", "rainbow"]
    })
  ]);
  writeJson(auditPath, {
    findings: [
      {
        providerId: "supported-anxiety",
        providerName: "Supported Anxiety",
        source: "https://supported.example.nz",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"anxiety\" is present but source fields do not clearly support it.",
        suggestedFix: "Remove the tag or add source evidence."
      },
      {
        providerId: "unsupported-telehealth",
        providerName: "Unsupported Telehealth",
        source: "https://unsupported.example.nz",
        rule: "weak-telehealth-evidence",
        severity: "medium",
        issue: "Telehealth or online availability is set but source fields do not clearly support remote care.",
        suggestedFix: "Remove telehealth/online flags or add provider-owned source evidence."
      },
      {
        providerId: "blocked-rainbow",
        providerName: "Blocked Rainbow",
        source: "https://blocked.example.nz",
        rule: "weak-rainbow-evidence",
        severity: "medium",
        issue: "rainbow support tag is present but source fields do not clearly support it.",
        suggestedFix: "Remove the tag or add stronger public source evidence."
      }
    ]
  });

  const output = await buildSourceFitEvidenceCapture({
    providers: providersPath,
    sourceFitAudit: auditPath,
    rateLimitMs: 0,
    fetcher: async (url) => {
      if (url.includes("supported")) {
        return {
          url,
          finalUrl: url,
          capturedAt: "2026-06-01T00:00:00.000Z",
          ok: true,
          blocked: false,
          skipped: false,
          status: 200,
          contentType: "text/html",
          error: "",
          text: "<html><body>Clinical psychology support for anxiety, panic, and worry.</body></html>",
          sourceHash: "supported"
        };
      }
      if (url.includes("blocked")) {
        return {
          url,
          finalUrl: url,
          capturedAt: "2026-06-01T00:00:00.000Z",
          ok: false,
          blocked: true,
          skipped: false,
          status: 403,
          contentType: "text/html",
          error: "blocked-by-site",
          text: "",
          sourceHash: ""
        };
      }
      return {
        url,
        finalUrl: url,
        capturedAt: "2026-06-01T00:00:00.000Z",
        ok: true,
        blocked: false,
        skipped: false,
        status: 200,
        contentType: "text/html",
        error: "",
        text: "<html><body>In-person psychological assessment and therapy.</body></html>",
        sourceHash: "unsupported"
      };
    }
  });

  const byId = new Map(output.items.map((item) => [item.providerId, item]));
  assert.equal(output.summary.sourceSupportFound, 1);
  assert.equal(output.summary.safeRemovalCandidates, 1);
  assert.equal(output.summary.needsHumanBrowserReview, 1);
  assert.equal(output.summary.eligibleFindingsTotal, 3);
  assert.equal(output.summary.eligibleFindingsCaptured, 3);
  assert.equal(output.summary.eligibleFindingsRemaining, 0);
  assert.equal(output.summary.eligibleCoveragePercent, 100);
  assert.equal(output.summary.batchCount, 3);
  assert.equal(byId.get("supported-anxiety").status, "source_support_found");
  assert.equal(
    byId.get("supported-anxiety").batchKey,
    "source-fit:source_support_found:broad-tag-without-source-support:anxiety"
  );
  assert.match(byId.get("supported-anxiety").evidenceSummary, /anxiety/i);
  assert.equal(byId.get("unsupported-telehealth").status, "safe_removal_candidate");
  assert.equal(
    byId.get("unsupported-telehealth").batchKey,
    "source-fit:safe_removal_candidate:weak-telehealth-evidence:telehealth"
  );
  assert.deepEqual(byId.get("unsupported-telehealth").correctedFields.tags, ["psychologist"]);
  assert.equal(byId.get("unsupported-telehealth").correctedFields.onlineAvailable, false);
  assert.equal(byId.get("unsupported-telehealth").correctedFields.phoneSupport, false);
  assert.equal(byId.get("blocked-rainbow").status, "needs_human_browser_review");
});

test("source-fit evidence capture treats support-preference cues conservatively", async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const auditPath = path.join(dir, "source-fit.json");
  writeJson(providersPath, [
    baseProvider({
      id: "maori-cue",
      name: "Ngāti Aroha Hauora",
      source: "https://cue.example.nz",
      website: "https://cue.example.nz",
      tags: ["gp", "maori"]
    }),
    baseProvider({
      id: "maori-source",
      name: "Community Health",
      source: "https://source.example.nz",
      website: "https://source.example.nz",
      tags: ["gp", "maori"]
    })
  ]);
  writeJson(auditPath, {
    findings: [
      {
        providerId: "maori-cue",
        providerName: "Ngāti Aroha Hauora",
        source: "https://cue.example.nz",
        rule: "weak-maori-evidence",
        severity: "high",
        issue: "Māori support tag is present but source fields do not clearly support it."
      },
      {
        providerId: "maori-source",
        providerName: "Community Health",
        source: "https://source.example.nz",
        rule: "weak-maori-evidence",
        severity: "high",
        issue: "Māori support tag is present but source fields do not clearly support it."
      }
    ]
  });

  const output = await buildSourceFitEvidenceCapture({
    providers: providersPath,
    sourceFitAudit: auditPath,
    rateLimitMs: 0,
    fetcher: async (url) => ({
      url,
      finalUrl: url,
      capturedAt: "2026-06-01T00:00:00.000Z",
      ok: true,
      blocked: false,
      skipped: false,
      status: 200,
      contentType: "text/html",
      error: "",
      text: url.includes("source")
        ? "<html><body>We are a kaupapa Māori service supporting whānau wellbeing.</body></html>"
        : "<html><body>General practice appointments and nurse consultations.</body></html>",
      sourceHash: url.includes("source") ? "source" : "cue"
    })
  });

  const byId = new Map(output.items.map((item) => [item.providerId, item]));
  assert.equal(byId.get("maori-cue").status, "needs_human_browser_review");
  assert.deepEqual(byId.get("maori-cue").correctedFields, {});
  assert.ok(byId.get("maori-cue").reviewReasons.some((reason) => /support-preference cues/i.test(reason)));
  assert.equal(byId.get("maori-source").status, "source_support_found");
  assert.match(byId.get("maori-source").evidenceSummary, /kaupapa|whānau/i);
});

test("source-fit evidence capture can skip and merge existing batches", async () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const auditPath = path.join(dir, "source-fit.json");
  const existingPath = path.join(dir, "existing-capture.json");
  writeJson(providersPath, [
    baseProvider({
      id: "already-checked",
      name: "Already Checked",
      source: "https://already.example.nz",
      website: "https://already.example.nz",
      tags: ["psychologist", "anxiety"]
    }),
    baseProvider({
      id: "next-checked",
      name: "Next Checked",
      source: "https://next.example.nz",
      website: "https://next.example.nz",
      tags: ["psychologist", "depression"]
    }),
    baseProvider({
      id: "later-checked",
      name: "Later Checked",
      source: "https://later.example.nz",
      website: "https://later.example.nz",
      tags: ["psychologist", "trauma"]
    })
  ]);
  writeJson(auditPath, {
    findings: [
      {
        providerId: "already-checked",
        providerName: "Already Checked",
        source: "https://already.example.nz",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"anxiety\" is present but source fields do not clearly support it."
      },
      {
        providerId: "next-checked",
        providerName: "Next Checked",
        source: "https://next.example.nz",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"depression\" is present but source fields do not clearly support it."
      },
      {
        providerId: "later-checked",
        providerName: "Later Checked",
        source: "https://later.example.nz",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"trauma\" is present but source fields do not clearly support it."
      }
    ]
  });
  writeJson(existingPath, {
    version: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    summary: {},
    items: [
      {
        reviewId: "source-fit-capture:already-checked:broad-tag-without-source-support:anxiety",
        providerId: "already-checked",
        providerName: "Already Checked",
        rule: "broad-tag-without-source-support",
        target: "anxiety",
        status: "source_support_found",
        evidenceSummary: "Existing reviewer-checkable anxiety excerpt"
      },
      {
        reviewId: "source-fit-capture:fixed-record:broad-tag-without-source-support:depression",
        providerId: "fixed-record",
        providerName: "Fixed Record",
        rule: "broad-tag-without-source-support",
        target: "depression",
        status: "safe_removal_candidate",
        evidenceSummary: "This old row should disappear once the audit finding is fixed."
      }
    ]
  });

  const fetched = [];
  const output = await buildSourceFitEvidenceCapture({
    providers: providersPath,
    sourceFitAudit: auditPath,
    jsonOut: existingPath,
    existingCapture: existingPath,
    skipExisting: true,
    mergeExisting: true,
    limit: 1,
    rateLimitMs: 0,
    fetcher: async (url) => {
      fetched.push(url);
      return {
        url,
        finalUrl: url,
        capturedAt: "2026-06-01T00:05:00.000Z",
        ok: true,
        blocked: false,
        skipped: false,
        status: 200,
        contentType: "text/html",
        error: "",
        text: "<html><body>We provide in-person counselling only.</body></html>",
        sourceHash: "next"
      };
    }
  });

  assert.deepEqual(fetched, ["https://next.example.nz"]);
  assert.equal(output.summary.newFindingsConsidered, 1);
  assert.equal(output.summary.eligibleFindingsTotal, 3);
  assert.equal(output.summary.eligibleFindingsCaptured, 2);
  assert.equal(output.summary.eligibleFindingsRemaining, 1);
  assert.equal(output.summary.eligibleCoveragePercent, 66.7);
  assert.equal(output.summary.existingItemsSkipped, 2);
  assert.equal(output.summary.staleExistingItems, 1);
  assert.equal(output.summary.staleExistingItemsDropped, 1);
  assert.equal(output.summary.existingItemsMerged, 1);
  assert.equal(output.summary.totalItems, 2);
  assert.equal(output.items.map((item) => item.providerId).join(","), "already-checked,next-checked");
  assert.equal(output.items.some((item) => item.providerId === "fixed-record"), false);
  assert.equal(output.items.find((item) => item.providerId === "already-checked").evidenceSummary, "Existing reviewer-checkable anxiety excerpt");
  assert.equal(
    output.items.find((item) => item.providerId === "already-checked").batchKey,
    "source-fit:source_support_found:broad-tag-without-source-support:anxiety"
  );
  assert.equal(output.items.find((item) => item.providerId === "next-checked").status, "safe_removal_candidate");
  assert.ok(output.summary.batches.some((batch) => batch.batchKey === "source-fit:safe_removal_candidate:broad-tag-without-source-support:depression"));
});

test("source-fit capture decision drafts merge removals per provider", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const capturePath = path.join(dir, "capture.json");
  writeJson(providersPath, [
    baseProvider({
      id: "multi-remove",
      name: "Multi Remove",
      tags: ["psychologist", "depression", "anxiety", "telehealth", "fit"],
      onlineAvailable: true,
      phoneSupport: true
    })
  ]);
  writeJson(capturePath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "multi-remove",
        status: "safe_removal_candidate",
        rule: "broad-tag-without-source-support",
        target: "depression",
        sourceUrl: "https://example.org",
        auditRules: ["broad-tag-without-source-support"],
        correctedFields: {
          tags: ["psychologist", "anxiety", "telehealth", "fit"]
        }
      },
      {
        providerId: "multi-remove",
        status: "safe_removal_candidate",
        rule: "broad-tag-without-source-support",
        target: "anxiety",
        sourceUrl: "https://example.org",
        auditRules: ["broad-tag-without-source-support"],
        correctedFields: {
          tags: ["psychologist", "depression", "telehealth", "fit"]
        }
      },
      {
        providerId: "multi-remove",
        status: "safe_removal_candidate",
        rule: "weak-telehealth-evidence",
        target: "telehealth",
        sourceUrl: "https://example.org",
        auditRules: ["weak-telehealth-evidence"],
        correctedFields: {
          tags: ["psychologist", "depression", "anxiety", "fit"],
          onlineAvailable: false,
          phoneSupport: false
        }
      }
    ]
  });

  assert.throws(() => buildSourceFitCaptureDecisionDraft({
    capture: capturePath,
    providers: providersPath
  }), /confirmed-human-review/);

  const draft = buildSourceFitCaptureDecisionDraft({
    capture: capturePath,
    providers: providersPath,
    reviewer: "tester",
    reviewedDate: "2026-06-01",
    notes: "Reviewer checked the source page and confirmed these claims are unsupported.",
    confirmedHumanReview: true
  });

  assert.equal(draft.summary.captureRowsMatched, 3);
  assert.equal(draft.summary.decisionsDrafted, 1);
  assert.deepEqual(draft.decisions[0].correctedFields.tags, ["psychologist", "fit"]);
  assert.equal(draft.decisions[0].correctedFields.onlineAvailable, false);
  assert.equal(draft.decisions[0].correctedFields.phoneSupport, false);
  assert.match(draft.decisions[0].reviewNotes, /Targets removed: depression, anxiety, telehealth/);
  assert.equal(draft.safety.groupedByProviderToAvoidTagReadd, true);
});

test("source-fit capture decision drafts can target auditor batch keys", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const capturePath = path.join(dir, "capture.json");
  writeJson(providersPath, [
    baseProvider({
      id: "batch-target",
      name: "Batch Target",
      tags: ["psychologist", "depression", "anxiety", "telehealth"],
      onlineAvailable: true
    })
  ]);
  writeJson(capturePath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "batch-target",
        status: "safe_removal_candidate",
        rule: "broad-tag-without-source-support",
        target: "depression",
        batchKey: "source-fit:safe_removal_candidate:broad-tag-without-source-support:depression",
        sourceUrl: "https://example.org",
        auditRules: ["broad-tag-without-source-support"],
        correctedFields: {
          tags: ["psychologist", "anxiety", "telehealth"]
        }
      },
      {
        providerId: "batch-target",
        status: "safe_removal_candidate",
        rule: "broad-tag-without-source-support",
        target: "anxiety",
        batchKey: "source-fit:safe_removal_candidate:broad-tag-without-source-support:anxiety",
        sourceUrl: "https://example.org",
        auditRules: ["broad-tag-without-source-support"],
        correctedFields: {
          tags: ["psychologist", "depression", "telehealth"]
        }
      },
      {
        providerId: "batch-target",
        status: "source_support_found",
        rule: "weak-telehealth-evidence",
        target: "telehealth",
        batchKey: "source-fit:source_support_found:weak-telehealth-evidence:telehealth",
        sourceUrl: "https://example.org",
        auditRules: ["weak-telehealth-evidence"],
        evidenceSummary: "Online appointments are listed.",
        correctedFields: {}
      }
    ]
  });

  const removalDraft = buildSourceFitCaptureDecisionDraft({
    capture: capturePath,
    providers: providersPath,
    batchKey: "source-fit:safe_removal_candidate:broad-tag-without-source-support:depression",
    reviewer: "tester",
    notes: "Reviewer checked this depression batch and confirmed the claim is unsupported.",
    confirmedHumanReview: true
  });

  assert.equal(removalDraft.summary.captureRowsMatched, 1);
  assert.deepEqual(removalDraft.decisions[0].correctedFields.tags, ["psychologist", "anxiety", "telehealth"]);
  assert.deepEqual(removalDraft.summary.byBatch, {
    "source-fit:safe_removal_candidate:broad-tag-without-source-support:depression": 1
  });

  const supportDraft = buildSourceFitCaptureDecisionDraft({
    capture: capturePath,
    providers: providersPath,
    batchKey: "source-fit:source_support_found:weak-telehealth-evidence:telehealth",
    reviewer: "tester",
    notes: "Reviewer still needs to confirm the support excerpt belongs to this provider."
  });

  assert.equal(supportDraft.summary.captureRowsMatched, 1);
  assert.equal(supportDraft.decisions[0].action, "needs_more_info");
  assert.deepEqual(supportDraft.decisions[0].correctedFields, {});
  assert.equal(supportDraft.safety.noAddedTagsOrCapabilities, true);
});

test("validation control room is read-only, secret-free, and opens sources externally", () => {
  const html = fs.readFileSync("admin/index.html", "utf8");
  const js = fs.readFileSync("admin/validation-control-room.js", "utf8");
  assert.doesNotMatch(`${html}\n${js}`, /api[_-]?key|secret|token|bearer\s+[a-z0-9._-]+/i);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.doesNotMatch(js, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
  assert.match(js, /target = "_blank"/);
  assert.match(js, /rel = "noopener noreferrer"/);
  assert.match(html, /Provider Validation Control Room/);
  assert.match(html, /The public provider database is not writable from this console/);
  assert.match(html, /Run health/);
  assert.match(html, /Evidence coverage/);
  assert.match(html, /Blocked and failed sources/);
  assert.match(html, /Automatic changes/);
  assert.match(html, /Run and rollback history/);
  assert.match(html, /Show 100 more/);
  assert.match(js, /data\/provider-validation\/control-room\.json/);
  assert.match(js, /PROVIDER_PAGE_SIZE = 100/);
  assert.match(js, /state\.filtered\.slice\(0, state\.visibleProviders\)/);
  assert.match(js, /Source timeline/);
  assert.match(js, /Automated decision/);
  assert.match(js, /state\.data\.providers/);
});

test("provider evidence graph splits rows into scored claims and review-gates high-risk fields", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const availabilityPath = path.join(dir, "availability.json");
  const referralPath = path.join(dir, "referral.json");
  const reviewQueuePath = path.join(dir, "review-queue.json");
  const provider = baseProvider({
    id: "claim-source",
    name: "Claim Source",
    sourceQuality: "provider-owned page",
    confidence: "high",
    needsManualVerification: false,
    tags: ["psychologist", "depression"],
    availabilityStatus: "accepting",
    availabilityEvidence: "",
    availabilityNeedsManualReview: true
  });
  writeJson(providersPath, [provider]);
  writeJson(sourceFitPath, {
    findings: [{
      providerId: "claim-source",
      rule: "broad-tag-without-source-support",
      severity: "medium",
      issue: "Broad tag needs source evidence.",
      suggestedFix: "Remove tag or add evidence.",
      source: "https://example.org/source"
    }]
  });
  writeJson(availabilityPath, { findings: [] });
  writeJson(referralPath, { findings: [] });
  writeJson(reviewQueuePath, { items: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: availabilityPath,
    referralAudit: referralPath,
    reviewQueue: reviewQueuePath
  });
  const node = graph.nodes[0];
  const nameClaim = node.claims.find((claim) => claim.field === "name");
  const tagClaim = node.claims.find((claim) => claim.field === "tags" && claim.value === "depression");
  const acceptingClaim = node.claims.find((claim) => claim.field === "availabilityStatus");
  assert.equal(nameClaim.decision, "review");
  assert.equal(nameClaim.sourceType, "unknown");
  assert.match(nameClaim.reason, /not strong enough/i);
  assert.equal(tagClaim.decision, "review");
  assert.equal(tagClaim.riskLevel, "high");
  assert.equal(acceptingClaim.decision, "review");
  assert.match(acceptingClaim.reason, /accepting availability/i);
});

test("claim review queue compresses repeated field-level work into batch groups", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const providers = [
    baseProvider({ id: "batch-one", name: "Batch One", tags: ["psychologist", "depression"] }),
    baseProvider({ id: "batch-two", name: "Batch Two", tags: ["psychologist", "depression"] })
  ];
  writeJson(providersPath, providers);
  writeJson(sourceFitPath, {
    findings: providers.map((provider) => ({
      providerId: provider.id,
      rule: "broad-tag-without-source-support",
      severity: "medium",
      issue: "Broad depression tag needs source support.",
      suggestedFix: "Remove or evidence tag.",
      source: provider.source
    }))
  });
  writeJson(emptyPath, { findings: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const queue = buildProviderClaimReviewQueue({ graph: graphPath, providers: providersPath });
  assert.ok(queue.items.some((item) => item.claimField === "tags" && item.claimValue === "depression"));
  const tagBatch = queue.batches.find((batch) => batch.claimField === "tags" && batch.count >= 2);
  assert.ok(tagBatch);
  assert.equal(tagBatch.providerCount, 2);
  assert.equal(tagBatch.providers.length, 2);
  assert.equal(tagBatch.duplicateClaimRows, tagBatch.count - tagBatch.providerCount);
  assert.ok(queue.summary.batches < queue.items.length, "batch count should compress repeated claim items");
});

test("claim queue attaches tag audit findings only to matching tag values", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const providers = [
    baseProvider({
      id: "targeted-tags",
      name: "Targeted Tags",
      tags: ["psychologist", "depression", "telehealth", "direct-contact", "cost"]
    })
  ];
  writeJson(providersPath, providers);
  writeJson(sourceFitPath, {
    findings: [
      {
        providerId: "targeted-tags",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"depression\" is present but source fields do not clearly support it.",
        suggestedFix: "Remove depression or add evidence."
      },
      {
        providerId: "targeted-tags",
        rule: "weak-telehealth-evidence",
        severity: "medium",
        issue: "Telehealth or online availability is set but source fields do not clearly support remote care.",
        suggestedFix: "Remove telehealth/online flags or add evidence."
      }
    ]
  });
  writeJson(emptyPath, { findings: [], items: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const queue = buildProviderClaimReviewQueue({ graph: graphPath, providers: providersPath });
  const tagItems = queue.items.filter((item) => item.claimField === "tags");
  const queuedTags = tagItems.map((item) => item.claimValue).sort();

  assert.deepEqual(queuedTags, ["depression", "telehealth"]);
  assert.equal(tagItems.some((item) => item.claimValue === "direct-contact"), false);
  assert.equal(tagItems.some((item) => item.claimValue === "cost"), false);
  assert.equal(tagItems.some((item) => item.claimValue === "psychologist"), false);
});

test("weak GP source audit creates one source-corroboration task per provider", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const providers = [
    baseProvider({
      id: "weak-gp-source",
      name: "Weak GP Source",
      type: "gp",
      phone: "09 123 4567",
      website: "",
      source: "https://doctorpricer.co.nz/",
      sourceQuality: "third-party public GP listing",
      tags: ["gp", "primary-care"]
    })
  ];
  writeJson(providersPath, providers);
  writeJson(sourceFitPath, {
    findings: [
      {
        providerId: "weak-gp-source",
        rule: "weak-gp-source",
        severity: "low",
        issue: "GP record uses a third-party or generic source and is missing either phone or website.",
        suggestedFix: "Verify against a practice-owned page, Healthpoint, HPI/FHIR export, or PHO data when available."
      }
    ]
  });
  writeJson(emptyPath, { findings: [], items: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const queue = buildProviderClaimReviewQueue({ graph: graphPath, providers: providersPath });
  const gpItems = queue.items.filter((item) => item.reviewCategory === "GP source corroboration");

  assert.equal(gpItems.length, 1);
  assert.equal(gpItems[0].providerId, "weak-gp-source");
  assert.equal(gpItems[0].claimField, "sourceQuality");
  assert.equal(gpItems.some((item) => item.claimField === "phone"), false);
});

test("GP source corroboration queue isolates weak GP records without live mutation", () => {
  const providers = [
    baseProvider({
      id: "weak-gp-corroboration",
      name: "Weak GP Corroboration",
      type: "gp",
      region: "Northland",
      city: "Whangarei",
      address: "1 Sample Road, Whangarei",
      phone: "09 123 4567",
      website: "",
      source: "https://doctorpricer.co.nz/",
      sourceQuality: "third-party public GP listing",
      importSource: "doctorpricer",
      tags: ["gp", "primary-care"]
    }),
    baseProvider({
      id: "strong-gp-corroboration",
      name: "Strong GP Corroboration",
      type: "gp",
      region: "Northland",
      city: "Whangarei",
      website: "https://examplemedical.nz",
      source: "https://examplemedical.nz",
      sourceQuality: "practice-owned public page",
      tags: ["gp", "primary-care"]
    }),
    baseProvider({
      id: "weak-non-gp",
      name: "Weak Non-GP",
      type: "psychologist",
      website: "",
      source: "https://doctorpricer.co.nz/",
      sourceQuality: "third-party public listing"
    })
  ];
  const original = JSON.stringify(providers);
  const queue = buildGpSourceCorroborationQueue({
    providers,
    sourceFitAudit: {
      findings: [{
        providerId: "weak-gp-corroboration",
        rule: "weak-gp-source",
        severity: "low",
        issue: "GP record uses a third-party or generic source and is missing either phone or website."
      }]
    }
  });

  assert.equal(queue.summary.totalTasks, 1);
  assert.equal(queue.summary.missingWebsite, 1);
  assert.equal(queue.summary.missingPhone, 0);
  assert.equal(queue.summary.noLiveProviderMutation, true);
  assert.equal(queue.safety.reviewGateRequired, true);
  assert.equal(queue.tasks[0].providerId, "weak-gp-corroboration");
  assert.deepEqual(queue.tasks[0].missingFields, ["website"]);
  assert.equal(queue.tasks[0].decisionGuidance.liveMutationAllowed, false);
  assert.ok(queue.tasks[0].allowedEvidenceSources.some((source) => /Healthpoint/.test(source)));
  assert.ok(queue.tasks[0].disallowedEvidenceSources.some((source) => /search-result snippet/i.test(source)));
  assert.ok(queue.tasks[0].suggestedSearches.some((query) => query.includes("site:healthpoint.co.nz")));
  assert.equal(JSON.stringify(providers), original);
});

test("GP corroboration review pack ranks strong exact leads but keeps source capture gated", () => {
  const provider = baseProvider({
    id: "gp-ready-review",
    name: "Ready Review Medical",
    type: "gp",
    region: "Northland",
    city: "Whangarei",
    phone: "09 123 4567",
    website: "",
    sourceQuality: "third-party public GP listing",
    importSource: "doctorpricer",
    tags: ["gp", "primary-care"]
  });
  const pack = buildGpCorroborationReviewPack({
    providers: [provider],
    gpCorroborationQueue: {
      tasks: [{
        providerId: "gp-ready-review",
        name: "Ready Review Medical",
        region: "Northland",
        city: "Whangarei",
        missingFields: ["website"],
        reviewReason: "GP record needs stronger corroboration: missing website."
      }]
    },
    googlePlacesCandidates: {
      candidates: [{
        candidateId: "places-ready-review",
        action: "corroborate_existing_provider",
        type: "gp",
        name: "Ready Review Medical",
        phone: "09 123 4567",
        website: "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/ready-review-medical/",
        address: "1 Test Street, Whangarei",
        lat: -35.72,
        lon: 174.32,
        possibleProviderIds: ["gp-ready-review"],
        duplicateSignals: ["phone", "name", "address"],
        reviewReasons: ["target GP source-corroboration provider: gp-ready-review"]
      }]
    }
  });

  assert.equal(pack.safety.noLiveProviderMutation, true);
  assert.equal(pack.safety.sourceExcerptRequiredBeforeApply, true);
  assert.equal(pack.summary.readyForSourceCapture, 1);
  assert.equal(pack.summary.batchCount, 1);
  assert.equal(pack.items[0].priority, "ready_for_source_capture");
  assert.equal(pack.items[0].batchKey, "gp-review:ready_for_source_capture:not_fetched:healthpoint_gp_listing");
  assert.equal(pack.items[0].bestCandidate.sourceCategory, "healthpoint_gp_listing");
  assert.equal(pack.items[0].draftCorrectedFields.website, "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/ready-review-medical/");
  assert.equal(pack.items[0].liveMutationAllowed, false);
});

test("GP corroboration review pack can capture source excerpts without approving data", async () => {
  const provider = baseProvider({
    id: "gp-ready-review-excerpt",
    name: "Ready Review Medical",
    type: "gp",
    region: "Northland",
    city: "Whangarei",
    phone: "09 123 4567",
    website: "",
    sourceQuality: "third-party public GP listing",
    importSource: "doctorpricer",
    tags: ["gp", "primary-care"]
  });
  const pack = buildGpCorroborationReviewPack({
    providers: [provider],
    gpCorroborationQueue: {
      tasks: [{
        providerId: "gp-ready-review-excerpt",
        name: "Ready Review Medical",
        region: "Northland",
        city: "Whangarei",
        missingFields: ["website"],
        reviewReason: "GP record needs stronger corroboration: missing website."
      }]
    },
    googlePlacesCandidates: {
      candidates: [{
        candidateId: "places-ready-review-excerpt",
        action: "corroborate_existing_provider",
        type: "gp",
        name: "Ready Review Medical",
        phone: "09 123 4567",
        website: "https://readyreviewmedical.example.org",
        address: "1 Test Street, Whangarei",
        possibleProviderIds: ["gp-ready-review-excerpt"],
        duplicateSignals: ["phone", "name", "address"]
      }]
    }
  });

  const enriched = await enrichGpCorroborationReviewPackWithSourceExcerpts(pack, {
    maxSourceFetches: 1,
    rateLimitMs: 0,
    fetchSource: async (url) => ({
      url,
      finalUrl: url,
      capturedAt: "2026-06-01T00:00:00.000Z",
      ok: true,
      blocked: false,
      skipped: false,
      status: 200,
      contentType: "text/html",
      error: "",
      text: "<html><title>Ready Review Medical</title><body><h1>Ready Review Medical</h1><p>Phone 09 123 4567</p><p>1 Test Street, Whangarei</p></body></html>",
      sourceHash: "testhash"
    })
  });

  assert.equal(enriched.sourceFetch.enabled, true);
  assert.equal(enriched.summary.sourcePagesFetched, 1);
  assert.equal(enriched.summary.sourceCaptures, 1);
  assert.equal(enriched.summary.batches[0].batchKey, "gp-review:ready_for_source_capture:captured:practice_or_network_site");
  assert.equal(enriched.items[0].sourceCapture.status, "captured");
  assert.equal(enriched.items[0].batchKey, "gp-review:ready_for_source_capture:captured:practice_or_network_site");
  assert.match(enriched.items[0].sourceExcerpt, /Ready Review Medical|09 123 4567/);
  assert.equal(enriched.items[0].liveMutationAllowed, false);
});

test("GP corroboration decision drafts require human confirmation and contact-only fields", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const packPath = path.join(dir, "gp-pack.json");
  writeJson(providersPath, [
    baseProvider({
      id: "gp-review",
      name: "Review GP",
      type: "gp",
      tags: ["gp"],
      website: "",
      source: "https://doctorpricer.co.nz/",
      sourceQuality: "third-party public GP listing"
    }),
    baseProvider({
      id: "gp-unsafe",
      name: "Unsafe GP",
      type: "gp",
      tags: ["gp"],
      website: "",
      source: "https://doctorpricer.co.nz/",
      sourceQuality: "third-party public GP listing"
    })
  ]);
  writeJson(packPath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "gp-review",
        priority: "ready_for_source_capture",
        bestCandidate: {
          website: "https://reviewgp.example.nz",
          sourceCategory: "practice_or_network_site"
        },
        draftCorrectedFields: {
          website: "https://reviewgp.example.nz",
          source: "https://reviewgp.example.nz",
          sourceQuality: "practice or clinic network website; pending human source-excerpt review"
        },
        auditRules: ["gp-corroboration-review-pack"],
        sourceCapture: {
          status: "captured",
          finalUrl: "https://reviewgp.example.nz",
          suggestedSourceExcerpt: "Review GP contact page lists Review GP and phone 09 123 4567."
        },
        suggestedSourceExcerpt: "Review GP contact page lists Review GP and phone 09 123 4567."
      },
      {
        providerId: "gp-unsafe",
        priority: "ready_for_source_capture",
        bestCandidate: {
          website: "https://unsafegp.example.nz",
          sourceCategory: "practice_or_network_site"
        },
        draftCorrectedFields: {
          website: "https://unsafegp.example.nz",
          availabilityStatus: "accepting"
        },
        sourceCapture: {
          status: "captured",
          finalUrl: "https://unsafegp.example.nz",
          suggestedSourceExcerpt: "Unsafe GP contact page lists Unsafe GP."
        }
      }
    ]
  });

  assert.throws(
    () => buildGpCorroborationDecisionDraft({
      pack: packPath,
      providers: providersPath,
      decision: "adjust",
      confirmedHumanReview: false,
      reviewer: "Reviewer"
    }),
    /confirmed-human-review/
  );

  const draft = buildGpCorroborationDecisionDraft({
    pack: packPath,
    providers: providersPath,
    decision: "adjust",
    confirmedHumanReview: true,
    reviewer: "Reviewer"
  });

  assert.equal(draft.summary.packRowsMatched, 2);
  assert.equal(draft.summary.decisionsDrafted, 1);
  assert.equal(draft.summary.skipped, 1);
  assert.equal(draft.decisions[0].providerId, "gp-review");
  assert.deepEqual(draft.decisions[0].correctedFields, {
    website: "https://reviewgp.example.nz",
    source: "https://reviewgp.example.nz",
    sourceQuality: "practice or clinic network website; human-reviewed public source"
  });
  assert.match(draft.decisions[0].sourceExcerpt, /Review GP contact page/);
  assert.match(draft.decisions[0].reviewNotes, /No availability/);
  assert.match(draft.skipped[0].reason, /Unsafe GP corroboration corrected field/);
});

test("GP corroboration decision drafts can mark failed captures needs_more_info", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const packPath = path.join(dir, "gp-pack.json");
  writeJson(providersPath, [
    baseProvider({
      id: "gp-failed",
      name: "Failed GP",
      type: "gp",
      tags: ["gp"]
    })
  ]);
  writeJson(packPath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "gp-failed",
        priority: "ready_for_source_capture",
        bestCandidate: {
          website: "https://failed.example.nz",
          sourceCategory: "practice_or_network_site"
        },
        sourceCapture: {
          status: "failed",
          finalUrl: "https://failed.example.nz",
          error: "timeout"
        },
        auditRules: ["gp-corroboration-review-pack"]
      }
    ]
  });

  const draft = buildGpCorroborationDecisionDraft({
    pack: packPath,
    providers: providersPath,
    decision: "needs_more_info",
    status: "failed",
    reviewer: "Reviewer",
    notes: "Needs browser check."
  });

  assert.equal(draft.summary.decisionsDrafted, 1);
  assert.equal(draft.decisions[0].action, "needs_more_info");
  assert.deepEqual(draft.decisions[0].correctedFields, {});
  assert.match(draft.decisions[0].reviewNotes, /timeout/);
});

test("GP corroboration decision drafts can target review-pack batch keys", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const packPath = path.join(dir, "gp-pack.json");
  writeJson(providersPath, [
    baseProvider({
      id: "gp-batch-captured",
      name: "Captured Batch GP",
      type: "gp",
      tags: ["gp"],
      website: "",
      sourceQuality: "third-party public GP listing"
    }),
    baseProvider({
      id: "gp-batch-blocked",
      name: "Blocked Batch GP",
      type: "gp",
      tags: ["gp"],
      website: "",
      sourceQuality: "third-party public GP listing"
    })
  ]);
  writeJson(packPath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "gp-batch-captured",
        priority: "ready_for_source_capture",
        batchKey: "gp-review:ready_for_source_capture:captured:healthpoint_gp_listing",
        bestCandidate: {
          website: "https://healthpoint.example.nz/gp-batch-captured",
          sourceCategory: "healthpoint_gp_listing"
        },
        draftCorrectedFields: {
          website: "https://healthpoint.example.nz/gp-batch-captured",
          source: "https://healthpoint.example.nz/gp-batch-captured",
          sourceQuality: "Healthpoint GP listing; pending human source-excerpt review"
        },
        sourceCapture: {
          status: "captured",
          finalUrl: "https://healthpoint.example.nz/gp-batch-captured",
          suggestedSourceExcerpt: "Captured Batch GP listing shows phone and address."
        },
        suggestedSourceExcerpt: "Captured Batch GP listing shows phone and address."
      },
      {
        providerId: "gp-batch-blocked",
        priority: "ready_for_source_capture",
        batchKey: "gp-review:ready_for_source_capture:blocked:practice_or_network_site",
        bestCandidate: {
          website: "https://blocked.example.nz",
          sourceCategory: "practice_or_network_site"
        },
        draftCorrectedFields: {
          website: "https://blocked.example.nz",
          source: "https://blocked.example.nz",
          sourceQuality: "practice or clinic network website; pending human source-excerpt review"
        },
        sourceCapture: {
          status: "blocked",
          finalUrl: "https://blocked.example.nz",
          error: "login-or-captcha-required"
        }
      }
    ]
  });

  const adjustDraft = buildGpCorroborationDecisionDraft({
    pack: packPath,
    providers: providersPath,
    batchKey: "gp-review:ready_for_source_capture:captured:healthpoint_gp_listing",
    decision: "adjust",
    confirmedHumanReview: true,
    reviewer: "Reviewer",
    notes: "Checked captured Healthpoint batch."
  });

  assert.equal(adjustDraft.summary.packRowsMatched, 1);
  assert.equal(adjustDraft.decisions[0].providerId, "gp-batch-captured");
  assert.deepEqual(adjustDraft.summary.byBatch, {
    "gp-review:ready_for_source_capture:captured:healthpoint_gp_listing": 1
  });

  const needsInfoDraft = buildGpCorroborationDecisionDraft({
    pack: packPath,
    providers: providersPath,
    batchKey: "gp-review:ready_for_source_capture:blocked:practice_or_network_site",
    decision: "needs_more_info",
    reviewer: "Reviewer",
    notes: "Blocked practice-site batch needs browser review."
  });

  assert.equal(needsInfoDraft.summary.packRowsMatched, 1);
  assert.equal(needsInfoDraft.decisions[0].providerId, "gp-batch-blocked");
  assert.equal(needsInfoDraft.decisions[0].action, "needs_more_info");
});

test("GP corroboration review pack flags multi-provider Places matches as manual compare", () => {
  const provider = baseProvider({
    id: "gp-shared-match",
    name: "Shared Match Medical",
    type: "gp",
    website: "",
    phone: "09 222 3333",
    sourceQuality: "third-party public GP listing",
    importSource: "doctorpricer"
  });
  const pack = buildGpCorroborationReviewPack({
    providers: [provider],
    gpCorroborationQueue: {
      tasks: [{
        providerId: "gp-shared-match",
        name: "Shared Match Medical",
        missingFields: ["website"]
      }]
    },
    googlePlacesCandidates: {
      candidates: [{
        candidateId: "places-shared-match",
        action: "corroborate_existing_provider",
        type: "gp",
        name: "Shared Match Medical",
        phone: "09 222 3333",
        website: "https://sharedmedical.nz",
        possibleProviderIds: ["gp-shared-match", "gp-other-branch"],
        duplicateSignals: ["phone", "name"]
      }]
    }
  });

  assert.equal(pack.items[0].priority, "manual_compare_conflict");
  assert.deepEqual(pack.items[0].bestCandidate.conflictingProviderIds, ["gp-other-branch"]);
  assert.deepEqual(pack.items[0].draftCorrectedFields, {});
});

test("GP corroboration review pack does not treat login portals as source evidence", () => {
  const provider = baseProvider({
    id: "gp-portal-only",
    name: "Portal Only Medical",
    type: "gp",
    website: "",
    phone: "09 333 4444",
    sourceQuality: "third-party public GP listing",
    importSource: "doctorpricer"
  });
  const pack = buildGpCorroborationReviewPack({
    providers: [provider],
    gpCorroborationQueue: {
      tasks: [{ providerId: "gp-portal-only", name: "Portal Only Medical", missingFields: ["website"] }]
    },
    googlePlacesCandidates: {
      candidates: [{
        candidateId: "places-portal-only",
        action: "corroborate_existing_provider",
        type: "gp",
        name: "Portal Only Medical",
        phone: "09 333 4444",
        website: "https://health365.co.nz/SGAccount/LogOn",
        possibleProviderIds: ["gp-portal-only"],
        duplicateSignals: ["phone", "name"]
      }]
    }
  });

  assert.equal(pack.items[0].bestCandidate.sourceCategory, "booking_or_login_portal");
  assert.equal(pack.items[0].priority, "source_lookup_needed");
  assert.deepEqual(pack.items[0].draftCorrectedFields, {});
});

test("location distance review pack groups coordinate gaps without live mutation", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const queuePath = path.join(dir, "review-queue.json");
  const placesPath = path.join(dir, "places.json");
  writeJson(providersPath, [
    baseProvider({
      id: "coord-target",
      name: "Coordinate Target Psychology",
      type: "psychologist",
      region: "Wellington",
      city: "Wellington",
      address: "10 Example Street, Wellington",
      lat: "",
      lon: "",
      phone: "04 123 4567",
      website: "https://coord.example.nz"
    }),
    baseProvider({
      id: "address-target",
      name: "Address Target Youth",
      type: "youth",
      region: "Northland",
      city: "Whangarei",
      address: "",
      lat: "",
      lon: "",
      website: "https://address.example.nz"
    })
  ]);
  writeJson(queuePath, {
    items: [
      {
        reviewCategory: "Location and distance evidence",
        providerId: "coord-target",
        auditRules: ["missing-coordinates"],
        reviewReasons: ["address missing coordinates"]
      },
      {
        reviewCategory: "Location and distance evidence",
        providerId: "address-target",
        auditRules: ["missing-address"],
        reviewReasons: ["missing public address"]
      }
    ]
  });
  writeJson(placesPath, {
    candidates: [
      {
        candidateId: "place-coordinate-target",
        action: "corroborate_existing_provider",
        queryId: "places-coordinate-gap:coord-target",
        type: "psychologist",
        name: "Coordinate Target Psychology",
        address: "10 Example Street, Wellington 6011",
        lat: -41.29,
        lon: 174.77,
        phone: "04 123 4567",
        website: "https://coord.example.nz",
        googleMapsUri: "https://maps.google.com/?cid=123",
        possibleProviderIds: ["coord-target"],
        duplicateSignals: ["phone", "website-domain", "address"],
        reviewReasons: ["target coordinate-gap provider: coord-target"]
      }
    ]
  });

  const pack = buildLocationDistanceReviewPack({
    providers: providersPath,
    reviewQueue: queuePath,
    googlePlacesCandidates: placesPath
  });

  assert.equal(pack.summary.total, 2);
  assert.equal(pack.safety.locationFieldsOnly, true);
  const coordinateItem = pack.items.find((item) => item.providerId === "coord-target");
  assert.equal(coordinateItem.priority, "ready_for_location_review");
  assert.equal(coordinateItem.issueType, "coordinate_gap_candidate");
  assert.match(coordinateItem.batchKey, /^location-review:coordinate_gap_candidate:ready_for_location_review:strong_match:psychologist$/);
  assert.deepEqual(Object.keys(coordinateItem.draftCorrectedFields).sort(), [
    "coordinateConfidence",
    "coordinatePrecision",
    "coordinateSource",
    "geocodeNeedsManualReview",
    "lat",
    "lon"
  ].sort());
  assert.equal(coordinateItem.draftCorrectedFields.coordinateSource, "google_places_candidate_pending_human_review");
  assert.equal(coordinateItem.liveMutationAllowed, false);

  const addressItem = pack.items.find((item) => item.providerId === "address-target");
  assert.equal(addressItem.priority, "source_lookup_needed");
  assert.equal(addressItem.issueType, "missing_address");
  assert.deepEqual(addressItem.draftCorrectedFields, {});
});

test("location distance decision drafts require review and only apply location fields", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const packPath = path.join(dir, "location-pack.json");
  writeJson(providersPath, [
    baseProvider({
      id: "coord-target",
      name: "Coordinate Target Psychology",
      type: "psychologist",
      address: "10 Example Street, Wellington",
      lat: "",
      lon: "",
      website: "https://coord.example.nz"
    }),
    baseProvider({
      id: "coord-unsafe",
      name: "Unsafe Coordinate Target",
      type: "psychologist",
      address: "20 Example Street, Wellington",
      lat: "",
      lon: ""
    })
  ]);
  writeJson(packPath, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    items: [
      {
        providerId: "coord-target",
        issueType: "coordinate_gap_candidate",
        priority: "ready_for_location_review",
        batchKey: "location-review:coordinate_gap_candidate:ready_for_location_review:strong_match:psychologist",
        bestCandidate: {
          googleMapsUri: "https://maps.google.com/?cid=123",
          matchStrength: "strong_match",
          matchSignals: ["phone", "website-domain"],
          address: "10 Example Street, Wellington 6011"
        },
        sourceEvidenceSummary: "Google Maps listing shows Coordinate Target Psychology at 10 Example Street, Wellington.",
        draftCorrectedFields: {
          lat: -41.29,
          lon: 174.77,
          coordinateSource: "google_places_candidate_pending_human_review",
          coordinatePrecision: "business listing",
          coordinateConfidence: "medium",
          geocodeNeedsManualReview: true
        },
        auditRules: ["coordinate-gap-candidate"]
      },
      {
        providerId: "coord-unsafe",
        issueType: "coordinate_gap_candidate",
        priority: "ready_for_location_review",
        batchKey: "location-review:coordinate_gap_candidate:ready_for_location_review:strong_match:psychologist",
        bestCandidate: {
          googleMapsUri: "https://maps.google.com/?cid=456",
          matchStrength: "strong_match"
        },
        sourceEvidenceSummary: "Google Maps listing shows Unsafe Coordinate Target.",
        draftCorrectedFields: {
          lat: -41.3,
          lon: 174.78,
          phone: "04 999 9999"
        }
      }
    ]
  });

  assert.throws(
    () => buildLocationDistanceDecisionDraft({
      pack: packPath,
      providers: providersPath,
      decision: "adjust",
      confirmedHumanReview: false,
      reviewer: "Reviewer"
    }),
    /confirmed-human-review/
  );

  const draft = buildLocationDistanceDecisionDraft({
    pack: packPath,
    providers: providersPath,
    decision: "adjust",
    batchKey: "location-review:coordinate_gap_candidate:ready_for_location_review:strong_match:psychologist",
    confirmedHumanReview: true,
    reviewer: "Reviewer",
    notes: "Checked Maps listing against the provider site."
  });

  assert.equal(draft.summary.packRowsMatched, 2);
  assert.equal(draft.summary.decisionsDrafted, 1);
  assert.equal(draft.summary.skipped, 1);
  assert.equal(draft.decisions[0].providerId, "coord-target");
  assert.deepEqual(Object.keys(draft.decisions[0].correctedFields).sort(), [
    "coordinateConfidence",
    "coordinatePrecision",
    "coordinateSource",
    "geocodeNeedsManualReview",
    "lat",
    "lon"
  ].sort());
  assert.match(draft.decisions[0].correctedFields.coordinateSource, /human-reviewed/);
  assert.equal(draft.decisions[0].correctedFields.geocodeNeedsManualReview, false);
  assert.match(draft.decisions[0].reviewNotes, /No provider type/);
  assert.match(draft.skipped[0].reason, /Unsafe location corrected field/);

  const needsInfo = buildLocationDistanceDecisionDraft({
    pack: packPath,
    providers: providersPath,
    decision: "needs_more_info",
    providerId: "coord-unsafe",
    reviewer: "Reviewer",
    notes: "Needs browser review."
  });
  assert.equal(needsInfo.summary.decisionsDrafted, 1);
  assert.equal(needsInfo.decisions[0].action, "needs_more_info");
  assert.deepEqual(needsInfo.decisions[0].correctedFields, {});
});

test("validation control room does not expose legacy manual decision queues", () => {
  const html = fs.readFileSync("admin/index.html", "utf8");
  const js = fs.readFileSync("admin/validation-control-room.js", "utf8");

  assert.doesNotMatch(html, /GP source corroboration|provider-review-queue|captureFilter/);
  assert.doesNotMatch(js, /provider-review-decisions|correctedFields|decision export/i);
  assert.match(html, /The public provider database is not writable from this console/);
  assert.match(html, /Provider evidence, source history, conflicts, and automated decisions/);
});

test("broad tag findings only attach to matching fit and specialty text", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const providers = [
    baseProvider({
      id: "targeted-broad-text",
      name: "Targeted Broad Text",
      tags: ["psychologist", "depression"],
      specialties: ["Diagnostic assessment", "Mood and anxiety therapy", "Professional supervision"],
      fit: "Local psychology profile for mood support and diagnostic assessment."
    })
  ];
  writeJson(providersPath, providers);
  writeJson(sourceFitPath, {
    findings: [
      {
        providerId: "targeted-broad-text",
        rule: "broad-tag-without-source-support",
        severity: "medium",
        issue: "Broad tag \"depression\" is present but source fields do not clearly support it.",
        suggestedFix: "Remove depression or add evidence."
      }
    ]
  });
  writeJson(emptyPath, { findings: [], items: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const queue = buildProviderClaimReviewQueue({ graph: graphPath, providers: providersPath });
  const broadItems = queue.items.filter((item) => item.auditRules.includes("broad-tag-without-source-support"));

  assert.ok(broadItems.some((item) => item.claimField === "tags" && item.claimValue === "depression"));
  assert.ok(broadItems.some((item) => item.claimField === "fit"));
  assert.ok(broadItems.some((item) => item.claimField === "specialties" && item.claimValue === "Mood and anxiety therapy"));
  assert.equal(broadItems.some((item) => item.claimField === "specialties" && item.claimValue === "Diagnostic assessment"), false);
  assert.equal(broadItems.some((item) => item.claimField === "specialties" && item.claimValue === "Professional supervision"), false);
});

test("claim batch draft helper creates review-gated adjustment decisions only after human confirmation", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const claimQueuePath = path.join(dir, "claim-queue.json");
  const providers = [
    baseProvider({ id: "draft-one", name: "Draft One", tags: ["psychologist", "depression", "anxiety"] }),
    baseProvider({ id: "draft-two", name: "Draft Two", tags: ["psychologist", "depression"] })
  ];
  writeJson(providersPath, providers);
  writeJson(sourceFitPath, {
    findings: providers.map((provider) => ({
      providerId: provider.id,
      rule: "broad-tag-without-source-support",
      severity: "medium",
      issue: "Broad depression tag needs source support.",
      suggestedFix: "Remove or evidence tag.",
      source: provider.source
    }))
  });
  writeJson(emptyPath, { findings: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const queue = buildProviderClaimReviewQueue({ graph: graphPath, providers: providersPath });
  writeJson(claimQueuePath, queue);
  const tagBatch = queue.batches.find((batch) => batch.claimField === "tags" && batch.count >= 2);

  assert.throws(() => buildClaimBatchDecisionDraft({
    claimQueue: claimQueuePath,
    providers: providersPath,
    batchKey: tagBatch.batchKey,
    decision: "adjust",
    field: "tags",
    removeValues: ["depression"],
    reviewer: "Reviewer"
  }), /confirmed-human-review|source-excerpt|notes/);

  const draft = buildClaimBatchDecisionDraft({
    claimQueue: claimQueuePath,
    providers: providersPath,
    batchKey: tagBatch.batchKey,
    decision: "adjust",
    field: "tags",
    removeValues: ["depression"],
    reviewer: "Reviewer",
    sourceExcerpt: "Human review confirmed this broad tag is not supported by the cited source.",
    confirmedHumanReview: true
  });

  assert.equal(draft.safety.noLiveProviderMutation, true);
  assert.equal(draft.summary.decisionsDrafted, 2);
  assert.equal(draft.decisions.every((decision) => decision.action === "adjust"), true);
  assert.equal(draft.decisions.every((decision) => !decision.correctedFields.tags.includes("depression")), true);
  assert.equal(draft.decisions.every((decision) => decision.correctedFields.tags.includes("psychologist")), true);
});

test("provider conflict detector flags likely shared practices without auto-merging clinicians", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  writeJson(providersPath, [
    baseProvider({
      id: "clinician-one",
      name: "Alex One, Shared Clinic",
      clinicianName: "Alex One",
      practiceName: "Shared Clinic",
      website: "https://sharedclinic.nz",
      email: "admin@sharedclinic.nz"
    }),
    baseProvider({
      id: "clinician-two",
      name: "Blair Two, Shared Clinic",
      clinicianName: "Blair Two",
      practiceName: "Shared Clinic",
      website: "https://sharedclinic.nz",
      email: "admin@sharedclinic.nz"
    })
  ]);
  const report = detectProviderConflicts({ providers: providersPath, graph: path.join(dir, "missing-graph.json") });
  const shared = report.conflicts.find((conflict) => conflict.kind === "shared-domain" && conflict.key === "sharedclinic.nz");
  assert.ok(shared);
  assert.equal(shared.likelySharedPractice, true);
  assert.equal(shared.likelyDuplicate, false);
});

test("auto-resolution proposals keep unknown-domain and risky claims review-gated", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const claimsPath = path.join(dir, "claims.json");
  const claimQueuePath = path.join(dir, "claim-queue.json");
  const providerQueuePath = path.join(dir, "provider-queue.json");
  const conflictsPath = path.join(dir, "conflicts.json");
  const provider = baseProvider({
    id: "proposal-provider",
    name: "Proposal Provider",
    sourceQuality: "provider-owned page",
    confidence: "high",
    needsManualVerification: false,
    tags: ["psychologist", "depression"]
  });
  writeJson(providersPath, [provider]);
  writeJson(sourceFitPath, {
    findings: [{
      providerId: "proposal-provider",
      rule: "broad-tag-without-source-support",
      severity: "medium",
      issue: "Broad tag needs source evidence.",
      suggestedFix: "Remove tag or add evidence.",
      source: provider.source
    }]
  });
  writeJson(emptyPath, { findings: [] });
  const graph = buildProviderEvidenceGraph({
    providers: providersPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath
  });
  writeJson(claimsPath, { claims: graph.claims });
  const graphPath = path.join(dir, "graph.json");
  writeJson(graphPath, graph);
  const claimQueue = buildProviderClaimReviewQueue({ graph: graphPath, claims: claimsPath, providers: providersPath });
  writeJson(claimQueuePath, claimQueue);
  writeJson(providerQueuePath, { items: [{ providerId: "proposal-provider" }] });
  writeJson(conflictsPath, { summary: { total: 0 }, conflicts: [] });
  const output = buildProviderAutoResolutionProposals({
    claims: claimsPath,
    claimQueue: claimQueuePath,
    providerQueue: providerQueuePath,
    conflicts: conflictsPath
  });

  assert.equal(output.summary.autoDeprioritizeClaims, 0);
  assert.equal(output.autoDeprioritizeProposals.some((proposal) => proposal.field === "name"), false);
  assert.ok(output.manualBatchProposals.some((proposal) => proposal.reviewCategory === "sensitive tag or scope evidence"));
  assert.equal(output.autoDeprioritizeProposals.every((proposal) => proposal.liveMutationAllowed === false), true);
  assert.ok(output.blockedAutomationRules.some((rule) => rule.rule === "sensitive-tags-need-evidence"));
});

test("provider monitor queue turns automated recheck changes into review items", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const watchlistPath = path.join(dir, "watchlist.json");
  const availabilityAuditPath = path.join(dir, "availability-audit.json");
  const recheckPath = path.join(dir, "recheck.json");
  writeJson(providersPath, [
    baseProvider({
      id: "live-provider",
      name: "Live Provider",
      availabilityStatus: "unknown",
      availabilityCheckedAt: "2026-05-01",
      website: "https://example.org/live"
    })
  ]);
  writeJson(watchlistPath, {
    version: 1,
    items: [
      {
        id: "watch-provider",
        name: "Watch Provider",
        type: "psychologist",
        region: "Otago",
        city: "Dunedin",
        url: "https://example.org/watch",
        lastKnownStatus: "unavailable",
        providerCandidate: {
          name: "Watch Provider",
          type: "psychologist",
          region: "Otago",
          city: "Dunedin",
          website: "https://example.org/watch"
        }
      }
    ]
  });
  writeJson(availabilityAuditPath, {
    findings: [
      {
        providerId: "live-provider",
        providerName: "Live Provider",
        rule: "stale-availability",
        severity: "medium",
        issue: "Availability is stale.",
        suggestedAction: "Recheck availability.",
        source: "https://example.org/live"
      }
    ]
  });
  writeJson(recheckPath, {
    checkedAt: "2026-05-26T00:00:00.000Z",
    results: [
      {
        id: "watch-provider",
        name: "Watch Provider",
        sourceKind: "watchlist",
        url: "https://example.org/watch",
        currentStatus: "not_accepting",
        detectedStatus: "possibly_available",
        changed: true,
        evidence: "new client enquiries welcome",
        checkedAt: "2026-05-26T00:00:00.000Z"
      },
      {
        id: "live-provider",
        name: "Live Provider",
        sourceKind: "live-provider",
        url: "https://example.org/live",
        currentStatus: "unknown",
        detectedStatus: "not_accepting",
        changed: true,
        evidence: "not accepting new clients",
        checkedAt: "2026-05-26T00:00:00.000Z"
      }
    ]
  });

  const queue = buildProviderMonitorQueue({
    providers: providersPath,
    watchlist: watchlistPath,
    availabilityAudit: availabilityAuditPath,
    recheckResults: recheckPath,
    now: new Date("2026-05-26T00:00:00.000Z")
  });

  assert.equal(queue.mode, "ongoing-provider-monitor");
  assert.ok(queue.items.some((item) => item.auditRules.includes("watchlist-possibly-available")));
  assert.equal(queue.items[0].reviewPriority, "critical");
  assert.ok(queue.items.every((item) => item.reviewId.startsWith("monitor:")));
  assert.ok(queue.items.every((item) => Array.isArray(item.sourceUrls)));
});

test("regional data-quality report ranks thin regions and aggregates review signals without mutation", () => {
  const strongAucklandProviders = [
    baseProvider({ id: "akl-gp", type: "gp", region: "Auckland", tags: ["gp"], name: "Auckland GP" }),
    baseProvider({ id: "akl-counsellor", type: "counsellor", region: "Auckland", tags: ["counsellor"], name: "Auckland Counsellor" }),
    baseProvider({ id: "akl-psychologist", type: "psychologist", region: "Auckland", tags: ["psychologist"], name: "Auckland Psychologist" }),
    baseProvider({ id: "akl-psychiatrist", type: "psychiatrist", region: "Auckland", tags: ["psychiatrist"], name: "Auckland Psychiatrist" }),
    baseProvider({ id: "akl-youth", type: "youth", region: "Auckland", tags: ["youth"], name: "Auckland Youth" }),
    baseProvider({ id: "akl-addiction", type: "addiction", region: "Auckland", tags: ["addiction"], name: "Auckland Addiction" }),
    baseProvider({
      id: "akl-public",
      type: "public-service",
      region: "Auckland",
      tags: ["public-service", "mental-health"],
      name: "Auckland Community Mental Health"
    })
  ];
  const thinNorthlandProvider = baseProvider({
    id: "northland-gp",
    type: "gp",
    region: "Northland",
    city: "Whangarei",
    name: "Northland GP",
    website: "",
    email: "",
    phone: "09 000 0000",
    address: "1 Bank Street, Whangarei",
    lat: "",
    lon: "",
    source: "https://doctorpricer.co.nz/",
    sourceQuality: "third-party public GP listing",
    importSource: "doctorpricer",
    tags: ["gp"],
    fit: "General practice.",
    firstStep: "Call the practice."
  });
  const providers = [thinNorthlandProvider, ...strongAucklandProviders];
  const before = JSON.stringify(providers);

  const report = buildRegionalDataQualityReport({
    generatedAt: "2026-05-26T00:00:00.000Z",
    providers,
    sourceFitAudit: {
      findings: [
        {
          providerId: "northland-gp",
          providerName: "Northland GP",
          region: "Northland",
          rule: "weak-gp-source",
          severity: "high",
          issue: "Weak GP source."
        }
      ]
    },
    availabilityAudit: {
      findings: [
        {
          providerId: "northland-gp",
          providerName: "Northland GP",
          region: "Northland",
          rule: "blocked-or-unreachable-source",
          severity: "medium"
        }
      ]
    },
    referralAudit: { findings: [] },
    gpCorroborationQueue: {
      tasks: [
        {
          providerId: "northland-gp",
          name: "Northland GP",
          type: "gp",
          region: "Northland",
          priority: "medium"
        }
      ]
    },
    monitorQueue: { items: [] },
    watchlist: { items: [] }
  });

  const northland = report.regions.find((region) => region.region === "Northland");
  const auckland = report.regions.find((region) => region.region === "Auckland");

  assert.equal(JSON.stringify(providers), before, "regional report must not mutate provider input");
  assert.equal(report.safety.noLiveProviderMutation, true);
  assert.ok(northland.priorityScore > auckland.priorityScore);
  assert.equal(northland.priorityLevel, "high");
  assert.equal(northland.qualitySignals.sourceFit.highUnallowlisted, 1);
  assert.equal(northland.qualitySignals.gpCorroborationTasks, 1);
  assert.equal(northland.qualitySignals.missingCoords, 1);
  assert.ok(northland.coverage.missingSignals.includes("local counselling/psychology contact"));
  assert.ok(northland.recommendedActions.some((action) => /Corroborate 1 GP record/.test(action)));
  assert.ok(report.summary.topPriorities.some((item) => item.region === "Northland"));
});
