import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProviders } from "../tools/audit-provider-source-fit.mjs";
import { buildProviderDiscoverySeeds } from "../tools/build-provider-discovery-seeds.mjs";
import { buildProviderReviewQueue } from "../tools/export-provider-review-queue.mjs";
import { buildProviderSuggestions } from "../tools/build-provider-suggestions.mjs";
import { buildRoundOneQueries, buildSnowballQueries, enrichProviderCandidates } from "../tools/enrich-provider-candidates.mjs";
import {
  buildGooglePlacesCandidatesFromResults,
  buildGooglePlacesDiscoveryPlan,
  buildGooglePlacesPlanFromCoordinateGaps,
  buildGooglePlacesPlanFromGpCorroborationQueue,
  candidateFromGooglePlace,
  mergeGooglePlacesCandidates
} from "../tools/discover-google-places-providers.mjs";
import { extractProviderEvidence } from "../tools/lib/provider-evidence-extractor.mjs";
import { fetchPublicSource, isLikelyLoginPage } from "../tools/lib/source-fetcher.mjs";
import { withPsychiatristScopeMetadata } from "../tools/lib/provider-scope.mjs";
import {
  confidenceByField,
  evidenceItem,
  sourceEvidenceShape,
  unique
} from "../tools/lib/provider-evidence-scorer.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "care-finder-discovery-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function claim(field, value, sourceType = "provider_owned", sourceUrl = "https://exampleclinic.nz", excerpt = "") {
  return evidenceItem({
    field,
    value,
    sourceUrl,
    sourceType,
    excerpt: excerpt || `${field}: ${value}`,
    capturedAt: "2026-05-26T00:00:00.000Z",
    confidence: sourceType === "search_result" || sourceType === "linkedIn_public" ? "low" : "high",
    extractor: "test",
    needsManualReview: sourceType === "search_result" || sourceType === "linkedIn_public"
  });
}

function node(candidateId, claims, extras = {}) {
  const byField = confidenceByField(claims);
  const valuesFor = (field) => unique(claims.filter((item) => item.field === field).map((item) => item.value));
  const conflicts = Object.entries(byField)
    .filter(([, value]) => value.conflicts?.length > 1)
    .map(([field, value]) => ({ field, values: value.conflicts }));
  return {
    candidateId,
    possibleProviderIds: extras.possibleProviderIds || [],
    names: valuesFor("name"),
    clinicianNames: valuesFor("clinicianName"),
    practiceNames: valuesFor("practiceName"),
    sourceUrls: unique(claims.map((item) => item.sourceUrl)),
    sourceTypes: unique(claims.map((item) => item.sourceType)),
    addresses: valuesFor("address"),
    phones: valuesFor("phone"),
    emails: valuesFor("email"),
    websites: valuesFor("website"),
    cities: valuesFor("city"),
    regions: valuesFor("region"),
    types: valuesFor("type"),
    claims,
    confidenceByField: byField,
    corroborationScore: extras.corroborationScore ?? 0.6,
    conflicts,
    needsManualReview: true,
    suggestedProviderRecord: {
      id: candidateId,
      name: valuesFor("name")[0] || valuesFor("practiceName")[0] || valuesFor("clinicianName")[0],
      clinicianName: valuesFor("clinicianName")[0] || "",
      practiceName: valuesFor("practiceName")[0] || "",
      type: valuesFor("type")[0] || "",
      region: valuesFor("region")[0] || "",
      city: valuesFor("city")[0] || "",
      address: valuesFor("address")[0] || "",
      phone: valuesFor("phone")[0] || "",
      email: valuesFor("email")[0] || "",
      website: valuesFor("website")[0] || "",
      source: unique(claims.map((item) => item.sourceUrl))[0] || "",
      availabilityStatus: valuesFor("availabilityStatus")[0] || "not_published",
      referralType: valuesFor("referralType")[0] || "",
      tags: valuesFor("tags"),
      advertisedSpecialties: valuesFor("advertisedSpecialties"),
      sourceEvidence: sourceEvidenceShape(claims),
      confidenceByField: byField,
      needsManualVerification: true
    },
    suggestedPatchForExistingProvider: {},
    reviewReasons: extras.reviewReasons || []
  };
}

function suggestionsFor(nodes, providers = []) {
  const dir = tempDir();
  const graphPath = path.join(dir, "graph.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(graphPath, { nodes });
  writeJson(providersPath, providers);
  return buildProviderSuggestions({
    graph: graphPath,
    providers: providersPath,
    jsonOut: path.join(dir, "suggestions.json"),
    csvOut: path.join(dir, "suggestions.csv"),
    mdOut: path.join(dir, "suggestions.md")
  });
}

test("snowball search creates second-round queries from found clinician, practice, address, and domain data", () => {
  const seedQueries = buildRoundOneQueries({
    seedId: "seed-1",
    city: "Whangarei",
    region: "Northland",
    providerType: "psychologist",
    knownClinicianName: "Aroha Smith",
    knownPracticeName: "North Clinic",
    knownAddress: "10 Bank Street Whangarei"
  }).map((item) => item.query);
  assert(seedQueries.some((query) => query.includes("Whangarei psychologist")));
  assert(seedQueries.some((query) => query.includes("site:healthpoint.co.nz")));

  const snowball = buildSnowballQueries({
    clinicianNames: ["Aroha Smith"],
    practiceNames: ["North Clinic"],
    addresses: ["10 Bank Street Whangarei"],
    phones: ["09 123 4567"],
    emails: ["hello@northclinic.nz"],
    websites: ["https://northclinic.nz"],
    cities: ["Whangarei"],
    regions: ["Northland"],
    types: ["psychologist"],
    sourceTypes: ["healthpoint"]
  }, 2).map((item) => item.query);
  assert(snowball.some((query) => query.includes("Aroha Smith North Clinic")));
  assert(snowball.some((query) => query.includes("northclinic.nz Aroha Smith")));
  assert(snowball.some((query) => query.includes("10 Bank Street Whangarei psychologist")));
});

test("LinkedIn public source is corroboration only, not sole source for specialties or availability", () => {
  const output = suggestionsFor([
    node("candidate-linkedin", [
      claim("clinicianName", "Taylor Lee", "linkedIn_public", "https://www.linkedin.com/in/taylor-lee", "Clinical psychologist at Example Clinic"),
      claim("type", "psychologist", "linkedIn_public", "https://www.linkedin.com/in/taylor-lee"),
      claim("advertisedSpecialties", "anxiety", "linkedIn_public", "https://www.linkedin.com/in/taylor-lee"),
      claim("availabilityStatus", "accepting", "linkedIn_public", "https://www.linkedin.com/in/taylor-lee")
    ])
  ]);
  const suggestion = output.suggestions[0];
  assert.equal(suggestion.action, "needs_manual_research");
  assert(suggestion.reviewReasons.some((reason) => /LinkedIn/.test(reason)));
  assert.notEqual(suggestion.suggestedProviderRecord.availabilityStatus, "accepting");
});

test("search-result snippet alone cannot create a live provider suggestion", () => {
  const output = suggestionsFor([
    node("candidate-snippet", [
      claim("name", "Snippet Psychology", "search_result", "https://www.google.com/search?q=snippet", "Snippet Psychology - counsellor in Dunedin"),
      claim("type", "psychologist", "search_result", "https://www.google.com/search?q=snippet")
    ])
  ]);
  assert.equal(output.suggestions[0].action, "needs_manual_research");
});

test("provider-owned page plus directory corroborates contact data", () => {
  const output = suggestionsFor([
    node("candidate-corroborated", [
      claim("name", "Harbour Psychology", "provider_owned", "https://harbourpsych.nz"),
      claim("type", "psychologist", "provider_owned", "https://harbourpsych.nz"),
      claim("phone", "03 555 1111", "provider_owned", "https://harbourpsych.nz"),
      claim("phone", "03 555 1111", "professional_directory", "https://www.psychologytoday.com/nz/counselling/harbour"),
      claim("website", "https://harbourpsych.nz", "provider_owned", "https://harbourpsych.nz")
    ], { corroborationScore: 0.9 })
  ]);
  const suggestion = output.suggestions[0];
  assert.equal(suggestion.action, "add_new_provider");
  assert.equal(suggestion.confidenceByField.phone.confidence, "high");
});

test("conflicting addresses create manual review rather than overwrite", () => {
  const output = suggestionsFor([
    node("candidate-conflict", [
      claim("name", "Conflict Clinic"),
      claim("type", "counsellor"),
      claim("address", "1 Queen Street Auckland", "provider_owned", "https://conflict.nz"),
      claim("address", "2 Queen Street Auckland", "healthpoint", "https://www.healthpoint.co.nz/conflict")
    ])
  ]);
  assert.equal(output.suggestions[0].action, "needs_manual_research");
  assert(output.suggestions[0].conflicts.some((conflict) => conflict.field === "address"));
});

test("candidate identity matching avoids merging different clinicians at the same clinic", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-05-26T00:00:00.000Z",
    seeds: [
      { seedId: "one", knownClinicianName: "Alex One", knownPracticeName: "Shared Clinic", knownWebsite: "https://sharedclinic.nz", knownEmail: "admin@sharedclinic.nz", providerType: "psychologist", region: "Canterbury", city: "Christchurch", priority: 90 },
      { seedId: "two", knownClinicianName: "Blair Two", knownPracticeName: "Shared Clinic", knownWebsite: "https://sharedclinic.nz", knownEmail: "admin@sharedclinic.nz", providerType: "psychologist", region: "Canterbury", city: "Christchurch", priority: 90 }
    ]
  });
  writeJson(providersPath, []);
  const output = await enrichProviderCandidates({
    seedFile,
    providers: providersPath,
    noNetwork: true,
    dryRun: true,
    limit: 2
  });
  assert.equal(output.candidates.length, 2);
  assert.deepEqual(output.candidates.map((candidate) => candidate.clinicianNames[0]).sort(), ["Alex One", "Blair Two"]);
});

