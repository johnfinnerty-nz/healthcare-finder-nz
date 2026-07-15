import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildProviderDiscoverySeeds } from "./build-provider-discovery-seeds.mjs";
import { fetchPublicSource } from "./lib/source-fetcher.mjs";
import { extractProviderEvidence, extractFromSearchResult } from "./lib/provider-evidence-extractor.mjs";
import {
  compact,
  confidenceByField,
  detectConflicts,
  emailDomain,
  evidenceItem,
  identityKeyFromSignals,
  identitySignalsFromClaims,
  likelySameProvider,
  normaliseComparable,
  scoreEvidence,
  slugify,
  sourceDomain,
  sourceEvidenceShape,
  sourceTypeFromUrl,
  unique
} from "./lib/provider-evidence-scorer.mjs";

const DEFAULTS = {
  maxRounds: 3,
  maxResultsPerQuery: 10,
  rateLimitMs: 1500,
  fetchSeedSources: false,
  maxSeedSources: 25,
  seedFile: "data/discovery/provider-discovery-seeds.json",
  providers: "providers.json",
  candidatesOut: "data/discovery/provider-candidates.json",
  graphOut: "data/discovery/provider-evidence-graph.json",
  reportOut: "data/discovery/provider-discovery-report.md",
  rootReportOut: "PROVIDER_DISCOVERY_REPORT.md",
  limit: Infinity,
  noNetwork: false,
  dryRun: false,
  useGoogleApi: false,
  useBingApi: false
};

const TYPE_QUERY_TERMS = {
  psychologist: ["psychologist NZ", "clinical psychologist NZ"],
  counsellor: ["counselling NZ", "therapist counselling NZ"],
  psychiatrist: ["psychiatrist NZ", "private psychiatry NZ"],
  gp: ["GP doctors medical centre NZ", "general practice family doctor NZ"],
  addiction: ["addiction counselling NZ", "alcohol drug gambling support NZ"],
  youth: ["youth mental health counselling NZ", "rangatahi mental health support NZ"],
  "public-service": ["mental health support service NZ"],
  directory: ["mental health directory NZ"]
};

const SITE_SEARCHES = [
  "site:healthpoint.co.nz",
  "site:nzccp.co.nz",
  "site:yourhealthinmind.org",
  "site:psychologytoday.com/nz",
  "site:linkedin.com/in",
  "site:linkedin.com/company"
];

