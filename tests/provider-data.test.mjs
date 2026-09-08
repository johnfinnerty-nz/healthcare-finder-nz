import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditAvailability } from "../tools/audit-provider-availability.mjs";
import { auditProviders } from "../tools/audit-provider-source-fit.mjs";
import {
  allowedPsychiatristBaselineScope,
  baselinePsychiatristScopeNote,
  baselinePsychiatristScopeSource
} from "../tools/lib/provider-scope.mjs";

const providers = JSON.parse(fs.readFileSync("providers.json", "utf8"));
const indexHtml = fs.readFileSync("index.html", "utf8");
const publicHtmlPages = [
  "index.html",
  "privacy.html",
  "terms.html",
  "data-sources.html",
  "crisis.html",
  "medium-healthcare-pitfalls.html"
];
const optInPreferenceTags = new Set(["maori", "pasifika", "asian", "rainbow"]);
const broadNeedTags = new Set(["depression", "anxiety", "work", "stress", "relationships", "grief", "addiction"]);
const exactTypes = ["gp", "counsellor", "psychologist", "psychiatrist"];
const localInPersonDistanceCapKm = 30;
const distanceCappedLocalTypes = new Set(["gp", "counsellor", "psychologist", "psychiatrist", "mens-centre"]);
const expectedRegions = [
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
  "Southland"
];

function isDirectoryLike(provider) {
  return provider.type === "directory" || provider.tags?.includes("directory");
}

function hasContact(provider) {
  return Boolean(provider.phone || provider.text || provider.email || provider.website);
}

function isTelehealthProvider(provider) {
  const tags = provider.tags || [];
  if (tags.includes("telehealth") || tags.includes("online")) return true;
  if (provider.onlineAvailable === true) return true;
  if (provider.type === "helpline") return true;
  if (provider.phoneSupport === true && (provider.region === "National" || ["helpline", "addiction", "youth"].includes(provider.type))) return true;
  return provider.region === "National"
    && ["addiction", "youth"].includes(provider.type)
    && Boolean(provider.phone || provider.text || tags.includes("online"));
}

function hasNationalServiceReach(provider) {
  if (provider.region !== "National") return false;
  if (isTelehealthProvider(provider)) return true;
  if (isDirectoryLike(provider)) return true;
  if (provider.type === "helpline") return true;
  return ["addiction", "public-service", "youth"].includes(provider.type)
    && Boolean(provider.phone || provider.text || provider.email || provider.website);
}

function providerCoords(provider) {
  const lat = Number(provider.lat ?? provider.latitude);
  const lon = Number(provider.lon ?? provider.lng ?? provider.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function distanceKm(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function localDistanceAllowed(provider, preferences = [], userCoords = null) {
  if (!userCoords || !distanceCappedLocalTypes.has(provider.type)) return true;
  if (preferences.includes("telehealth") && isTelehealthProvider(provider)) return true;
  const coords = providerCoords(provider);
  if (!coords) return false;
  return distanceKm(userCoords, coords) <= localInPersonDistanceCapKm;
}

function matchesRegion(provider, region, preferences = [], query = "", userCoords = null) {
  if (query) return true;
  if (hasNationalServiceReach(provider)) return true;
  if (preferences.includes("telehealth") && isTelehealthProvider(provider)) return true;
  return provider.region === region && localDistanceAllowed(provider, preferences, userCoords);
}

function selectedProviderGender(preferences) {
  const wantsFemale = preferences.includes("female-provider");
  const wantsMale = preferences.includes("male-provider");
  if (wantsFemale === wantsMale) return "";
  return wantsFemale ? "female" : "male";
}

function providerGender(provider) {
  const explicit = String(provider.providerGender || "").toLowerCase();
  if (explicit === "female" || explicit === "male") return explicit;
  const tags = provider.tags || [];
  if (tags.includes("female") && !tags.includes("male")) return "female";
  if (tags.includes("male") && !tags.includes("female")) return "male";
  return "";
}

function hasGenderConflict(provider, preferences) {
  const wanted = selectedProviderGender(preferences);
  const actual = providerGender(provider);
  return Boolean(wanted && actual && actual !== wanted);
}

function matchesPreferencePrivacy(provider, preferences) {
  const optInTags = (provider.tags || []).filter((tag) => optInPreferenceTags.has(tag));
  return optInTags.length === 0 || optInTags.some((tag) => preferences.includes(tag));
}

function providerMatchesType(provider, type) {
  if (type === "all") return true;
  if (type === "directory") return isDirectoryLike(provider);
  return provider.type === type
    || (type === "counsellor" && provider.type === "mens-centre")
    || (type === "psychiatrist" && provider.tags?.includes("psychiatry-service"))
    || (type === "addiction" && provider.tags?.includes("addiction"));
}

function providerNeedScope(provider) {
  if (Array.isArray(provider.needScope) && provider.needScope.length) return provider.needScope;
  if (provider.tags?.includes("sexual-harm") && !provider.tags.some((tag) => broadNeedTags.has(tag))) return ["trauma"];
  if ((provider.type === "addiction" || (provider.type === "helpline" && provider.tags?.includes("addiction"))) && !["depression", "anxiety", "trauma", "work"].some((tag) => provider.tags?.includes(tag))) return ["addiction"];
  return [];
}

function matchesSelectedNeeds(provider, needs) {
  const scope = providerNeedScope(provider);
  return !scope.length || !needs.length || scope.some((need) => needs.includes(need));
}

function visibleMatches({ region, type = "all", preferences = [], needs = [], query = "", userCoords = null }) {
  const normalisedQuery = query.trim().toLowerCase();
  return providers.filter((provider) => {
    const text = [
      provider.name,
      provider.type,
      provider.region,
      provider.city,
      provider.address,
      provider.cost,
      provider.fit,
      provider.firstStep,
      ...(provider.tags || [])
    ].join(" ").toLowerCase();

    return providerMatchesType(provider, type)
      && matchesRegion(provider, region, preferences, normalisedQuery, userCoords)
      && (!normalisedQuery || text.includes(normalisedQuery))
      && matchesPreferencePrivacy(provider, preferences)
      && !hasGenderConflict(provider, preferences)
      && (Boolean(normalisedQuery) || matchesSelectedNeeds(provider, needs))
      && !provider.tags?.includes("crisis")
      && !isDirectoryLike(provider)
      && hasContact(provider);
  });
}

test("provider data validation script passes", () => {
  execFileSync(process.execPath, ["tools/validate-provider-data.mjs"], { stdio: "pipe" });
});

test("provider source-fit audit passes without unallowlisted high-severity findings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-source-fit-"));
  execFileSync(process.execPath, [
    "tools/audit-provider-source-fit.mjs",
    "providers.json",
    "--allowlist",
    "data/provider-source-fit-allowlist.json",
    "--json-out",
    path.join(tempDir, "provider-source-fit-audit.json"),
    "--md-out",
    path.join(tempDir, "PROVIDER_SOURCE_FIT_AUDIT.md")
  ], { stdio: "pipe" });

  const report = JSON.parse(fs.readFileSync(path.join(tempDir, "provider-source-fit-audit.json"), "utf8"));
  assert.equal(report.summary.highUnallowlisted, 0);
  assert.ok(report.summary.total >= 1, "audit should keep reporting reviewable source-fit findings");
});