test("candidate identity matching treats titled provider names as clinician identities", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-05-26T00:00:00.000Z",
    seeds: [
      { seedId: "one", knownProviderName: "Dr Alex One", knownPracticeName: "Shared Psychiatry", knownEmail: "info@sharedpsychiatry.nz", providerType: "psychiatrist", region: "Auckland", city: "Auckland", priority: 90 },
      { seedId: "two", knownProviderName: "Dr Blair Two", knownPracticeName: "Shared Psychiatry", knownEmail: "info@sharedpsychiatry.nz", providerType: "psychiatrist", region: "Auckland", city: "Auckland", priority: 90 }
    ]
  });
  writeJson(providersPath, []);
  const output = await enrichProviderCandidates({
    seedFile,
    providers: providersPath,
    noNetwork: true,
    dryRun: true,
    limit: 2
  });
  assert.equal(output.candidates.length, 2);
  assert.deepEqual(output.candidates.map((candidate) => candidate.clinicianNames[0]).sort(), ["Dr Alex One", "Dr Blair Two"]);
  assert(output.candidates.every((candidate) => candidate.candidateId.startsWith("clinician-email-domain:")));
});

test("candidate matching does not match every clinician on a shared register domain", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-05-26T00:00:00.000Z",
    seeds: [
      {
        seedId: "one",
        knownProviderName: "Dr Alex One",
        knownSourceUrl: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/1/dr-alex-one",
        knownWebsite: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/1/dr-alex-one",
        providerType: "psychiatrist",
        region: "Auckland",
        city: "Auckland",
        possibleProviderId: "ranzcp-one",
        priority: 90
      }
    ]
  });
  writeJson(providersPath, [
    {
      id: "ranzcp-one",
      name: "Dr Alex One",
      type: "psychiatrist",
      source: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/1/dr-alex-one",
      website: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/1/dr-alex-one"
    },
    {
      id: "ranzcp-two",
      name: "Dr Blair Two",
      type: "psychiatrist",
      source: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/2/dr-blair-two",
      website: "https://www.yourhealthinmind.org/find-a-psychiatrist/profile/2/dr-blair-two"
    }
  ]);
  const output = await enrichProviderCandidates({
    seedFile,
    providers: providersPath,
    noNetwork: true,
    dryRun: true,
    limit: 1
  });
  assert.equal(output.candidates.length, 1);
  assert.deepEqual(output.candidates[0].possibleProviderIds, ["ranzcp-one"]);
});

test("candidate matching does not match unprefixed clinicians sharing a practice email", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-05-26T00:00:00.000Z",
    seeds: [
      {
        seedId: "wood",
        knownProviderName: "Dr Deborah Wood",
        knownEmail: "info@christchurchpsychmed.co.nz",
        knownWebsite: "https://www.christchurchpsychmed.co.nz/about",
        providerType: "psychiatrist",
        region: "Canterbury",
        city: "Christchurch",
        possibleProviderId: "deborah",
        priority: 90
      }
    ]
  });
  writeJson(providersPath, [
    {
      id: "deborah",
      name: "Dr Deborah Wood",
      type: "psychiatrist",
      email: "info@christchurchpsychmed.co.nz",
      website: "https://www.christchurchpsychmed.co.nz/about"
    },
    {
      id: "amanda",
      name: "Amanda Baird",
      type: "psychologist",
      email: "info@christchurchpsychmed.co.nz",
      website: "https://www.christchurchpsychmed.co.nz/about"
    }
  ]);
  const output = await enrichProviderCandidates({
    seedFile,
    providers: providersPath,
    noNetwork: true,
    dryRun: true,
    limit: 1
  });
  assert.equal(output.candidates.length, 1);
  assert.deepEqual(output.candidates[0].possibleProviderIds, ["deborah"]);
});

test("broad psychologist and counsellor tags still require source evidence", () => {
  const report = auditProviders([{
    id: "psych-unsupported",
    name: "Unsupported Psychologist",
    type: "psychologist",
    region: "Auckland",
    city: "Auckland",
    website: "https://example.nz",
    source: "https://example.nz",
    sourceQuality: "provider-owned page",
    tags: ["psychologist", "depression"],
    needScope: [],
    fit: "Provides appointments.",
    firstStep: "Contact the practice."
  }], [], { generatedAt: "2026-05-26T00:00:00.000Z" });
  assert(report.findings.some((finding) => finding.rule === "broad-tag-without-source-support"));
});

test("psychiatrist baselineScope does not become advertisedSpecialties", () => {
  const psychiatrist = withPsychiatristScopeMetadata({
    id: "psych-md",
    name: "Dr Baseline",
    type: "psychiatrist",
    fit: "General psychiatrist.",
    source: "https://examplepsychiatry.nz",
    website: "https://examplepsychiatry.nz",
    specialties: []
  });
  assert(psychiatrist.baselineScope.includes("depression/mood disorders"));
  assert.deepEqual(psychiatrist.advertisedSpecialties, []);
  assert(!psychiatrist.baselineScopeNote.includes("specialises"));
});