function parseArgs(argv = process.argv.slice(2)) {
  const config = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--max-rounds") config.maxRounds = Number(argv[++index]);
    else if (arg === "--max-results-per-query") config.maxResultsPerQuery = Number(argv[++index]);
    else if (arg === "--rate-limit-ms") config.rateLimitMs = Number(argv[++index]);
    else if (arg === "--region") config.region = argv[++index];
    else if (arg === "--type") config.type = argv[++index];
    else if (arg === "--seed-file") config.seedFile = argv[++index];
    else if (arg === "--providers") config.providers = argv[++index];
    else if (arg === "--limit") config.limit = Number(argv[++index]);
    else if (arg === "--dry-run") config.dryRun = true;
    else if (arg === "--no-network") config.noNetwork = true;
    else if (arg === "--fetch-seed-sources") config.fetchSeedSources = true;
    else if (arg === "--max-seed-sources") config.maxSeedSources = Number(argv[++index]);
    else if (arg === "--use-google-api") config.useGoogleApi = true;
    else if (arg === "--use-bing-api") config.useBingApi = true;
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

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shouldFetchSeedSource(url = "") {
  const domain = sourceDomain(url);
  if (!domain) return false;
  if (/(^|\.)google\.|(^|\.)bing\.|(^|\.)duckduckgo\.com$|(^|\.)linkedin\.com$|(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(domain)) return false;
  return /^https?:\/\//i.test(url);
}

function rawSeedSourceUrls(seed = {}) {
  return unique([seed.knownWebsite, seed.knownSourceUrl])
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

function seedSourceUrls(seed = {}) {
  return rawSeedSourceUrls(seed)
    .filter(shouldFetchSeedSource);
}

function typeTerms(type) {
  return TYPE_QUERY_TERMS[type] || TYPE_QUERY_TERMS.counsellor;
}

function primaryName(seed = {}) {
  return seed.knownClinicianName || seed.knownPracticeName || seed.knownProviderName || "";
}

function cityOrRegion(seed = {}) {
  return seed.city || seed.suburb || seed.region || "New Zealand";
}

export function buildRoundOneQueries(seed = {}) {
  const queries = new Set();
  const city = cityOrRegion(seed);
  const type = seed.providerType || seed.type || "";
  const name = primaryName(seed);
  const practice = seed.knownPracticeName || seed.knownProviderName || "";
  const clinician = seed.knownClinicianName || "";

  for (const term of typeTerms(type)) {
    queries.add(`${city} ${term}`);
  }

  if (seed.knownProviderName) queries.add(`${seed.knownProviderName} ${city}`);
  if (clinician) queries.add(`${clinician} ${type || "mental health"} NZ`);
  if (practice) queries.add(`${practice} ${city}`);
  if (seed.knownAddress) queries.add(`${seed.knownAddress} psychologist counselling`);

  for (const siteSearch of SITE_SEARCHES) {
    if (clinician) queries.add(`${siteSearch} ${clinician}`);
    else if (practice) queries.add(`${siteSearch} ${practice} ${city}`);
    else if (name) queries.add(`${siteSearch} ${name}`);
    else queries.add(`${siteSearch} ${city} ${type || "mental health"}`);
  }

  return [...queries]
    .map((query) => ({
      query: cleanQuery(query),
      round: 1,
      seedId: seed.seedId || "",
      reason: seed.reason || "seed search",
      region: seed.region || "",
      city: seed.city || "",
      type
    }))
    .filter((item) => item.query.length > 4);
}

export function buildSnowballQueries(candidate = {}, round = 2) {
  const queries = new Set();
  const clinician = candidate.clinicianNames?.[0] || "";
  const practice = candidate.practiceNames?.[0] || candidate.names?.[0] || "";
  const city = candidate.cities?.[0] || candidate.regions?.[0] || "New Zealand";
  const address = candidate.addresses?.[0] || "";
  const phone = candidate.phones?.[0] || "";
  const email = candidate.emails?.[0] || "";
  const website = candidate.websites?.[0] || "";
  const type = candidate.types?.[0] || "mental health";
  const domain = website ? sourceDomain(website) || website : "";
  const emailHost = emailDomain(email);
  const healthpointTitle = candidate.sourceTypes?.includes("healthpoint") ? practice || clinician : "";
  const registerTitle = candidate.sourceTypes?.some((sourceType) => ["official_register", "professional_directory"].includes(sourceType))
    ? clinician || practice
    : "";
  const linkedInRole = candidate.sourceTypes?.includes("linkedIn_public") ? clinician || practice : "";

  if (clinician && practice) queries.add(`${clinician} ${practice}`);
  if (clinician) queries.add(`${clinician} ${city}`);
  if (clinician) queries.add(`${clinician} ${type} NZ`);
  if (practice && address) queries.add(`${practice} ${address}`);
  if (phone && practice) queries.add(`${phone} ${practice}`);
  if (emailHost && clinician) queries.add(`${emailHost} ${clinician}`);
  if (domain && clinician) queries.add(`${domain} ${clinician}`);
  if (address) queries.add(`${address} ${type}`);
  if (healthpointTitle) queries.add(`${healthpointTitle} provider website`);
  if (linkedInRole) queries.add(`${linkedInRole} clinic website`);
  if (registerTitle) queries.add(`${registerTitle} clinic website`);

  return [...queries]
    .map((query) => ({
      query: cleanQuery(query),
      round,
      seedId: candidate.seedIds?.[0] || "",
      reason: "snowball from discovered provider details",
      region: candidate.regions?.[0] || "",
      city: candidate.cities?.[0] || "",
      type: candidate.types?.[0] || ""
    }))
    .filter((item) => item.query.length > 4);
}

function inferClinicianName(name = "", type = "") {
  if (!["psychiatrist", "psychologist"].includes(type)) return "";
  const firstPart = String(name || "").split(/,|\s+-\s+/)[0].trim();
  if (/^(dr|prof|associate professor|mr|mrs|ms|miss)\b/i.test(firstPart)) return firstPart;
  if (!/\b(clinic|centre|center|service|services|group|trust|health|psychology|psychiatry|therapy|counselling|counseling|medical|programme|program)\b/i.test(firstPart)
    && /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,4}$/.test(firstPart)) return firstPart;
  return "";
}

function seedClaims(seed = {}) {
  const capturedAt = new Date().toISOString();
  const sourceUrl = seed.knownSourceUrl || seed.knownWebsite || "";
  const providerType = seed.providerType || seed.type || "";
  const clinicianName = seed.knownClinicianName || inferClinicianName(seed.knownProviderName, providerType);
  const sourceType = /google places/i.test(`${seed.source || ""} ${seed.reason || ""} ${seed.seedId || ""}`)
    ? "google_places"
    : sourceTypeFromUrl(sourceUrl);
  const base = {
    sourceUrl,
    sourceType,
    capturedAt,
    extractor: "provider-discovery-seed",
    confidence: sourceUrl ? "low" : "low",
    needsManualReview: true
  };
  const claims = [];
  const add = (field, value) => {
    if (!value) return;
    claims.push(evidenceItem({
      ...base,
      field,
      value,
      excerpt: `Seed value from ${seed.source || "discovery seed"}: ${value}`
    }));
  };
  add("name", seed.knownProviderName);
  add("clinicianName", clinicianName);
  add("practiceName", seed.knownPracticeName);
  add("address", seed.knownAddress);
  add("phone", seed.knownPhone);
  add("email", seed.knownEmail);
  add("website", seed.knownWebsite);
  add("source", seed.knownSourceUrl);
  add("city", seed.city);
  add("region", seed.region);
  add("type", providerType);
  return claims;
}

function valuesFor(claims, field) {
  return unique(claims.filter((claim) => claim.field === field).map((claim) => claim.value));
}

function bestValue(confidence, claims, field) {
  const values = valuesFor(claims, field);
  if (!values.length) return "";
  const fieldInfo = confidence[field];
  if (fieldInfo?.values?.length === 1) return fieldInfo.values[0];
  const sorted = claims
    .filter((claim) => claim.field === field)
    .sort((a, b) => scoreEvidence(b) - scoreEvidence(a));
  return sorted[0]?.value || values[0];
}

function nodeFromClaims(candidateId, claims = [], extra = {}) {
  const confidence = confidenceByField(claims);
  const conflicts = detectConflicts(confidence);
  const sourceUrls = unique(claims.map((claim) => claim.sourceUrl));
  const sourceTypes = unique(claims.map((claim) => claim.sourceType));
  const sourceCount = sourceUrls.filter(Boolean).length;
  const highOrMedium = claims.filter((claim) => ["high", "medium"].includes(confidenceByField([claim])[claim.field]?.confidence)).length;
  const corroborationScore = Number(Math.min(1, (sourceCount * 0.18) + (highOrMedium * 0.04)).toFixed(2));
  const reviewReasons = [];
  if (!sourceUrls.some(Boolean)) reviewReasons.push("candidate has no source URL yet");
  if (sourceTypes.every((type) => type === "search_result" || type === "linkedIn_public" || type === "unknown")) {
    reviewReasons.push("candidate is based only on discovery or corroboration signals");
  }
  if (conflicts.length) reviewReasons.push(`conflicting ${conflicts.map((conflict) => conflict.field).join(", ")} values`);
  if (!valuesFor(claims, "phone").length && !valuesFor(claims, "email").length && !valuesFor(claims, "website").length && !valuesFor(claims, "bookingUrl").length) {
    reviewReasons.push("no direct public contact found");
  }

  const suggestedProviderRecord = {
    id: `candidate-${slugify(bestValue(confidence, claims, "clinicianName") || bestValue(confidence, claims, "practiceName") || bestValue(confidence, claims, "name") || candidateId).slice(0, 72)}`,
    name: bestValue(confidence, claims, "name") || bestValue(confidence, claims, "practiceName") || bestValue(confidence, claims, "clinicianName"),
    clinicianName: bestValue(confidence, claims, "clinicianName"),
    practiceName: bestValue(confidence, claims, "practiceName"),
    type: bestValue(confidence, claims, "type"),
    region: bestValue(confidence, claims, "region"),
    city: bestValue(confidence, claims, "city"),
    address: bestValue(confidence, claims, "address"),
    phone: bestValue(confidence, claims, "phone"),
    text: bestValue(confidence, claims, "text"),
    email: bestValue(confidence, claims, "email"),
    website: bestValue(confidence, claims, "website"),
    bookingUrl: bestValue(confidence, claims, "bookingUrl"),
    source: sourceUrls.find(Boolean) || "",
    sourceQuality: sourceTypes.join(", "),
    confidence: Object.values(confidence).some((item) => item.confidence === "high") ? "medium" : "low",
    needsManualVerification: true,
    verified: "",
    lastVerified: "",
    availabilityStatus: bestValue(confidence, claims, "availabilityStatus") || "not_published",
    availabilityEvidence: claims.find((claim) => claim.field === "availabilityStatus")?.excerpt || "",
    availabilitySource: claims.find((claim) => claim.field === "availabilityStatus")?.sourceUrl || "",
    availabilityNeedsManualReview: true,
    onlineAvailable: valuesFor(claims, "tags").some((tag) => ["telehealth", "online"].includes(tag)),
    phoneSupport: valuesFor(claims, "tags").includes("phone-support"),
    inPerson: Boolean(bestValue(confidence, claims, "address")),
    crisisOnly: valuesFor(claims, "tags").includes("crisis"),
    tags: valuesFor(claims, "tags"),
    advertisedSpecialties: valuesFor(claims, "advertisedSpecialties"),
    specialties: valuesFor(claims, "advertisedSpecialties"),
    services: valuesFor(claims, "services"),
    patientGroups: valuesFor(claims, "patientGroups"),
    ageGroups: valuesFor(claims, "ageGroups"),
    needScope: valuesFor(claims, "needScope"),
    cost: bestValue(confidence, claims, "cost"),
    sourceEvidence: sourceEvidenceShape(claims),
    confidenceByField: confidence
  };

  return {
    candidateId,
    possibleProviderIds: extra.possibleProviderIds || [],
    seedIds: extra.seedIds || [],
    names: valuesFor(claims, "name"),
    clinicianNames: valuesFor(claims, "clinicianName"),
    practiceNames: valuesFor(claims, "practiceName"),
    sourceUrls,
    sourceTypes,
    addresses: valuesFor(claims, "address"),
    phones: valuesFor(claims, "phone"),
    emails: valuesFor(claims, "email"),
    websites: valuesFor(claims, "website"),
    cities: valuesFor(claims, "city"),
    regions: valuesFor(claims, "region"),
    types: valuesFor(claims, "type"),
    claims,
    confidenceByField: confidence,
    corroborationScore,
    conflicts,
    needsManualReview: true,
    suggestedProviderRecord,
    suggestedPatchForExistingProvider: {},
    reviewReasons: unique([...reviewReasons, ...(extra.reviewReasons || [])])
  };
}

function wouldMergeDifferentClinicians(node, signals) {
  const existingClinicians = new Set((node.clinicianNames || []).map(normaliseComparable).filter(Boolean));
  const incomingClinicians = (signals.clinicianNames || []).map(normaliseComparable).filter(Boolean);
  if (!existingClinicians.size || !incomingClinicians.length) return false;
  return incomingClinicians.some((name) => !existingClinicians.has(name));
}

function findExistingNode(graph, signals) {
  const key = identityKeyFromSignals(signals);
  if (graph.has(key)) return key;

  for (const [candidateId, node] of graph.entries()) {
    if (wouldMergeDifferentClinicians(node, signals)) continue;
    const nodeSignals = identitySignalsFromClaims(node.claims);
    const incoming = {
      id: candidateId,
      name: node.names?.[0] || "",
      clinicianName: node.clinicianNames?.[0] || "",
      practiceName: node.practiceNames?.[0] || "",
      phone: node.phones?.[0] || "",
      email: node.emails?.[0] || "",
      website: node.websites?.[0] || node.sourceUrls?.[0] || "",
      source: node.sourceUrls?.[0] || ""
    };
    if (likelySameProvider(incoming, signals) || identityKeyFromSignals(nodeSignals) === key) return candidateId;
  }

  return key;
}

function matchExistingProviders(claims, providers = []) {
  const signals = identitySignalsFromClaims(claims);
  return providers
    .filter((provider) => likelySameProvider(provider, signals))
    .map((provider) => provider.id)
    .slice(0, 5);
}

function mergeClaims(graph, claims, context = {}, providers = []) {
  if (!claims.length) return null;
  const signals = identitySignalsFromClaims(claims);
  const candidateId = findExistingNode(graph, signals);
  const existing = graph.get(candidateId);
  const mergedClaims = existing ? [...existing.claims, ...claims] : claims;
  const possibleProviderIds = unique([
    ...(existing?.possibleProviderIds || []),
    context.possibleProviderId,
    ...matchExistingProviders(claims, providers)
  ]);
  const node = nodeFromClaims(candidateId, mergedClaims, {
    possibleProviderIds,
    seedIds: unique([...(existing?.seedIds || []), context.seedId]),
    reviewReasons: context.reviewReasons || []
  });
  graph.set(candidateId, node);
  return node;
}

async function googleSearch(query, config) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cx) return { skipped: true, reason: "GOOGLE_API_KEY or GOOGLE_CSE_ID not set", results: [] };
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(config.maxResultsPerQuery, 10)));
  const response = await fetch(url);
  if (!response.ok) return { error: `${response.status} ${response.statusText}`, results: [] };
  const payload = await response.json();
  return {
    results: (payload.items || []).map((result, index) => ({
      engine: "google",
      position: index + 1,
      title: result.title || "",
      url: result.link || "",
      snippet: result.snippet || ""
    }))
  };
}