test("directory records are website-only navigation, not direct first-contact providers", () => {
  const unsafeDirectories = providers
    .filter((provider) => provider.type === "directory")
    .filter((provider) => provider.phone || provider.text || provider.email || provider.bookingUrl);
  const directProvidersTaggedDirectory = providers
    .filter((provider) => provider.type !== "directory" && provider.tags?.includes("directory"));

  assert.deepEqual(unsafeDirectories.map((provider) => provider.id), []);
  assert.deepEqual(directProvidersTaggedDirectory.map((provider) => provider.id), []);
});

test("psychiatrist records separate baseline scope from advertised interests", () => {
  const psychiatrists = providers.filter((provider) => provider.type === "psychiatrist");
  assert.ok(psychiatrists.length > 0);

  const invalid = psychiatrists.filter((provider) =>
    !Array.isArray(provider.baselineScope)
    || !provider.baselineScope.length
    || provider.baselineScope.some((scope) => !allowedPsychiatristBaselineScope.has(scope))
    || provider.baselineScopeSource !== baselinePsychiatristScopeSource
    || provider.baselineScopeNote !== baselinePsychiatristScopeNote
    || !Array.isArray(provider.advertisedSpecialties)
    || !Array.isArray(provider.advertisedSpecialtyEvidence)
    || !provider.specialtyTagsSource
  ).map((provider) => provider.id);

  assert.deepEqual(invalid, []);

  const withoutAdvertisedInterests = psychiatrists.find((provider) => !provider.specialties?.length);
  assert.ok(withoutAdvertisedInterests, "fixture should include at least one psychiatrist without listed interests");
  assert.deepEqual(withoutAdvertisedInterests.advertisedSpecialties, []);
  assert.equal(withoutAdvertisedInterests.advertisedSpecialtyEvidence.length, 0);
});

test("public app wording does not present psychiatrist baseline scope as advertised specialty", () => {
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /providerSpecialtyLabel\(provider\)/);
  assert.match(script, /Listed interests/);
  assert.match(script, /baseline medical-specialist scope/);
  assert.doesNotMatch(script, /provider\.type === "psychiatrist"[\s\S]{0,140}<strong>Specialties:<\/strong>/);
});

test("source-fit audit keeps psychiatrist baseline separate from unsupported source-backed claims", () => {
  const base = {
    id: "fixture",
    name: "Fixture",
    type: "psychiatrist",
    region: "Auckland",
    city: "Auckland",
    source: "https://example.org/provider",
    website: "https://example.org/provider",
    sourceQuality: "provider-owned page",
    cost: "Private fees",
    fit: "Psychiatrist profile with public contact details.",
    firstStep: "Ask your GP about referral.",
    tags: ["psychiatrist"],
    needScope: [],
    baselineScope: ["depression/mood disorders"],
    baselineScopeSource: baselinePsychiatristScopeSource,
    baselineScopeNote: baselinePsychiatristScopeNote,
    advertisedSpecialties: [],
    advertisedSpecialtyEvidence: [],
    specialtyTagsSource: "no advertised specialties recorded",
    phone: "09 000 0000"
  };

  const baselineOnly = auditProviders([base]).findings;
  assert.equal(baselineOnly.some((finding) => finding.rule === "broad-tag-without-source-support"), false);

  const unsupportedPsychiatristTag = auditProviders([{
    ...base,
    id: "unsupported-psychiatrist-tag",
    tags: ["psychiatrist", "depression"]
  }]).findings;
  assert.equal(unsupportedPsychiatristTag.some((finding) => finding.rule === "broad-tag-without-source-support"), true);

  const unsupportedAdvertised = auditProviders([{
    ...base,
    id: "unsupported-advertised",
    advertisedSpecialties: ["Depression"],
    advertisedSpecialtyEvidence: [{ sourceUrl: base.source, excerpt: "Manual claim", confidence: "low" }]
  }]).findings;
  assert.equal(unsupportedAdvertised.some((finding) => finding.rule === "advertised-specialty-without-source-support" && finding.severity === "high"), true);

  const unsupportedAdvertisedWithBroadTag = auditProviders([{
    ...base,
    id: "unsupported-advertised-broad-tag",
    tags: ["psychiatrist", "depression"],
    advertisedSpecialties: ["Depression"],
    advertisedSpecialtyEvidence: [{ sourceUrl: base.source, excerpt: "Manual claim", confidence: "low" }]
  }]).findings;
  assert.equal(unsupportedAdvertisedWithBroadTag.some((finding) => finding.rule === "advertised-specialty-without-source-support" && finding.severity === "high"), true);
  assert.equal(unsupportedAdvertisedWithBroadTag.some((finding) => finding.rule === "broad-tag-without-source-support"), true);

  const unsupportedPsychologistTag = auditProviders([{
    ...base,
    id: "unsupported-psychologist-tag",
    type: "psychologist",
    tags: ["psychologist", "depression"],
    baselineScope: []
  }]).findings;
  assert.equal(unsupportedPsychologistTag.some((finding) => finding.rule === "broad-tag-without-source-support"), true);
});