test("sexual-harm specialist scope requires explicit source wording before broad ranking", () => {
  const report = auditProviders([{
    id: "sexual-harm-only",
    name: "Sensitive Claims Counselling",
    type: "counsellor",
    region: "Auckland",
    city: "Auckland",
    website: "https://example.nz",
    source: "https://example.nz",
    sourceQuality: "provider-owned page",
    tags: ["counsellor", "sexual-harm", "depression"],
    needScope: [],
    fit: "Rape and sexual abuse counselling. ACC Sensitive Claims counselling for victims and survivors of sexual harm.",
    firstStep: "Contact the practice."
  }], [], { generatedAt: "2026-05-26T00:00:00.000Z" });
  assert(report.findings.some((finding) => finding.rule === "sexual-harm-overbroad"));
});

test("not accepting or waitlist wording creates availability metadata or a watchlist suggestion", () => {
  const claims = extractProviderEvidence({
    html: "<html><body><h1>Closed Clinic</h1><p>We are not currently taking new clients.</p></body></html>",
    url: "https://closedclinic.nz",
    sourceType: "provider_owned",
    type: "psychologist",
    city: "Nelson",
    region: "Nelson Marlborough Tasman",
    capturedAt: "2026-05-26T00:00:00.000Z"
  });
  assert(claims.some((item) => item.field === "availabilityStatus" && item.value === "not_accepting"));
  const output = suggestionsFor([node("candidate-closed", [
    ...claims,
    claim("type", "psychologist"),
    claim("website", "https://closedclinic.nz")
  ])]);
  assert.equal(output.suggestions[0].action, "move_to_watchlist");
});

test("accepting availability is not inferred from silence", () => {
  const claims = extractProviderEvidence({
    html: "<html><body><h1>Quiet Clinic</h1><p>Psychology appointments and therapy.</p></body></html>",
    url: "https://quietclinic.nz",
    sourceType: "provider_owned",
    type: "psychologist",
    capturedAt: "2026-05-26T00:00:00.000Z"
  });
  assert(!claims.some((item) => item.field === "availabilityStatus" && item.value === "accepting"));
});

test("psychiatry self-referral is not inferred from contact details alone", () => {
  const output = suggestionsFor([
    node("candidate-psychiatry-contact", [
      claim("name", "Contact Psychiatry"),
      claim("type", "psychiatrist"),
      claim("phone", "04 555 1212"),
      claim("website", "https://contactpsychiatry.nz"),
      claim("referralType", "self", "search_result", "https://www.google.com/search?q=contact+psychiatry", "Book online")
    ])
  ]);
  const suggestion = output.suggestions[0];
  assert.equal(suggestion.suggestedProviderRecord.referralType, "unknown");
  assert(suggestion.reviewReasons.some((reason) => /self-referral/.test(reason)));
});

test("discovery suggestions feed the provider review queue", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const suggestionsPath = path.join(dir, "suggestions.json");
  writeJson(providersPath, []);
  writeJson(suggestionsPath, suggestionsFor([
    node("candidate-review", [
      claim("name", "Review Clinic"),
      claim("type", "psychologist"),
      claim("phone", "09 222 3333"),
      claim("website", "https://reviewclinic.nz")
    ])
  ]));
  const queue = buildProviderReviewQueue({
    providers: providersPath,
    providerSuggestions: suggestionsPath,
    skipAuditRun: true,
    jsonOut: path.join(dir, "queue.json"),
    csvOut: path.join(dir, "queue.csv"),
    mdOut: path.join(dir, "queue.md")
  });
  assert(queue.items.some((item) => item.reviewId.startsWith("discovery:")));
  const discoveryItem = queue.items.find((item) => item.reviewId.startsWith("discovery:"));
  assert.equal(discoveryItem.reviewCategory, "Discovery: new provider candidate");
  assert.equal(queue.summary.byCategory["Discovery: new provider candidate"], 1);
});

test("generated suggested patches include source evidence", () => {
  const existing = [{
    id: "existing-clinic",
    name: "Existing Clinic",
    type: "psychologist",
    phone: "03 000 0000",
    website: "https://existing.nz",
    source: "https://existing.nz",
    tags: []
  }];
  const output = suggestionsFor([
    node("candidate-existing", [
      claim("name", "Existing Clinic"),
      claim("type", "psychologist"),
      claim("phone", "03 999 9999"),
      claim("website", "https://existing.nz")
    ], { possibleProviderIds: ["existing-clinic"] })
  ], existing);
  const suggestion = output.suggestions[0];
  assert.equal(suggestion.action, "update_existing_provider");
  assert.equal(suggestion.suggestedPatchForExistingProvider.phone, "03 999 9999");
  assert(suggestion.sourceEvidence.contact.length >= 1);
});

test("suggestion building does not mutate providers.json without reviewed apply flow", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const graphPath = path.join(dir, "graph.json");
  const providers = [{ id: "stable", name: "Stable Clinic", type: "psychologist", phone: "01", website: "https://stable.nz" }];
  writeJson(providersPath, providers);
  writeJson(graphPath, { nodes: [node("candidate-stable", [claim("name", "New Clinic"), claim("type", "psychologist"), claim("phone", "02"), claim("website", "https://new.nz")])] });
  const before = fs.readFileSync(providersPath, "utf8");
  buildProviderSuggestions({ graph: graphPath, providers: providersPath });
  const after = fs.readFileSync(providersPath, "utf8");
  assert.equal(after, before);
});

test("fetcher records blocked or skipped pages without guessing", async () => {
  const result = await fetchPublicSource("https://www.google.com/search?q=psychologist");
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.match(result.reason || result.error, /search-result|Search result pages/);
});

test("login detector does not discard provider pages with ordinary login navigation", () => {
  const providerPage = "<html><head><title>Archers Medical Centre | Healthpoint</title></head><body><h1>Archers Medical Centre</h1><a href='/account/login'>Log in</a><p>General practice phone 09 444 9324.</p></body></html>";
  const loginPage = "<html><head><title>Login</title></head><body><h1>Login</h1><form action='/login'><input type='password' name='password'></form></body></html>";
  const challengePage = "<html><body>Please verify you are human before continuing. recaptcha</body></html>";

  assert.equal(isLikelyLoginPage(providerPage, "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/archers-medical-centre/"), false);
  assert.equal(isLikelyLoginPage(loginPage, "https://example.org/login"), true);
  assert.equal(isLikelyLoginPage(challengePage, "https://example.org/provider"), true);
});

test("Google Places discovery plan uses high-priority regions without mutating live providers", () => {
  const dir = tempDir();
  const reportPath = path.join(dir, "regional.json");
  writeJson(reportPath, {
    regions: [
      {
        region: "Northland",
        priorityLevel: "high",
        priorityScore: 140,
        coverage: { gp: 2, counsellor: 1, psychologist: 1, talkingTherapy: 2, psychiatrist: 0, missingSignals: ["local psychiatrist or psychiatry pathway"] },
        qualitySignals: { gpCorroborationTasks: 3 }
      },
      {
        region: "Auckland",
        priorityLevel: "high",
        priorityScore: 171,
        coverage: { gp: 30, counsellor: 5, psychologist: 5, talkingTherapy: 10, psychiatrist: 2, missingSignals: [] },
        qualitySignals: { gpCorroborationTasks: 1 }
      }
    ]
  });
  const plan = buildGooglePlacesDiscoveryPlan({
    regionalReport: reportPath,
    limitRegions: 1,
    limitQueries: 20,
    noNetwork: true
  });
  assert(plan.length > 0);
  assert(plan.every((item) => item.region === "Auckland"));
  assert(plan.some((item) => item.type === "gp"));
  assert(plan.every((item) => item.textQuery.includes("New Zealand")));
});