async function bingSearch(query, config) {
  const apiKey = process.env.BING_WEB_SEARCH_KEY || process.env.BING_SEARCH_KEY;
  if (!apiKey) return { skipped: true, reason: "BING_WEB_SEARCH_KEY not set", results: [] };
  const url = new URL("https://api.bing.microsoft.com/v7.0/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(config.maxResultsPerQuery, 10)));
  url.searchParams.set("mkt", "en-NZ");
  url.searchParams.set("safeSearch", "Moderate");
  const response = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
  if (!response.ok) return { error: `${response.status} ${response.statusText}`, results: [] };
  const payload = await response.json();
  return {
    results: (payload.webPages?.value || []).map((result, index) => ({
      engine: "bing",
      position: index + 1,
      title: result.name || "",
      url: result.url || "",
      snippet: result.snippet || ""
    }))
  };
}

async function runSearch(query, config) {
  const responses = [];
  if (config.useGoogleApi) responses.push(await googleSearch(query, config));
  if (config.useBingApi) responses.push(await bingSearch(query, config));
  return responses.flatMap((response) => response.results || []);
}

async function processSearchResult(result, queryItem, graph, providers, config, stats) {
  const searchClaims = extractFromSearchResult(result, {
    query: queryItem.query,
    region: queryItem.region,
    city: queryItem.city,
    type: queryItem.type
  });
  mergeClaims(graph, searchClaims, {
    seedId: queryItem.seedId,
    reviewReasons: ["search-result discovery signal"],
    possibleProviderId: queryItem.possibleProviderId || ""
  }, providers);

  const sourceType = sourceTypeFromUrl(result.url);
  if (sourceType === "linkedIn_public") {
    stats.linkedInSignals += 1;
    return;
  }

  const fetchResult = await fetchPublicSource(result.url, {
    timeoutMs: 10_000,
    resolveDns: config.resolveDns
  });
  stats.sourcesFetched += fetchResult.ok ? 1 : 0;
  if (!fetchResult.ok) {
    stats.blockedOrUnreachable += 1;
    mergeClaims(graph, [evidenceItem({
      field: "source",
      value: result.url,
      sourceUrl: result.url,
      sourceType,
      excerpt: fetchResult.reason || fetchResult.error || "Source was blocked, skipped, or unreachable.",
      capturedAt: fetchResult.capturedAt,
      confidence: "low",
      extractor: "source-fetcher",
      needsManualReview: true
    })], {
      seedId: queryItem.seedId,
      reviewReasons: [`source fetch ${fetchResult.reason || "failed"}`]
    }, providers);
    return;
  }

  const extracted = extractProviderEvidence({
    html: fetchResult.text || fetchResult.body || "",
    url: fetchResult.finalUrl || result.url,
    sourceType,
    capturedAt: fetchResult.capturedAt,
    region: queryItem.region,
    city: queryItem.city,
    type: queryItem.type,
    title: result.title
  });
  mergeClaims(graph, extracted, {
    seedId: queryItem.seedId,
    reviewReasons: [`extracted from ${sourceType}`]
  }, providers);
  await sleep(config.rateLimitMs);
}

async function processSeedSources(seed, graph, providers, config, stats, remainingFetchBudget = Infinity) {
  const rawUrls = rawSeedSourceUrls(seed);
  const urls = seedSourceUrls(seed);
  stats.seedSourcesSkipped += rawUrls.length - urls.length;
  let attempted = 0;
  for (const url of urls.slice(0, remainingFetchBudget)) {
    const sourceType = sourceTypeFromUrl(url);
    const fetchResult = await fetchPublicSource(url, {
      timeoutMs: 10_000,
      resolveDns: config.resolveDns
    });
    attempted += 1;
    stats.seedSourcesChecked += 1;
    if (!fetchResult.ok) {
      stats.seedSourcesSkipped += 1;
      const failureClaim = evidenceItem({
        field: "source",
        value: url,
        sourceUrl: url,
        sourceType,
        excerpt: fetchResult.error || fetchResult.reason || "Seed source was skipped, blocked, or unreachable.",
        capturedAt: fetchResult.capturedAt,
        confidence: "low",
        extractor: "seed-source-fetcher",
        needsManualReview: true
      });
      mergeClaims(graph, [...seedClaims(seed), failureClaim], {
        seedId: seed.seedId,
        reviewReasons: [`seed source ${fetchResult.error || fetchResult.reason || "fetch failed"}`],
        possibleProviderId: seed.possibleProviderId || ""
      }, providers);
      continue;
    }

    stats.seedSourcesFetched += 1;
    const extracted = extractProviderEvidence({
      html: fetchResult.text || "",
      url: fetchResult.finalUrl || url,
      sourceType,
      capturedAt: fetchResult.capturedAt,
      region: seed.region,
      city: seed.city,
      type: seed.providerType || seed.type,
      title: seed.knownProviderName || seed.knownPracticeName || seed.knownClinicianName || ""
    });
    mergeClaims(graph, extracted, {
      seedId: seed.seedId,
      reviewReasons: [`extracted from seed source ${sourceType}`],
      possibleProviderId: seed.possibleProviderId || ""
    }, providers);
    await sleep(config.rateLimitMs);
  }
  if (urls.length > remainingFetchBudget) stats.seedSourcesSkipped += urls.length - remainingFetchBudget;
  return attempted;
}

function prepareSeeds(config) {
  let seedPayload = readJsonIfExists(config.seedFile, null);
  if (!seedPayload) {
    seedPayload = buildProviderDiscoverySeeds({
      providers: config.providers,
      region: config.region,
      type: config.type,
      limit: config.limit
    });
  }
  let seeds = seedPayload.seeds || [];
  if (config.region) seeds = seeds.filter((seed) => seed.region === config.region);
  if (config.type) seeds = seeds.filter((seed) => (seed.providerType || seed.type) === config.type);
  seeds = seeds.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.seedId.localeCompare(b.seedId));
  if (Number.isFinite(config.limit) && config.limit > 0) seeds = seeds.slice(0, config.limit);
  return { seedPayload, seeds };
}