test("provider availability audit passes without unallowlisted high-severity findings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-availability-"));
  execFileSync(process.execPath, [
    "tools/audit-provider-availability.mjs",
    "providers.json",
    "--allowlist",
    "data/provider-availability-allowlist.json",
    "--json-out",
    path.join(tempDir, "provider-availability-audit.json"),
    "--md-out",
    path.join(tempDir, "AVAILABILITY_RECHECK_REPORT.md")
  ], { stdio: "pipe" });

  const report = JSON.parse(fs.readFileSync(path.join(tempDir, "provider-availability-audit.json"), "utf8"));
  assert.equal(report.summary.highUnallowlisted, 0);
  assert.ok(report.providersScanned >= providers.length);
});

test("psychiatrist referral audit passes and psychiatrist records carry referral metadata", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "psychiatrist-referrals-"));
  execFileSync(process.execPath, [
    "tools/audit-psychiatrist-referrals.mjs",
    "providers.json",
    "--json-out",
    path.join(tempDir, "provider-psychiatrist-referral-audit.json"),
    "--md-out",
    path.join(tempDir, "PSYCHIATRIST_REFERRAL_AUDIT.md")
  ], { stdio: "pipe" });

  const report = JSON.parse(fs.readFileSync(path.join(tempDir, "provider-psychiatrist-referral-audit.json"), "utf8"));
  assert.equal(report.summary.high, 0);

  const psychiatryRecords = providers.filter((provider) => provider.type === "psychiatrist" || provider.tags?.includes("psychiatry-service"));
  assert.ok(psychiatryRecords.length > 0);
  assert.deepEqual(psychiatryRecords.filter((provider) =>
    typeof provider.requiresReferral !== "boolean"
    || !["gp", "self", "specialist", "unknown"].includes(provider.referralType)
    || !provider.referralSourceUrl
    || !provider.referralSourceExcerpt
    || !["high", "medium", "low"].includes(provider.referralConfidence)
    || !/^\d{4}-\d{2}/.test(provider.referralLastChecked || "")
    || typeof provider.referralNeedsManualReview !== "boolean"
  ).map((provider) => provider.id), []);
});

test("availability audit catches stale or unsafe availability metadata", () => {
  const baseProvider = {
    id: "availability-sample",
    name: "Availability Sample",
    type: "psychologist",
    region: "Auckland",
    city: "Auckland",
    phone: "09 000 0000",
    email: "hello@example.org",
    website: "https://example.org",
    cost: "Private fees apply.",
    tags: ["psychologist", "direct-contact"],
    fit: "Psychology service.",
    firstStep: "Ask about fit.",
    source: "https://example.org",
    verified: "2026-05",
    lastVerified: "2026-05",
    confidence: "medium",
    sourceQuality: "provider-owned page",
    needsManualVerification: true,
    needScope: []
  };

  const report = auditAvailability({
    generatedAt: "2026-05-25T00:00:00.000Z",
    providers: [
      {
        ...baseProvider,
        id: "accepting-without-evidence",
        availabilityStatus: "accepting",
        availabilityCheckedAt: "2026-05-20",
        availabilityEvidence: "",
        availabilitySource: "https://example.org"
      },
      {
        ...baseProvider,
        id: "stale-not-accepting",
        availabilityStatus: "not_accepting",
        availabilityCheckedAt: "2026-04-01",
        availabilityEvidence: "Currently not accepting new clients",
        availabilitySource: "https://example.org",
        availabilityNeedsManualReview: true
      },
      {
        ...baseProvider,
        id: "contradictory-status",
        availabilityStatus: "not_published",
        availabilityCheckedAt: "2026-05-20",
        availabilityEvidence: "Referrals are paused.",
        availabilitySource: "https://example.org",
        availabilityNeedsManualReview: true
      },
      {
        ...baseProvider,
        id: "directory-accepting",
        type: "directory",
        tags: ["directory"],
        availabilityStatus: "accepting",
        availabilityCheckedAt: "2026-05-20",
        availabilityEvidence: "Accepting new clients",
        availabilitySource: "https://example.org"
      }
    ],
    allowlistEntries: []
  });

  const rules = report.findings.map((finding) => `${finding.providerId}:${finding.rule}:${finding.severity}`);
  assert.ok(rules.includes("accepting-without-evidence:accepting-without-explicit-evidence:high"));
  assert.ok(rules.includes("stale-not-accepting:stale-availability:high"));
  assert.ok(rules.includes("contradictory-status:restrictive-evidence-status-mismatch:high"));
  assert.ok(rules.includes("directory-accepting:directory-marked-accepting:high"));
  assert.equal(report.summary.highUnallowlisted, 5);
});