test("Google Places can build exact-practice plans from the GP corroboration queue", () => {
  const dir = tempDir();
  const queuePath = path.join(dir, "gp-queue.json");
  writeJson(queuePath, {
    tasks: [
      {
        providerId: "gp-north",
        name: "North Clinic",
        type: "gp",
        region: "Northland",
        city: "Whangarei",
        lat: -35.725,
        lon: 174.324,
        phone: "09 111 2222",
        missingFields: ["website"],
        priority: "medium",
        priorityScore: 200,
        reviewReason: "missing website"
      },
      {
        providerId: "gp-auckland",
        name: "Auckland Clinic",
        type: "gp",
        region: "Auckland",
        city: "Auckland",
        phone: "09 333 4444",
        missingFields: ["website"],
        priority: "medium",
        priorityScore: 200
      }
    ]
  });
  const plan = buildGooglePlacesPlanFromGpCorroborationQueue({
    gpCorroborationQueue: queuePath,
    region: "Northland",
    limitQueries: 5
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].targetProviderId, "gp-north");
  assert.equal(plan[0].type, "gp");
  assert.match(plan[0].textQuery, /North Clinic/);
  assert.match(plan[0].textQuery, /09 111 2222/);
  assert.equal(plan[0].radiusMeters, 8000);
});

test("Google Places can build review-gated coordinate-gap plans and skip vague addresses", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  writeJson(providersPath, [
    {
      id: "specific-address",
      name: "Specific Address Service",
      type: "public-service",
      region: "Wellington",
      city: "Wellington",
      address: "Level 2, 10 Example Street, Wellington"
    },
    {
      id: "vague-address",
      name: "Vague Address Service",
      type: "psychologist",
      region: "South Canterbury",
      city: "Timaru",
      address: "Timaru"
    },
    {
      id: "already-geocoded",
      name: "Already Geocoded",
      type: "counsellor",
      region: "Auckland",
      city: "Auckland",
      address: "1 Queen Street, Auckland",
      lat: -36.8485,
      lon: 174.7633
    }
  ]);

  const plan = buildGooglePlacesPlanFromCoordinateGaps({
    providers: providersPath,
    limitQueries: 10
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].targetProviderId, "specific-address");
  assert.equal(plan[0].reviewPurpose, "coordinate-gap");
  assert.match(plan[0].textQuery, /Specific Address Service/);
  assert.match(plan[0].reason, /public address but no coordinates/);
});

test("Google Places result creates a review-gated candidate with no unsupported service claims", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/example",
    displayName: { text: "Harbour Psychology" },
    formattedAddress: "10 Bank Street, Whangarei 0110, New Zealand",
    location: { latitude: -35.72, longitude: 174.32 },
    nationalPhoneNumber: "09 123 4567",
    websiteUri: "https://harbourpsych.nz",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=123",
    types: ["health", "point_of_interest"]
  }, {
    queryId: "places:northland:psychologist",
    textQuery: "psychologist Whangarei Northland New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "psychologist",
    reason: "thin local psychology coverage"
  }, []);
  assert.equal(candidate.reviewGateRequired, true);
  assert.equal(candidate.liveMutationAllowed, false);
  assert.equal(candidate.suggestedProviderRecord.availabilityStatus, "not_published");
  assert.deepEqual(candidate.suggestedProviderRecord.tags, []);
  assert.deepEqual(candidate.suggestedProviderRecord.advertisedSpecialties, []);
  assert(candidate.sourceEvidence.contact.some((item) => item.field === "phone"));
});

test("Google Places coordinate-gap candidates remain tied to the target provider but require review", () => {
  const provider = {
    id: "coordinate-target",
    name: "Coordinate Target",
    type: "public-service",
    region: "Wellington",
    city: "Wellington",
    address: "10 Example Street, Wellington"
  };
  const candidate = candidateFromGooglePlace({
    id: "places/coordinate-target",
    displayName: { text: "Example Street Building" },
    formattedAddress: "10 Example Street, Wellington 6011, New Zealand",
    location: { latitude: -41.2924, longitude: 174.7787 },
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=321",
    types: ["point_of_interest"]
  }, {
    queryId: "places-coordinate-gap:coordinate-target",
    region: "Wellington",
    city: "Wellington",
    type: "public-service",
    textQuery: "Coordinate Target 10 Example Street Wellington New Zealand",
    center: { latitude: -41.2924, longitude: 174.7787 },
    radiusMeters: 12000,
    targetProviderId: "coordinate-target",
    reviewPurpose: "coordinate-gap",
    reason: "Known provider has a public address but no coordinates"
  }, [provider]);

  assert.equal(candidate.action, "corroborate_existing_provider");
  assert.deepEqual(candidate.possibleProviderIds, ["coordinate-target"]);
  assert.ok(candidate.duplicateSignals.includes("coordinate-gap-address-search-needs-review"));
  assert.match(candidate.reviewReasons.join(" "), /Confirm the Places result matches/);
  assert.equal(candidate.suggestedProviderRecord.coordinateSource, "google_places");
  assert.equal(candidate.suggestedProviderRecord.geocodeNeedsManualReview, true);
});

test("Google Places psychiatry query does not label psychology-looking results as psychiatrists", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/dr-mind",
    displayName: { text: "Dr. Mind Psychology" },
    formattedAddress: "3 Diamond Street, Auckland 1021, New Zealand",
    nationalPhoneNumber: "020 440 8080",
    websiteUri: "https://www.drmind.co.nz/",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=456",
    types: ["medical_clinic", "health"]
  }, {
    queryId: "places:auckland:psychiatrist",
    textQuery: "private psychiatrist Auckland Auckland New Zealand",
    region: "Auckland",
    city: "Auckland",
    type: "psychiatrist",
    reason: "thin psychiatry coverage"
  }, []);
  assert.equal(candidate.queryType, "psychiatrist");
  assert.equal(candidate.type, "unknown");
  assert.equal(candidate.suggestedProviderRecord.type, "unknown");
  assert(candidate.reviewReasons.some((reason) => /look like psychologist/i.test(reason)));
  assert(candidate.claims.some((claimItem) => claimItem.field === "queryType" && claimItem.value === "psychiatrist"));
});

test("Google Places keeps explicit psychiatry names as review-gated psychiatry leads", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/northland-psychiatry",
    displayName: { text: "Northland Psychiatry" },
    formattedAddress: "41 Whau Valley Road, Whangarei 0112, New Zealand",
    nationalPhoneNumber: "09 553 3255",
    websiteUri: "https://www.northlandpsychiatry.co.nz/",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=789",
    types: ["medical_clinic", "health"]
  }, {
    queryId: "places:northland:psychiatrist",
    textQuery: "psychiatrist Whangarei Northland New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "psychiatrist",
    reason: "thin psychiatry coverage"
  }, []);
  assert.equal(candidate.queryType, "psychiatrist");
  assert.equal(candidate.type, "psychiatrist");
  assert.equal(candidate.suggestedProviderRecord.referralType, "unknown");
  assert.equal(candidate.suggestedProviderRecord.referralNeedsManualReview, true);
  assert(candidate.reviewReasons.some((reason) => /explicitly mention psychiatrist/i.test(reason)));
});