function writeReport(filePath, output) {
  const lines = [
    "# Provider Discovery Report",
    "",
    `Generated: ${output.generatedAt}`,
    "",
    "This report is produced by the evidence discovery pipeline. It proposes reviewable candidates only; it does not publish weak data into live recommendations.",
    "",
    "## Summary",
    "",
    `- Seeds processed: ${output.inputs.seedsProcessed}`,
    `- Candidates: ${output.candidates.length}`,
    `- Search queries queued/run: ${output.searches.length}`,
    `- Sources fetched: ${output.stats.sourcesFetched}`,
    `- Blocked/unreachable/skipped sources: ${output.stats.blockedOrUnreachable}`,
    `- Seed source pages checked: ${output.stats.seedSourcesChecked}`,
    `- Seed source pages fetched: ${output.stats.seedSourcesFetched}`,
    `- Seed source pages skipped: ${output.stats.seedSourcesSkipped}`,
    `- Public LinkedIn corroboration signals: ${output.stats.linkedInSignals}`,
    `- Mode: ${output.mode}`,
    "",
    "## Searches",
    "",
    "| Round | Query | Seed |",
    "| --- | --- | --- |"
  ];
  for (const search of output.searches.slice(0, 120)) {
    lines.push(`| ${search.round} | ${search.query.replace(/\|/g, "\\|")} | ${search.seedId || ""} |`);
  }
  lines.push("", "## Candidate Highlights", "", "| Candidate | Type | Region / city | Contact evidence | Review reasons |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const candidate of output.candidates.slice(0, 80)) {
    const name = candidate.clinicianNames[0] || candidate.practiceNames[0] || candidate.names[0] || candidate.candidateId;
    const contact = [
      candidate.phones[0] ? "phone" : "",
      candidate.emails[0] ? "email" : "",
      candidate.websites[0] ? "website" : ""
    ].filter(Boolean).join(", ") || "none";
    lines.push(`| ${name.replace(/\|/g, "\\|")} | ${(candidate.types[0] || "").replace(/\|/g, "\\|")} | ${(candidate.regions[0] || "")} / ${(candidate.cities[0] || "")} | ${contact} | ${candidate.reviewReasons.join("; ").replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "## Remaining Risks", "", "- Search engines are queried only through official APIs when configured. Without API keys, the tool writes queues for manual/API-assisted discovery.", "- LinkedIn is treated as a low-confidence corroboration signal only.", "- Candidates with conflicts, weak sources, or ranking-sensitive claims must go through the auditor queue before public use.");
  writeText(filePath, `${lines.join("\n")}\n`);
}

export async function enrichProviderCandidates(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const providers = readJsonIfExists(config.providers, []);
  const { seedPayload, seeds } = prepareSeeds(config);
  const graph = new Map();
  const allSearches = [];
  const stats = {
    sourcesFetched: 0,
    blockedOrUnreachable: 0,
    linkedInSignals: 0,
    apiResults: 0,
    seedSourcesChecked: 0,
    seedSourcesFetched: 0,
    seedSourcesSkipped: 0
  };

  for (const seed of seeds) {
    mergeClaims(graph, seedClaims(seed), {
      seedId: seed.seedId,
      possibleProviderId: seed.possibleProviderId,
      reviewReasons: [seed.reason || "discovery seed"]
    }, providers);
    allSearches.push(...buildRoundOneQueries(seed));
  }

  if (config.fetchSeedSources && !config.noNetwork) {
    let remainingSeedSourceBudget = Number.isFinite(config.maxSeedSources) ? Math.max(0, config.maxSeedSources) : Infinity;
    for (const seed of seeds) {
      if (remainingSeedSourceBudget <= 0) break;
      const attempted = await processSeedSources(seed, graph, providers, config, stats, remainingSeedSourceBudget);
      remainingSeedSourceBudget -= attempted;
    }
  }

  const seenQueries = new Set();
  let roundQueries = allSearches.filter((query) => {
    const key = `${query.round}:${normaliseComparable(query.query)}`;
    if (seenQueries.has(key)) return false;
    seenQueries.add(key);
    return true;
  });

  for (let round = 1; round <= Math.max(1, config.maxRounds); round += 1) {
    const queriesForRound = roundQueries.filter((query) => query.round === round);
    if (!config.noNetwork && (config.useGoogleApi || config.useBingApi)) {
      for (const queryItem of queriesForRound) {
        const results = await runSearch(queryItem.query, config);
        stats.apiResults += results.length;
        for (const result of results.slice(0, config.maxResultsPerQuery)) {
          await processSearchResult(result, queryItem, graph, providers, config, stats);
        }
        await sleep(config.rateLimitMs);
      }
    }

    if (round < config.maxRounds) {
      const snowball = [...graph.values()].flatMap((candidate) => buildSnowballQueries(candidate, round + 1));
      for (const query of snowball) {
        const key = `${query.round}:${normaliseComparable(query.query)}`;
        if (seenQueries.has(key)) continue;
        seenQueries.add(key);
        allSearches.push(query);
        roundQueries.push(query);
      }
    }
  }

  const candidates = [...graph.values()].sort((a, b) =>
    b.corroborationScore - a.corroborationScore
    || b.sourceUrls.length - a.sourceUrls.length
    || (a.clinicianNames[0] || a.practiceNames[0] || a.names[0] || a.candidateId).localeCompare(b.clinicianNames[0] || b.practiceNames[0] || b.names[0] || b.candidateId)
  );
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: config.noNetwork || (!config.useGoogleApi && !config.useBingApi) ? "queue-only/no-network" : "official-api-enrichment",
    safety: {
      noSearchHtmlScraping: true,
      noBlockedSourceBypass: true,
      linkedInCorroborationOnly: true,
      noLiveProviderMutation: true,
      reviewGateRequired: true,
      seedSourceFetchingReviewGated: true
    },
    inputs: {
      seedFile: config.seedFile,
      sourceSeedGeneratedAt: seedPayload.generatedAt || "",
      seedsAvailable: seedPayload.seeds?.length || 0,
      seedsProcessed: seeds.length,
      seedSourceFetchLimit: config.fetchSeedSources && !config.noNetwork ? config.maxSeedSources : 0,
      providers: providers.length
    },
    stats,
    searches: allSearches,
    candidates,
    evidenceGraph: candidates
  };

  if (!config.dryRun) {
    writeJson(config.candidatesOut, {
      version: output.version,
      generatedAt: output.generatedAt,
      mode: output.mode,
      safety: output.safety,
      candidates
    });
    writeJson(config.graphOut, {
      version: output.version,
      generatedAt: output.generatedAt,
      safety: output.safety,
      nodes: candidates
    });
    writeReport(config.reportOut, output);
    writeReport(config.rootReportOut, output);
  }

  return output;
}

export async function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const output = await enrichProviderCandidates(config);
  console.log(`Prepared ${output.candidates.length} discovery candidates from ${output.inputs.seedsProcessed} seeds.`);
  console.log(`Searches queued/run: ${output.searches.length}; mode: ${output.mode}.`);
  if (!config.dryRun) {
    console.log(`Candidates: ${path.resolve(config.candidatesOut)}`);
    console.log(`Evidence graph: ${path.resolve(config.graphOut)}`);
    console.log(`Report: ${path.resolve(config.reportOut)}`);
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