test("availability audit uses fresh watchlist rechecks without inferring availability", () => {
  const watchlistItem = {
    id: "watchlist-sample",
    name: "Watchlist Sample",
    type: "psychologist",
    region: "Northland",
    city: "Whangarei",
    url: "https://example.org/watchlist",
    availabilityStatus: "not_accepting",
    availabilityCheckedAt: "2026-05-01",
    providerCandidate: {
      id: "watchlist-sample",
      name: "Watchlist Sample",
      type: "psychologist",
      region: "Northland",
      city: "Whangarei"
    }
  };

  const confirmedReport = auditAvailability({
    generatedAt: "2026-06-12T00:00:00.000Z",
    providers: [],
    watchlistItems: [watchlistItem],
    recheckResults: [
      {
        id: "watchlist-sample",
        name: "Watchlist Sample",
        type: "psychologist",
        region: "Northland",
        city: "Whangarei",
        url: "https://example.org/watchlist",
        checkedAt: "2026-06-12T00:00:00.000Z",
        currentStatus: "not_accepting",
        detectedStatus: "not_accepting",
        changed: false
      }
    ]
  });

  assert.equal(confirmedReport.summary.highUnallowlisted, 0);
  assert.equal(confirmedReport.findings.some((finding) => finding.rule === "stale-watchlist-availability"), false);

  const ambiguousReport = auditAvailability({
    generatedAt: "2026-06-12T00:00:00.000Z",
    providers: [],
    watchlistItems: [watchlistItem],
    recheckResults: [
      {
        id: "watchlist-sample",
        name: "Watchlist Sample",
        type: "psychologist",
        region: "Northland",
        city: "Whangarei",
        url: "https://example.org/watchlist",
        checkedAt: "2026-06-12T00:00:00.000Z",
        currentStatus: "not_accepting",
        detectedStatus: "unknown",
        changed: false
      }
    ]
  });

  const rules = ambiguousReport.findings.map((finding) => `${finding.providerId}:${finding.rule}:${finding.severity}`);
  assert.ok(rules.includes("watchlist-sample:watchlist-availability-not-confirmed:medium"));
  assert.equal(ambiguousReport.summary.highUnallowlisted, 0);
});

test("source-fit audit catches known unsafe provider patterns", () => {
  const baseProvider = {
    id: "sample",
    name: "Sample Provider",
    type: "psychologist",
    region: "Auckland",
    city: "Auckland",
    address: "",
    phone: "09 000 0000",
    text: "",
    email: "",
    website: "https://example.org",
    cost: "Ask about fees.",
    tags: ["psychologist", "direct-contact"],
    fit: "Public listing.",
    firstStep: "Ask about fit.",
    source: "https://example.org",
    verified: "2026-05",
    lastVerified: "2026-05",
    confidence: "medium",
    sourceQuality: "provider-owned page",
    needsManualVerification: true,
    needScope: []
  };

  const report = auditProviders([
    {
      ...baseProvider,
      id: "bad-sexual-harm",
      tags: ["psychologist", "sexual-harm", "sensitive-claims", "depression", "direct-contact"],
      fit: "Rape and sexual abuse counselling. ACC Sensitive Claims counselling for victims and survivors of sexual harm.",
      needScope: []
    },
    {
      ...baseProvider,
      id: "bad-rehab",
      tags: ["psychologist", "rehabilitation", "acc", "concussion", "depression", "anxiety", "direct-contact"],
      fit: "ACC rehabilitation, concussion, pain, and return to work assessment.",
      needScope: []
    },
    {
      ...baseProvider,
      id: "bad-national-clinician",
      region: "National",
      city: "Aotearoa New Zealand",
      tags: ["psychologist", "depression", "direct-contact"],
      fit: "In-person psychology practice.",
      needScope: []
    },
    {
      ...baseProvider,
      id: "bad-directory",
      type: "directory",
      tags: ["directory", "direct-contact"],
      fit: "Directory of services.",
      website: "https://example.org/directory",
      phone: "09 111 1111",
      email: "hello@example.org",
      needScope: []
    },
    {
      ...baseProvider,
      id: "supported-telepsychiatry",
      type: "psychiatrist",
      tags: ["psychiatrist", "telehealth", "direct-contact"],
      fit: "The professional profile says this clinician offers telepsychiatry.",
      needScope: []
    }
  ], [], { generatedAt: "2026-05-25T00:00:00.000Z" });

  const rules = report.findings.map((finding) => `${finding.providerId}:${finding.rule}:${finding.severity}`);
  assert.ok(rules.includes("bad-sexual-harm:sexual-harm-overbroad:high"));
  assert.ok(rules.includes("bad-rehab:narrow-rehab-overbroad-tags:high"));
  assert.ok(rules.includes("bad-national-clinician:national-clinician-no-telehealth:high"));
  assert.ok(rules.includes("bad-directory:directory-treated-direct:high"));
  assert.equal(rules.some((rule) => rule.startsWith("supported-telepsychiatry:weak-telehealth-evidence:")), false);
  assert.equal(report.summary.highUnallowlisted, 4);
});