test("Google Places GP queue candidates keep target provider linkage review-gated", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/gp-target",
    displayName: { text: "North Clinic" },
    formattedAddress: "10 Bank Street, Whangarei 0110, New Zealand",
    nationalPhoneNumber: "09 111 2222",
    websiteUri: "https://northclinic.nz",
    googleMapsUri: "https://maps.google.com/?cid=999",
    types: ["doctor", "health"]
  }, {
    queryId: "places-gp-corroborate:gp-north",
    textQuery: "North Clinic Whangarei 09 111 2222 GP medical centre New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "gp",
    targetProviderId: "gp-north",
    reason: "GP source corroboration task | missing fields: website"
  }, [{
    id: "gp-north",
    name: "North Clinic",
    type: "gp",
    region: "Northland",
    city: "Whangarei",
    phone: "09 111 2222"
  }]);
  assert.equal(candidate.reviewGateRequired, true);
  assert.equal(candidate.liveMutationAllowed, false);
  assert.deepEqual(candidate.possibleProviderIds, ["gp-north"]);
  assert(candidate.reviewReasons.some((reason) => /target GP source-corroboration provider: gp-north/.test(reason)));
  assert.equal(candidate.suggestedProviderRecord.website, "https://northclinic.nz");
  assert.deepEqual(candidate.suggestedProviderRecord.tags, []);
});

test("Google Places GP queue does not link uncorroborated target results", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/wrong-result",
    displayName: { text: "Distant Urgent Care" },
    formattedAddress: "1 Constellation Drive, Auckland 0632, New Zealand",
    location: { latitude: -36.7492, longitude: 174.7285 },
    nationalPhoneNumber: "09 999 0000",
    websiteUri: "https://distanturgentcare.nz",
    googleMapsUri: "https://maps.google.com/?cid=998",
    types: ["doctor", "health"]
  }, {
    queryId: "places-gp-corroborate:gp-nightcaps",
    textQuery: "Nightcaps Medical Centre Nightcaps 03 111 2222 GP medical centre New Zealand",
    region: "Southland",
    city: "Nightcaps",
    type: "gp",
    center: { latitude: -45.9704, longitude: 168.0314 },
    radiusMeters: 8000,
    targetProviderId: "gp-nightcaps",
    reason: "GP source corroboration task"
  }, [{
    id: "gp-nightcaps",
    name: "Nightcaps Medical Centre",
    type: "gp",
    region: "Southland",
    city: "Nightcaps",
    phone: "03 111 2222"
  }]);
  assert.equal(candidate.action, "research_new_provider");
  assert.deepEqual(candidate.possibleProviderIds, []);
  assert.match(candidate.discardReason, /uncorroborated exact Places result/);
});

test("Google Places GP queue filters uncorroborated exact-query results", () => {
  const candidates = buildGooglePlacesCandidatesFromResults([{
    queryItem: {
      queryId: "places-gp-corroborate:gp-nightcaps",
      textQuery: "Nightcaps Medical Centre Nightcaps 03 111 2222 GP medical centre New Zealand",
      region: "Southland",
      city: "Nightcaps",
      type: "gp",
      center: { latitude: -45.9704, longitude: 168.0314 },
      radiusMeters: 8000,
      targetProviderId: "gp-nightcaps",
      reason: "GP source corroboration task"
    },
    places: [{
      id: "places/wrong-result",
      displayName: { text: "Distant Urgent Care" },
      formattedAddress: "1 Constellation Drive, Auckland 0632, New Zealand",
      location: { latitude: -36.7492, longitude: 174.7285 },
      nationalPhoneNumber: "09 999 0000",
      websiteUri: "https://distanturgentcare.nz",
      googleMapsUri: "https://maps.google.com/?cid=998",
      types: ["doctor", "health"]
    }]
  }], [{
    id: "gp-nightcaps",
    name: "Nightcaps Medical Centre",
    type: "gp",
    region: "Southland",
    city: "Nightcaps",
    phone: "03 111 2222"
  }]);
  assert.deepEqual(candidates, []);
});

test("Google Places merge drops stale exact GP candidates matched to a different provider", () => {
  const stale = candidateFromGooglePlace({
    id: "places/tend-constellation",
    displayName: { text: "Tend Constellation Drive Urgent Care Medical Centre" },
    formattedAddress: "1 Constellation Drive, Auckland 0632, New Zealand",
    location: { latitude: -36.7492, longitude: 174.7285 },
    nationalPhoneNumber: "09 999 0000",
    websiteUri: "https://tend.nz",
    googleMapsUri: "https://maps.google.com/?cid=997",
    types: ["doctor", "health"]
  }, {
    queryId: "places:auckland:gp",
    textQuery: "GP Auckland New Zealand",
    region: "Auckland",
    city: "Auckland",
    type: "gp"
  }, [{
    id: "gp-tend-constellation",
    name: "Tend Constellation Drive Urgent Care Medical Centre",
    type: "gp",
    region: "Auckland",
    city: "North Shore",
    phone: "09 999 0000",
    website: "https://tend.nz"
  }]);
  stale.queryId = "places-gp-corroborate:gp-nightcaps";
  stale.region = "Southland";
  stale.city = "Nightcaps";
  stale.reviewReasons.push("target GP source-corroboration provider: gp-nightcaps");
  const merged = mergeGooglePlacesCandidates([stale], []);
  assert.deepEqual(merged, []);
});

test("Google Places matching does not use shared directory domains as broad identity matches", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/healthpoint-target",
    displayName: { text: "Commercial Street Surgery" },
    formattedAddress: "1 Commercial Street, Kawakawa 0210, New Zealand",
    nationalPhoneNumber: "09 404 0885",
    websiteUri: "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/commercial-street-surgery/",
    googleMapsUri: "https://maps.google.com/?cid=1001",
    types: ["doctor", "health"]
  }, {
    queryId: "places-gp-corroborate:gp-commercial",
    textQuery: "Commercial Street Surgery Kawakawa 09 404 0885 GP medical centre New Zealand",
    region: "Northland",
    city: "Kawakawa",
    type: "gp",
    targetProviderId: "gp-commercial",
    reason: "GP source corroboration task"
  }, [
    {
      id: "gp-commercial",
      name: "Commercial Street Surgery",
      type: "gp",
      region: "Northland",
      city: "Kawakawa",
      phone: "09 404 0885",
      source: "https://doctorpricer.co.nz/commercial"
    },
    {
      id: "gp-unrelated-healthpoint",
      name: "Unrelated Clinic",
      type: "gp",
      region: "Auckland",
      city: "Auckland",
      source: "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/unrelated/"
    }
  ]);
  assert.deepEqual(candidate.possibleProviderIds, ["gp-commercial"]);
  assert(!candidate.duplicateSignals.includes("website-domain"));
});

test("Google Places merge scrubs stale shared-directory website matches", () => {
  const stale = candidateFromGooglePlace({
    id: "places/healthpoint-stale",
    displayName: { text: "Commercial Street Surgery" },
    formattedAddress: "1 Commercial Street, Kawakawa 0210, New Zealand",
    nationalPhoneNumber: "09 404 0885",
    websiteUri: "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/commercial-street-surgery/",
    googleMapsUri: "https://maps.google.com/?cid=1002",
    types: ["doctor", "health"]
  }, {
    queryId: "places-gp-corroborate:gp-commercial",
    textQuery: "Commercial Street Surgery Kawakawa 09 404 0885 GP medical centre New Zealand",
    region: "Northland",
    city: "Kawakawa",
    type: "gp",
    targetProviderId: "gp-commercial",
    reason: "GP source corroboration task"
  }, [{
    id: "gp-commercial",
    name: "Commercial Street Surgery",
    type: "gp",
    region: "Northland",
    city: "Kawakawa",
    phone: "09 404 0885"
  }]);
  stale.existingProviderMatches.push({
    providerId: "gp-unrelated-healthpoint",
    name: "Unrelated Clinic",
    type: "gp",
    region: "Auckland",
    city: "Auckland",
    signals: ["website-domain"]
  });
  stale.possibleProviderIds.push("gp-unrelated-healthpoint");
  stale.duplicateSignals.push("website-domain");
  stale.reviewReasons.push("possible existing provider match: gp-commercial, gp-unrelated-healthpoint");
  const [merged] = mergeGooglePlacesCandidates([stale], []);
  assert.deepEqual(merged.possibleProviderIds, ["gp-commercial"]);
  assert(!merged.existingProviderMatches.some((match) => match.providerId === "gp-unrelated-healthpoint"));
  assert(!merged.reviewReasons.some((reason) => /gp-unrelated-healthpoint/.test(reason)));
});