test("source-fit allowlist suppresses reviewed high-severity exceptions only", () => {
  const report = auditProviders([
    {
      id: "reviewed-directory",
      name: "Reviewed Directory",
      type: "directory",
      region: "National",
      city: "Aotearoa New Zealand",
      phone: "0800 000 000",
      email: "",
      website: "https://example.org/directory",
      tags: ["directory"],
      needScope: [],
      source: "https://example.org/directory"
    }
  ], [{
    id: "reviewed-directory",
    rule: "directory-treated-direct",
    reason: "Navigation phone retained but UI treats this as a directory.",
    reviewedBy: "test",
    reviewedDate: "2026-05-25",
    expiryDate: "2026-08-25"
  }], { generatedAt: "2026-05-25T00:00:00.000Z" });

  assert.equal(report.summary.high, 1);
  assert.equal(report.summary.highUnallowlisted, 0);
  assert.equal(report.summary.allowlisted, 1);
});

test("all current region filters have useful visible direct contacts", () => {
  for (const region of expectedRegions) {
    assert.ok(visibleMatches({ region }).length >= 5, `${region} should have at least five visible direct contacts`);
  }
});

test("location filtering only returns the selected region or confirmed national-reach providers", () => {
  for (const region of expectedRegions) {
    const offRegion = visibleMatches({ region })
      .filter((provider) => provider.region !== region && !hasNationalServiceReach(provider))
      .map((provider) => `${provider.id}:${provider.region}`);

    assert.deepEqual(offRegion, []);
  }

  assert.equal(visibleMatches({ region: "South Canterbury" }).some((provider) => provider.id === "canterbury-mens-centre"), false);
});

test("individual psychologists are not treated as nationally available without confirmed telehealth", () => {
  const alex = providers.find((provider) => provider.id === "nzccp-alex-richards");
  assert.ok(alex);
  assert.equal(alex.region, "Canterbury");
  assert.equal(isTelehealthProvider(alex), false);
  assert.equal(hasNationalServiceReach(alex), false);

  const westCoastPsychologists = visibleMatches({
    region: "West Coast",
    type: "psychologist",
    needs: ["depression"]
  });

  assert.equal(westCoastPsychologists.some((provider) => provider.id === "nzccp-alex-richards"), false);
});

test("exact professional filters do not substitute unrelated provider types", () => {
  for (const region of ["Auckland", "Canterbury", "Otago", "Wellington"]) {
    for (const type of exactTypes) {
      const matches = visibleMatches({ region, type });
      assert.ok(matches.length > 0, `${region} should have at least one ${type} or valid counsellor adjunct result`);
      const invalid = matches.filter((provider) => {
        if (type === "counsellor") return !["counsellor", "mens-centre"].includes(provider.type);
        if (type === "psychiatrist") return provider.type !== "psychiatrist" && !provider.tags?.includes("psychiatry-service");
        return provider.type !== type;
      });
      assert.deepEqual(invalid.map((provider) => `${provider.id}:${provider.type}`), []);
    }
  }
});

test("psychiatrist filters may include specialist public psychiatry services but not unrelated contacts", () => {
  for (const region of ["Rotorua and Taupo", "Tairawhiti", "Taranaki", "Wairarapa"]) {
    const matches = visibleMatches({ region, type: "psychiatrist" });
    assert.ok(matches.length > 0, `${region} should have a psychiatrist or specialist psychiatry-service pathway`);
    const unrelated = matches.filter((provider) =>
      provider.type !== "psychiatrist" && !provider.tags?.includes("psychiatry-service")
    );
    assert.deepEqual(unrelated.map((provider) => `${provider.id}:${provider.type}`), []);
  }
});

test("Dr Rachel Kan is marked as GP-referral first, not direct-contact first", () => {
  const provider = providers.find((item) => item.id === "ranzcp-6009");
  assert.ok(provider);
  assert.equal(provider.name, "Dr Rachel Kan");
  assert.equal(provider.requiresReferral, true);
  assert.equal(provider.referralType, "gp");
  assert.equal(provider.referralConfidence, "high");
  assert.equal(provider.referralNeedsManualReview, false);
  assert.match(provider.referralSourceUrl, /yourhealthinmind\.org\/find-a-psychiatrist\/profile\/6009/);
  assert.match(provider.firstStep, /Book with your GP/i);
  assert.doesNotMatch(provider.firstStep, /^Email the practice/i);
});

test("Christchurch PsychMed psychiatrist records require GP referral while psychologists remain direct enquiry", () => {
  const psychiatristIds = [
    "christchurch-psychmed-deborah-wood",
    "christchurch-psychmed-laura-hammersley",
    "christchurch-psychmed-nicholas-pascoe",
    "christchurch-psychmed-samantha-chow",
    "christchurch-psychmed-sue-luty"
  ];

  for (const id of psychiatristIds) {
    const provider = providers.find((item) => item.id === id);
    assert.ok(provider, id);
    assert.equal(provider.type, "psychiatrist");
    assert.equal(provider.requiresReferral, true);
    assert.equal(provider.referralType, "gp");
    assert.match(provider.referralSourceUrl, /christchurchpsychmed\.co\.nz\/helpful-info/);
    assert.match(provider.firstStep, /^Book with your GP/i);
  }

  for (const id of ["christchurch-psychmed-amanda-baird", "christchurch-psychmed-natasha-pomeroy", "christchurch-psychmed-steve-humm"]) {
    const provider = providers.find((item) => item.id === id);
    assert.ok(provider, id);
    assert.equal(provider.type, "psychologist");
    assert.equal(provider.requiresReferral, undefined);
    assert.match(provider.firstStep, /^Email or call Christchurch PsychMed/i);
  }
});