test("Google Places candidate matching flags possible existing providers by website or phone", () => {
  const candidates = buildGooglePlacesCandidatesFromResults([{
    queryItem: {
      queryId: "places:otago:psychologist",
      textQuery: "psychologist Dunedin Otago New Zealand",
      region: "Otago",
      city: "Dunedin",
      type: "psychologist"
    },
    places: [{
      id: "places/existing",
      displayName: { text: "Existing Psychology" },
      formattedAddress: "20 George Street, Dunedin 9016, New Zealand",
      nationalPhoneNumber: "03 555 1111",
      websiteUri: "https://existingpsych.nz",
      googleMapsUri: "https://maps.google.com/?cid=456",
      types: ["health"]
    }]
  }], [{
    id: "existing-provider",
    name: "Existing Psychology",
    type: "psychologist",
    phone: "03 555 1111",
    website: "https://existingpsych.nz",
    address: "20 George Street, Dunedin"
  }]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].action, "corroborate_existing_provider");
  assert.deepEqual(candidates[0].possibleProviderIds, ["existing-provider"]);
  assert(candidates[0].duplicateSignals.includes("phone"));
});

test("Google Places incremental runs can merge existing candidates without replacing them", () => {
  const existing = candidateFromGooglePlace({
    id: "places/existing",
    displayName: { text: "Existing Psychology" },
    formattedAddress: "20 George Street, Dunedin 9016, New Zealand",
    websiteUri: "https://existingpsych.nz",
    googleMapsUri: "https://maps.google.com/?cid=456",
    types: ["health"]
  }, {
    queryId: "places:otago:psychologist",
    textQuery: "psychologist Dunedin Otago New Zealand",
    region: "Otago",
    city: "Dunedin",
    type: "psychologist"
  }, []);
  const fresh = candidateFromGooglePlace({
    id: "places/new",
    displayName: { text: "North Psychiatry" },
    formattedAddress: "1 Bank Street, Whangarei 0110, New Zealand",
    nationalPhoneNumber: "09 222 3333",
    googleMapsUri: "https://maps.google.com/?cid=654",
    types: ["health"]
  }, {
    queryId: "places:northland:psychiatrist",
    textQuery: "psychiatrist Whangarei Northland New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "psychiatrist"
  }, []);
  const merged = mergeGooglePlacesCandidates([existing], [fresh]);
  assert.equal(merged.length, 2);
  assert(merged.some((candidate) => candidate.name === "Existing Psychology"));
  assert(merged.some((candidate) => candidate.name === "North Psychiatry"));
});

test("Google Places merge deduplicates repeated claims and provider matches", () => {
  const candidate = candidateFromGooglePlace({
    id: "places/repeated",
    displayName: { text: "Repeat Medical Centre" },
    formattedAddress: "1 Repeat Street, Auckland 1010, New Zealand",
    nationalPhoneNumber: "09 555 0000",
    websiteUri: "https://repeatmedical.nz",
    googleMapsUri: "https://maps.google.com/?cid=333",
    types: ["doctor", "health"]
  }, {
    queryId: "places-gp-corroborate:gp-repeat",
    textQuery: "Repeat Medical Centre Auckland 09 555 0000 GP medical centre New Zealand",
    region: "Auckland",
    city: "Auckland",
    type: "gp",
    targetProviderId: "gp-repeat",
    reason: "GP source corroboration task"
  }, [{
    id: "gp-repeat",
    name: "Repeat Medical Centre",
    type: "gp",
    region: "Auckland",
    city: "Auckland",
    phone: "09 555 0000"
  }]);
  const [merged] = mergeGooglePlacesCandidates([candidate], [candidate, candidate]);
  assert.equal(merged.existingProviderMatches.length, 1);
  const claimKeys = new Set(merged.claims.map((claim) => `${claim.field}|${claim.value}|${claim.sourceUrl}`));
  assert.equal(merged.claims.length, claimKeys.size);
});

test("Google Places merge flags conflicting query types instead of silently relabelling", () => {
  const psychologyLead = candidateFromGooglePlace({
    id: "places/shared",
    displayName: { text: "Shared Therapy" },
    formattedAddress: "3 Bank Street, Whangarei 0110, New Zealand",
    googleMapsUri: "https://maps.google.com/?cid=111",
    types: ["health"]
  }, {
    queryId: "places:northland:psychologist",
    textQuery: "psychologist Whangarei Northland New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "psychologist"
  }, []);
  const psychiatryLead = candidateFromGooglePlace({
    id: "places/shared",
    displayName: { text: "Shared Therapy" },
    formattedAddress: "3 Bank Street, Whangarei 0110, New Zealand",
    googleMapsUri: "https://maps.google.com/?cid=111",
    types: ["health"]
  }, {
    queryId: "places:northland:psychiatrist",
    textQuery: "psychiatrist Whangarei Northland New Zealand",
    region: "Northland",
    city: "Whangarei",
    type: "psychiatrist"
  }, []);
  const [merged] = mergeGooglePlacesCandidates([psychologyLead], [psychiatryLead]);
  assert.equal(merged.type, "unknown");
  assert.equal(merged.suggestedProviderRecord.type, "unknown");
  assert(merged.reviewReasons.some((reason) => /conflicting Google Places search query types/.test(reason)));
});

test("Google Places candidates become discovery seeds for source corroboration", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const emptyPath = path.join(dir, "empty.json");
  const providerSourcesPath = path.join(dir, "provider-sources.json");
  const placesPath = path.join(dir, "places.json");
  writeJson(providersPath, []);
  writeJson(emptyPath, { findings: [], items: [], queue: [] });
  writeJson(providerSourcesPath, { liveSources: {} });
  writeJson(placesPath, {
    version: 1,
    candidates: [
      candidateFromGooglePlace({
        id: "places/seed",
        displayName: { text: "Seed Psychology" },
        formattedAddress: "2 Bank Street, Whangarei 0110, New Zealand",
        nationalPhoneNumber: "09 111 2222",
        websiteUri: "https://seedpsych.nz",
        googleMapsUri: "https://maps.google.com/?cid=321",
        types: ["health"]
      }, {
        queryId: "places:northland:psychologist",
        textQuery: "psychologist Whangarei Northland New Zealand",
        region: "Northland",
        city: "Whangarei",
        type: "psychologist"
      }, [])
    ]
  });
  const output = buildProviderDiscoverySeeds({
    providers: providersPath,
    providerSources: providerSourcesPath,
    sourceFitAudit: emptyPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath,
    discoveryQueue: emptyPath,
    googlePlacesCandidates: placesPath,
    manualSeeds: path.join(dir, "missing-manual.json")
  });
  const seed = output.seeds.find((item) => item.seedId.startsWith("google-places:"));
  assert.ok(seed);
  assert.equal(output.inputs.googlePlacesCandidates, 1);
  assert.equal(seed.region, "Northland");
  assert.equal(seed.providerType, "psychologist");
  assert.equal(seed.queryType, "psychologist");
  assert.equal(seed.knownWebsite, "https://seedpsych.nz");
  assert.equal(seed.knownSourceUrl, "https://seedpsych.nz");
  assert.match(seed.reason, /corroborate/i);
});