test("opt-in cultural providers stay hidden unless selected", () => {
  const general = visibleMatches({ region: "Auckland", type: "counsellor" });
  const asianSelected = visibleMatches({ region: "Auckland", type: "counsellor", preferences: ["asian"] });

  assert.equal(general.some((provider) => provider.id === "national-asian-family-services"), false);
  assert.equal(asianSelected.some((provider) => provider.id === "national-asian-family-services"), true);
});

test("Gisborne psychologist coverage uses approved local records and excludes corrected LaNae Fisk location", () => {
  const gisborne = { lat: -38.6623, lon: 178.0176 };
  const psychologists = visibleMatches({
    region: "Tairawhiti",
    type: "psychologist",
    needs: ["depression"],
    userCoords: gisborne
  });
  const ids = psychologists.map((provider) => provider.id);

  assert.equal(ids.includes("tairawhiti-the-therapy-space"), true);
  assert.equal(ids.includes("tairawhiti-wellmind-psychology"), true);
  assert.equal(ids.includes("tairawhiti-nelson-clinic-nadine-von-rothkirch"), true);
  assert.equal(ids.includes("tairawhiti-lanae-fisk-psychology"), false);

  const lanae = providers.find((provider) => provider.id === "tairawhiti-lanae-fisk-psychology");
  assert.ok(lanae);
  assert.equal(lanae.region, "Canterbury");
  assert.equal(lanae.city, "Christchurch");
  assert.equal(lanae.needsManualVerification, true);
  assert.match(lanae.fit, /corrected from Gisborne to Christchurch/i);
});

test("Whangarei depression flow has local direct GP, counselling, psychology, and psychiatry options", () => {
  const whangarei = { lat: -35.7251, lon: 174.3237 };
  const profile = {
    region: "Northland",
    needs: ["depression"],
    preferences: [],
    userCoords: whangarei
  };

  const gps = visibleMatches({ ...profile, type: "gp" });
  assert.equal(gps.some((provider) => provider.id === "gp-west-end-medical-centre-whang-rei-35-7311-174-3107"), true);
  assert.equal(gps.some((provider) => provider.id === "gp-kensington-health-35-7100-174-3138"), true);

  const counsellors = visibleMatches({ ...profile, type: "counsellor" });
  assert.equal(counsellors.some((provider) => provider.id === "northland-michael-streifler-counselling"), true);
  assert.equal(counsellors.some((provider) => provider.id === "northland-steven-smithson-counselling"), true);

  const psychologists = visibleMatches({ ...profile, type: "psychologist" });
  assert.equal(psychologists.some((provider) => provider.id === "northland-hagan-provan-psychology-services"), true);
  assert.equal(psychologists.some((provider) => provider.id === "northland-maria-rotella-clinical-psychologist"), true);

  const psychiatrists = visibleMatches({ ...profile, type: "psychiatrist" });
  assert.equal(psychiatrists.some((provider) => provider.id === "ranzcp-5542"), true);
  assert.equal(psychiatrists.some((provider) => provider.id === "northland-healthnz-adult-community-mha"), true);
});

test("male and female provider preferences are implemented as mutually exclusive controls", () => {
  assert.match(indexHtml, /value="female-provider"/);
  assert.match(indexHtml, /value="male-provider"/);
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /function enforceExclusiveProviderGenderPreference/);
  assert.match(script, /"female-provider": "male-provider"/);
  assert.match(script, /"male-provider": "female-provider"/);
  assert.match(script, /function providerGenderFor/);
  assert.match(script, /providerGender/);
});

test("Christchurch psychologist gender metadata uses explicit source-backed providerGender fields", () => {
  const expected = new Map([
    ["nzccp-aimee-hanson", "female"],
    ["nzccp-alex-mortlock", "male"],
    ["christchurch-psychmed-steve-humm", "male"],
    ["christchurch-psychmed-natasha-pomeroy", "female"]
  ]);

  for (const [id, gender] of expected.entries()) {
    const provider = providers.find((item) => item.id === id);
    assert.ok(provider, id);
    assert.equal(provider.providerGender, gender, id);
    assert.match(provider.providerGenderSource, /^https:\/\//, id);
    assert.match(provider.providerGenderEvidence, /public profile/i, id);
  }

  const invalid = providers
    .filter((provider) => provider.providerGender)
    .filter((provider) => !["female", "male"].includes(provider.providerGender));
  assert.deepEqual(invalid, []);
});

test("address suggestions require explicit selection", () => {
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /function renderAddressSuggestions/);
  assert.match(script, /activeAddressSuggestionIndex = -1;/);
  assert.match(script, /Choose one to use it/);
  assert.doesNotMatch(script, /pause to use the best match/i);
  assert.doesNotMatch(script, /resolveAddressFromInput/);
  assert.doesNotMatch(script, /Checking the best New Zealand match/);
});

test("public app sanitises provider-controlled links and CSS class tokens", () => {
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /function safeMailAddress/);
  assert.match(script, /function safeClassToken/);
  assert.ok(script.includes(".replace(/(?!^)\\+/g, \"\")"));
  assert.match(script, /const email = safeMailAddress\(target\.email\);/);
  assert.match(script, /mailto:\$\{email\}\?subject=/);
  assert.doesNotMatch(script, /mailto:\$\{target\.email\}/);
  assert.match(script, /provider-card--availability-\$\{safeClassToken\(availabilityStatus\)\}/);
  assert.match(script, /availability-note--\$\{safeClassToken\(availabilityStatus\)\}/);
  assert.match(script, /recommendation-card--availability-\$\{safeClassToken\(availabilityStatus\)\}/);
});