test("Google Places unknown-type psychiatry leads remain fetchable by query type", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const emptyPath = path.join(dir, "empty.json");
  const providerSourcesPath = path.join(dir, "provider-sources.json");
  const placesPath = path.join(dir, "places.json");
  writeJson(providersPath, []);
  writeJson(emptyPath, { findings: [], items: [], queue: [] });
  writeJson(providerSourcesPath, { liveSources: {} });
  writeJson(placesPath, {
    version: 1,
    candidates: [
      candidateFromGooglePlace({
        id: "places/dr-mind",
        displayName: { text: "Dr. Mind Psychology" },
        formattedAddress: "3 Diamond Street, Auckland 1021, New Zealand",
        websiteUri: "https://www.drmind.co.nz/",
        googleMapsUri: "https://maps.google.com/?cid=456",
        types: ["medical_clinic", "health"]
      }, {
        queryId: "places:auckland:psychiatrist",
        textQuery: "private psychiatrist Auckland Auckland New Zealand",
        region: "Auckland",
        city: "Auckland",
        type: "psychiatrist"
      }, [])
    ]
  });
  const output = buildProviderDiscoverySeeds({
    providers: providersPath,
    providerSources: providerSourcesPath,
    sourceFitAudit: emptyPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath,
    discoveryQueue: emptyPath,
    googlePlacesCandidates: placesPath,
    manualSeeds: path.join(dir, "missing-manual.json"),
    type: "psychiatrist"
  });
  const seed = output.seeds.find((item) => item.seedId.startsWith("google-places:"));
  assert.ok(seed);
  assert.equal(seed.providerType, "unknown");
  assert.equal(seed.queryType, "psychiatrist");
  assert.equal(seed.knownWebsite, "https://www.drmind.co.nz/");
});

test("Google Places GP corroboration seeds outrank stale weak GP source records", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const providerSourcesPath = path.join(dir, "provider-sources.json");
  const sourceFitPath = path.join(dir, "source-fit.json");
  const emptyPath = path.join(dir, "empty.json");
  const placesPath = path.join(dir, "places.json");
  writeJson(providersPath, [{
    id: "gp-north",
    name: "North Clinic",
    type: "gp",
    region: "Northland",
    city: "Whangarei",
    phone: "09 111 2222",
    sourceQuality: "third-party public GP listing",
    confidence: "low",
    needsManualVerification: true
  }]);
  writeJson(providerSourcesPath, { liveSources: {} });
  writeJson(sourceFitPath, { findings: [{ providerId: "gp-north", rule: "weak-gp-source", severity: "low", issue: "weak source" }] });
  writeJson(emptyPath, { findings: [], items: [], queue: [] });
  writeJson(placesPath, {
    candidates: [
      candidateFromGooglePlace({
        id: "places/gp-north",
        displayName: { text: "North Clinic" },
        formattedAddress: "1 Bank Street, Whangarei 0110, New Zealand",
        nationalPhoneNumber: "09 111 2222",
        websiteUri: "https://northclinic.nz",
        googleMapsUri: "https://maps.google.com/?cid=1234",
        types: ["doctor", "health"]
      }, {
        queryId: "places-gp-corroborate:gp-north",
        textQuery: "North Clinic Whangarei 09 111 2222 GP medical centre New Zealand",
        region: "Northland",
        city: "Whangarei",
        type: "gp",
        targetProviderId: "gp-north",
        reason: "GP source corroboration task | missing fields: website"
      }, [{ id: "gp-north", name: "North Clinic", type: "gp", phone: "09 111 2222" }])
    ]
  });
  const output = buildProviderDiscoverySeeds({
    providers: providersPath,
    providerSources: providerSourcesPath,
    sourceFitAudit: sourceFitPath,
    availabilityAudit: emptyPath,
    referralAudit: emptyPath,
    reviewQueue: emptyPath,
    discoveryQueue: emptyPath,
    googlePlacesCandidates: placesPath,
    manualSeeds: path.join(dir, "missing-manual.json"),
    region: "Northland",
    type: "gp",
    limit: 2
  });
  assert.equal(output.seeds[0].seedId.startsWith("google-places:"), true);
  assert(output.seeds[0].priority > output.seeds[1].priority);
});