test("admin review UI keeps dynamic classes token-safe", () => {
  const admin = fs.readFileSync("admin/admin.js", "utf8");
  assert.match(admin, /function safeClassName/);
  assert.match(admin, /priority \$\{safeClassName\(item\.reviewPriority\)\}/);
  assert.match(admin, /capture-status \$\{safeClassName\(sourceCaptureStatus\(item\)\)\}/);
  assert.match(admin, /section\.className = `finding \$\{safeClassName\(finding\.severity \|\| ""\)\}`;/);
});

test("provider discovery queue script covers the Wikipedia populated-place source and official search APIs", () => {
  const discoveryScript = fs.readFileSync("tools/build-provider-discovery-queue.mjs", "utf8");
  assert.match(discoveryScript, /List_of_populated_places_in_New_Zealand/);
  assert.match(discoveryScript, /provider-search-queue\.json/);
  assert.match(discoveryScript, /GOOGLE_CSE_ID/);
  assert.match(discoveryScript, /BING_WEB_SEARCH_KEY/);
  assert.match(discoveryScript, /do not scrape blocked search result HTML/i);
});

test("provider type icon assets cover all contact types and fill the badge bubble", () => {
  const script = fs.readFileSync("script.js", "utf8");
  const css = fs.readFileSync("styles.css", "utf8");
  for (const icon of ["helpline.svg", "mens-centre.svg", "directory.svg", "youth.svg", "addiction.svg", "public-mental-health.svg"]) {
    assert.match(script, new RegExp(`assets/provider-icons/${icon}`));
    assert.ok(fs.existsSync(`assets/provider-icons/${icon}`), icon);
  }
  assert.match(css, /provider-type-badge img[\s\S]*width:\s*95%/);
  assert.match(css, /provider-type-badge img[\s\S]*transform:\s*scale\(1\.8\)/);
});

test("Golden Bay counselling does not treat Blenheim as a local in-person match", () => {
  const goldenBayCoords = { lat: -40.8564, lon: 172.8069 };
  const rosemary = providers.find((provider) => provider.id === "marlborough-rosemary-crockett-counselling");
  assert.ok(rosemary);
  assert.equal(rosemary.city, "Blenheim");
  assert.ok(distanceKm(goldenBayCoords, providerCoords(rosemary)) > 100);

  const localMatches = visibleMatches({
    region: "Nelson Marlborough Tasman",
    type: "counsellor",
    needs: ["anxiety"],
    userCoords: goldenBayCoords
  });
  assert.equal(localMatches.some((provider) => provider.id === rosemary.id), false);

  const telehealthMatches = visibleMatches({
    region: "Nelson Marlborough Tasman",
    type: "counsellor",
    needs: ["anxiety"],
    preferences: ["telehealth"],
    userCoords: goldenBayCoords
  });
  assert.equal(telehealthMatches.some((provider) => provider.id === rosemary.id), true);
});

test("region match alone does not override the 30 km local in-person cap", () => {
  const userCoords = { lat: -40.8564, lon: 172.8069 };
  const farInPerson = {
    id: "far-in-person",
    name: "Far In Person",
    type: "psychologist",
    region: "Nelson Marlborough Tasman",
    city: "Blenheim",
    lat: -41.51603,
    lon: 173.9528,
    tags: ["psychologist", "depression", "direct-contact"],
    phone: "03 000 0000"
  };
  const farTelehealth = {
    ...farInPerson,
    id: "far-telehealth",
    tags: ["psychologist", "depression", "direct-contact", "telehealth"],
    onlineAvailable: true
  };
  const missingCoords = {
    ...farInPerson,
    id: "missing-coords",
    lat: "",
    lon: ""
  };

  assert.equal(matchesRegion(farInPerson, "Nelson Marlborough Tasman", [], "", userCoords), false);
  assert.equal(matchesRegion(farTelehealth, "Nelson Marlborough Tasman", ["telehealth"], "", userCoords), true);
  assert.equal(matchesRegion(missingCoords, "Nelson Marlborough Tasman", [], "", userCoords), false);
});

test("telehealth psychologist preference has multiple direct online options", () => {
  const matches = visibleMatches({
    region: "Otago",
    type: "psychologist",
    preferences: ["telehealth"]
  }).filter((provider) => provider.region === "National" && provider.tags?.includes("telehealth"));

  assert.ok(matches.length >= 3, "telehealth psychologist searches should not collapse to one online clinician");
});

test("telehealth preference can use online providers outside the entered region", () => {
  const matches = visibleMatches({
    region: "West Coast",
    type: "psychiatrist",
    preferences: ["telehealth"]
  });

  assert.ok(matches.some((provider) => provider.id === "bay-of-plenty-anteris-private-psychiatry"));
});

test("Xtrapsychplus is scoped to sexual harm counselling, not broad psychology", () => {
  const provider = providers.find((item) => item.id === "northland-xtrapsychplus");
  assert.ok(provider);
  assert.equal(provider.type, "counsellor");
  assert.equal(provider.phone, "");
  assert.equal(provider.address, "");
  assert.equal(provider.tags.includes("psychologist"), false);
  assert.equal(provider.tags.includes("neuropsychology"), false);
  assert.deepEqual(provider.needScope, ["trauma"]);
  assert.equal(/neuropsychology|psychological services|mental injury/i.test(provider.fit), false);
  assert.match(provider.fit, /sexual harm counselling/i);
});

test("clinician-led practice records can display the clinician above the practice", () => {
  const provider = providers.find((item) => item.id === "hawkes-bay-alive-psychology");
  assert.ok(provider);
  assert.equal(provider.clinicianName, "Bhavna Nagar");
  assert.equal(provider.practiceName, "Alive! Psychological Services");
  assert.equal(provider.email, "bhavna@alivepsych.co.nz");
});

test("rehabilitation psychology is scoped away from general low-mood searches", () => {
  const provider = providers.find((item) => item.id === "west-coast-proactive-greymouth-psychology");
  assert.ok(provider);
  assert.equal(provider.type, "psychologist");
  assert.deepEqual(provider.needScope, ["work"]);
  assert.equal(provider.tags.includes("depression"), false);
  assert.equal(provider.tags.includes("anxiety"), false);
  assert.match(provider.fit, /occupational health and rehabilitation/i);
  assert.equal(/general mental health psychology/i.test(provider.fit), false);
});

test("need-scoped sexual harm services do not rank for unrelated concern selections", () => {
  const anxietyMatches = visibleMatches({
    region: "Northland",
    type: "counsellor",
    needs: ["anxiety"]
  });
  const traumaMatches = visibleMatches({
    region: "Northland",
    type: "counsellor",
    needs: ["trauma"]
  });

  assert.equal(anxietyMatches.some((provider) => provider.id === "northland-xtrapsychplus"), false);
  assert.equal(traumaMatches.some((provider) => provider.id === "northland-xtrapsychplus"), true);
});

test("need-scoped rehabilitation services do not rank for unrelated low-mood searches", () => {
  const depressionMatches = visibleMatches({
    region: "West Coast",
    type: "psychologist",
    needs: ["depression"]
  });
  const workMatches = visibleMatches({
    region: "West Coast",
    type: "psychologist",
    needs: ["work"]
  });

  assert.equal(depressionMatches.some((provider) => provider.id === "west-coast-proactive-greymouth-psychology"), false);
  assert.equal(workMatches.some((provider) => provider.id === "west-coast-proactive-greymouth-psychology"), true);
});

test("provider records used for contact have safe public contact fields", () => {
  const missing = providers
    .filter((provider) => !isDirectoryLike(provider))
    .filter((provider) => !hasContact(provider))
    .map((provider) => provider.id);

  assert.deepEqual(missing, []);
});

test("every provider has launch verification metadata", () => {
  const missing = providers
    .filter((provider) => !provider.source || !provider.confidence || !provider.sourceQuality || !provider.lastVerified || typeof provider.needsManualVerification !== "boolean" || !Array.isArray(provider.needScope))
    .map((provider) => provider.id);

  const invalidConfidence = providers
    .filter((provider) => !["high", "medium", "low"].includes(provider.confidence))
    .map((provider) => `${provider.id}:${provider.confidence}`);

  const missingAvailability = providers
    .filter((provider) => !provider.availabilityStatus || !provider.availabilityCheckedAt || !provider.availabilitySource || typeof provider.availabilityNeedsManualReview !== "boolean")
    .map((provider) => provider.id);

  const invalidAvailability = providers
    .filter((provider) => !["accepting", "waitlist", "not_accepting", "referrals_paused", "unknown", "not_published"].includes(provider.availabilityStatus))
    .map((provider) => `${provider.id}:${provider.availabilityStatus}`);

  assert.deepEqual(missing, []);
  assert.deepEqual(invalidConfidence, []);
  assert.deepEqual(missingAvailability, []);
  assert.deepEqual(invalidAvailability, []);
});

test("privacy, disclaimer, correction, and crisis links are visible from the home page", () => {
  for (const href of ["privacy.html", "terms.html", "data-sources.html", "crisis.html"]) {
    assert.match(indexHtml, new RegExp(`href="${href}"`));
  }

  assert.match(indexHtml, /Report a correction/i);
  assert.match(indexHtml, /In development/i);
  assert.doesNotMatch(indexHtml, /Soft launch pilot/i);
  assert.match(indexHtml, /Provider database last updated/i);
});

test("public pages do not load the removed Shielded Site button assets", () => {
  for (const pagePath of publicHtmlPages) {
    const html = fs.readFileSync(pagePath, "utf8");
    assert.doesNotMatch(html, /shielded-site/i, `${pagePath} should not load Shielded Site button assets`);
    assert.doesNotMatch(html, /shielded\.co\.nz/i, `${pagePath} should not link the Shielded Site button`);
  }
});

test("provider data audit workflow keeps API secrets out of pull-request jobs", () => {
  const workflow = fs.readFileSync(".github/workflows/provider-data-audit.yml", "utf8");
  const refreshStep = workflow.match(/- name: Refresh approved provider data[\s\S]*?run: node tools\/refresh-provider-database\.mjs/)?.[0] || "";
  const beforeRefresh = workflow.slice(0, workflow.indexOf("- name: Refresh approved provider data"));

  assert.doesNotMatch(beforeRefresh, /HEALTHPOINT_API_(?:URL|TOKEN)/, "PR-run validation/test steps must not inherit Healthpoint secrets");
  assert.match(refreshStep, /if: github\.event_name != 'pull_request'/);
  assert.match(refreshStep, /HEALTHPOINT_API_URL: \$\{\{ secrets\.HEALTHPOINT_API_URL \}\}/);
  assert.match(refreshStep, /HEALTHPOINT_API_TOKEN: \$\{\{ secrets\.HEALTHPOINT_API_TOKEN \}\}/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /Upload provider source-fit audit[\s\S]{0,120}if: always\(\)/, "PR artifacts should not upload untrusted generated files unconditionally");
});