test("seed source fetching inspects provider websites but skips Google Maps sources", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    seeds: [{
      seedId: "google-places:test-provider",
      region: "Northland",
      city: "Whangarei",
      providerType: "psychologist",
      knownProviderName: "Seed Psychology",
      knownWebsite: "https://seedpsych.nz",
      knownSourceUrl: "https://maps.google.com/?cid=321",
      priority: 95,
      reason: "Google Places discovery candidate"
    }]
  });
  writeJson(providersPath, []);

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(`
      <!doctype html>
      <html>
        <head><title>Seed Psychology Whangarei</title></head>
        <body>
          <h1>Seed Psychology</h1>
          <p>Clinical psychologist in Whangarei supporting anxiety and depression.</p>
          <p>Phone 09 123 4567 or email hello@seedpsych.nz.</p>
        </body>
      </html>
    `, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const output = await enrichProviderCandidates({
      seedFile,
      providers: providersPath,
      fetchSeedSources: true,
      maxSeedSources: 1,
      noNetwork: false,
      dryRun: true,
      resolveDns: false,
      rateLimitMs: 0,
      maxRounds: 1,
      limit: 1
    });
    assert.deepEqual(calls, ["https://seedpsych.nz/"]);
    assert.equal(output.stats.seedSourcesChecked, 1);
    assert.equal(output.stats.seedSourcesFetched, 1);
    assert.equal(output.stats.seedSourcesSkipped, 1);
    assert(output.candidates.some((candidate) => candidate.phones.includes("09 123 4567")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Places seed values alone stay manual research until stronger sources are fetched", async () => {
  const dir = tempDir();
  const seedFile = path.join(dir, "seeds.json");
  const providersPath = path.join(dir, "providers.json");
  writeJson(seedFile, {
    generatedAt: "2026-06-01T00:00:00.000Z",
    seeds: [{
      seedId: "google-places:places-only",
      region: "Northland",
      city: "Whangarei",
      providerType: "psychiatrist",
      knownProviderName: "Places Only Psychiatry",
      knownPhone: "09 333 4444",
      knownWebsite: "https://placesonly.example.nz",
      knownSourceUrl: "https://placesonly.example.nz",
      source: "google places candidate export",
      priority: 100,
      reason: "Google Places discovery candidate"
    }]
  });
  writeJson(providersPath, []);
  const output = await enrichProviderCandidates({
    seedFile,
    providers: providersPath,
    noNetwork: true,
    dryRun: true,
    maxRounds: 1,
    limit: 1
  });
  const suggestions = suggestionsFor(output.candidates);
  assert.equal(suggestions.suggestions[0].action, "needs_manual_research");
  assert.match(suggestions.suggestions[0].sourceSummary, /Google Places/);
});

test("provider extraction avoids announcement headings as provider names", () => {
  const claims = extractProviderEvidence({
    url: "http://www.whgcare.org.nz/",
    sourceType: "provider_owned",
    html: `
      <html>
        <head><title>Home - Whangarei Care Centre</title></head>
        <body>
          <h1>Whangarei CARE will be closing its doors shortly</h1>
          <p>Services Counselling Budgeting Advice Seniors Community Work.</p>
          <p>Phone 09 437 6397.</p>
        </body>
      </html>
    `,
    region: "Northland",
    city: "Whangarei",
    type: "counsellor"
  });
  const names = claims.filter((claimItem) => claimItem.field === "name").map((claimItem) => claimItem.value);
  const practiceNames = claims.filter((claimItem) => claimItem.field === "practiceName").map((claimItem) => claimItem.value);
  assert(names.includes("Whangarei Care Centre"));
  assert(practiceNames.includes("Whangarei Care Centre"));
  assert(!names.some((name) => /closing its doors/i.test(name)));
  assert(claims.some((claimItem) => claimItem.field === "availabilityStatus" && claimItem.value === "not_accepting"));
});

test("provider extraction does not merge adjacent clinician names from team lists", () => {
  const claims = extractProviderEvidence({
    url: "https://kinderminds.nz/",
    sourceType: "provider_owned",
    html: `
      <html>
        <head><title>Kinder Minds | Child and Adolescent Psychiatric and Therapeutic Services</title></head>
        <body>
          <h1>Sarah Castle</h1>
          <nav>About Our Mission Who We Are Growing Kinder Minds Meet the Team</nav>
          <section>The Kinder Minds Team Dr Sarah Castle Edoardo Giorgi Neve Kezia Schroyen</section>
          <p>Many of our services can be available via telehealth.</p>
        </body>
      </html>
    `,
    region: "Northland",
    city: "Whangarei",
    type: "psychiatrist"
  });
  assert(claims.some((claimItem) => claimItem.field === "name" && claimItem.value === "Kinder Minds"));
  assert(claims.some((claimItem) => claimItem.field === "practiceName" && claimItem.value === "Kinder Minds"));
  assert(claims.some((claimItem) => claimItem.field === "clinicianName" && claimItem.value === "Dr Sarah Castle"));
  assert(!claims.some((claimItem) => claimItem.field === "clinicianName" && /Edoardo/.test(claimItem.value)));
});

test("Google Places candidates feed the auditor review queue without becoming live providers", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const placesPath = path.join(dir, "places.json");
  const emptyAuditPath = path.join(dir, "empty-audit.json");
  writeJson(providersPath, []);
  writeJson(emptyAuditPath, { findings: [], items: [] });
  writeJson(placesPath, {
    version: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    safety: { noLiveProviderMutation: true, reviewGateRequired: true },
    candidates: [
      candidateFromGooglePlace({
        id: "places/queue",
        displayName: { text: "Queue Psychology" },
        formattedAddress: "1 Bank Street, Whangarei 0110, New Zealand",
        nationalPhoneNumber: "09 765 4321",
        websiteUri: "https://queuepsych.nz",
        googleMapsUri: "https://maps.google.com/?cid=789",
        types: ["health"]
      }, {
        queryId: "places:northland:psychologist",
        textQuery: "psychologist Whangarei Northland New Zealand",
        region: "Northland",
        city: "Whangarei",
        type: "psychologist"
      }, [])
    ]
  });
  const queue = buildProviderReviewQueue({
    providers: providersPath,
    sourceFitAudit: emptyAuditPath,
    availabilityAudit: emptyAuditPath,
    referralAudit: emptyAuditPath,
    watchlist: emptyAuditPath,
    linkResults: path.join(dir, "missing-link-report.json"),
    identityScan: path.join(dir, "missing-identity-scan.json"),
    discoveryQueue: path.join(dir, "missing-discovery.json"),
    providerSuggestions: path.join(dir, "missing-suggestions.json"),
    googlePlacesCandidates: placesPath,
    skipAuditRun: true
  });
  const item = queue.items.find((entry) => entry.reviewId.startsWith("places:"));
  assert.ok(item);
  assert.equal(item.name, "Queue Psychology");
  assert.equal(item.reviewCategory, "Google Places discovery");
  assert.equal(item.auditRules.includes("google-places-candidate"), true);
  assert.match(item.sourceQuality, /Google Places/);
  assert.equal(item.currentProvider, null);
  assert.equal(item.googlePlacesCandidate.claims, undefined);
  assert.equal(item.googlePlacesCandidate.suggestedProviderRecord, undefined);
  assert(item.sourceEvidence.contact.some((evidence) => evidence.field === "phone"));
  assert.equal(queue.inputs.googlePlacesCandidates, 1);
});

test("Google Places coordinate-gap candidates become location review tasks", () => {
  const dir = tempDir();
  const providersPath = path.join(dir, "providers.json");
  const placesPath = path.join(dir, "places.json");
  const emptyAuditPath = path.join(dir, "empty-audit.json");
  const provider = {
    id: "coordinate-target",
    name: "Coordinate Target",
    type: "public-service",
    region: "Wellington",
    city: "Wellington",
    address: "10 Example Street, Wellington",
    phone: "04 123 4567",
    source: "https://example.org/coordinate-target",
    sourceQuality: "provider-owned page",
    confidence: "medium",
    needsManualVerification: true,
    availabilityStatus: "not_published",
    availabilityNeedsManualReview: true,
    tags: [],
    needScope: []
  };
  writeJson(providersPath, [provider]);
  writeJson(emptyAuditPath, { findings: [], items: [] });
  writeJson(placesPath, {
    version: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    safety: { noLiveProviderMutation: true, reviewGateRequired: true },
    candidates: [
      candidateFromGooglePlace({
        id: "places/coordinate-target",
        displayName: { text: "Example Street Building" },
        formattedAddress: "10 Example Street, Wellington 6011, New Zealand",
        location: { latitude: -41.2924, longitude: 174.7787 },
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=321",
        types: ["point_of_interest"]
      }, {
        queryId: "places-coordinate-gap:coordinate-target",
        textQuery: "Coordinate Target 10 Example Street Wellington New Zealand",
        region: "Wellington",
        city: "Wellington",
        type: "public-service",
        center: { latitude: -41.2924, longitude: 174.7787 },
        radiusMeters: 12000,
        targetProviderId: "coordinate-target",
        reviewPurpose: "coordinate-gap",
        reason: "Known provider has a public address but no coordinates"
      }, [provider])
    ]
  });
  const queue = buildProviderReviewQueue({
    providers: providersPath,
    sourceFitAudit: emptyAuditPath,
    availabilityAudit: emptyAuditPath,
    referralAudit: emptyAuditPath,
    watchlist: emptyAuditPath,
    linkResults: path.join(dir, "missing-link-report.json"),
    identityScan: path.join(dir, "missing-identity-scan.json"),
    discoveryQueue: path.join(dir, "missing-discovery.json"),
    providerSuggestions: path.join(dir, "missing-suggestions.json"),
    googlePlacesCandidates: placesPath,
    skipAuditRun: true
  });
  const item = queue.items.find((entry) => entry.reviewId.startsWith("places:"));
  assert.ok(item);
  assert.equal(item.providerId, "coordinate-target");
  assert.equal(item.reviewCategory, "Location and distance evidence");
  assert.equal(item.auditSeverity, "medium");
  assert.equal(item.auditRules.includes("coordinate-gap-candidate"), true);
  assert.match(item.reviewReasons.join(" "), /coordinate-gap/i);
  assert.match(item.suggestedFixes.join(" "), /address\/coordinate metadata/i);
  assert.match(item.sourceQuality, /Google Places/);
  assert.equal(item.correctedFields.lat, -41.2924);
  assert.equal(item.correctedFields.lon, 174.7787);
  assert.equal(item.correctedFields.coordinateSource, "google_places");
  assert.equal(item.correctedFields.geocodeNeedsManualReview, true);
  assert.equal(Object.hasOwn(item.correctedFields, "type"), false);
  assert.equal(item.googlePlacesCandidate.suggestedProviderRecord, undefined);
  assert.equal(queue.inputs.googlePlacesCandidates, 1);
});
