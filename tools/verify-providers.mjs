import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildCanonicalProviderDataset, defaultProviderValidation, readCanonicalDataset, refreshCanonicalProviderDataset, writeCanonicalDataset } from "./lib/provider-canonical.mjs";
import { crawlProviderSite, canonicaliseCrawlUrl } from "./lib/provider-site-crawler.mjs";
import {
  classifyProviderSource,
  sourceDomain,
  sourceTypeFromUrl,
  unique
} from "./lib/provider-evidence-scorer.mjs";
import {
  capturedPageEvidenceText,
  containsPromptInjectionAttempt,
  extractDeterministicProviderClaims,
  pageIdentityMatchesProvider
} from "./lib/provider-validation-evidence.mjs";
import {
  discoverProviderSourcesWithGoogleCse,
  discoverProviderSourcesWithOpenAI,
  extractVerifyAndAdjudicate
} from "./lib/openai-provider-validator.mjs";
import {
  claimExpiresAt,
  decideProviderValidation,
  isClaimStale,
  runIdFor,
  VALIDATION_ENGINE_VERSION
} from "./lib/provider-validation-policy.mjs";
import {
  appendProjectionChangeLog,
  compilePublicProviderProjection,
  evaluatePublishGates,
  writePublicProjection
} from "./lib/provider-public-projection.mjs";
import {
  advanceRolloutAfterPublish,
  readRolloutState,
  recordValidationRun,
  requiredValidationBatchSize,
  selectRolloutProviders,
  stageProviderLimit,
  validationBatchIsComplete,
  writeRolloutState
} from "./lib/provider-validation-rollout.mjs";
import { evaluateProviderValidationFixture } from "./evaluate-provider-validation.mjs";

const DEFAULTS = {
  mode: "shadow",
  providers: "providers.json",
  canonical: "data/provider-validation/provider-canonical.json",
  state: "data/provider-validation/provider-validation-state.json",
  evidence: "data/provider-validation/provider-evidence.json",
  captures: "data/provider-validation/source-captures.json",
  latestRun: "data/provider-validation/latest-run.json",
  runLog: "data/provider-validation/run-log.jsonl",
  changeLog: "data/provider-validation/change-log.jsonl",
  rollout: "data/provider-validation/rollout.json",
  controlRoom: "data/provider-validation/control-room.json",
  projectionSummary: "data/provider-validation/projection-summary.json",
  report: "PROVIDER_VALIDATION_REPORT.md",
  watchlist: "data/monitors/provider-availability-watchlist.json",
  placesCandidates: "data/discovery/google-places-provider-candidates.json",
  model: process.env.PROVIDER_VALIDATION_MODEL || "gpt-5.6",
  limit: 0,
  maxPagesPerDomain: 24,
  maxModelPagesPerProvider: 4,
  rateLimitMs: 1500,
  crawlConcurrency: 6,
  discoveryConcurrency: 4,
  modelConcurrency: 8,
  maxChangePercent: 2,
  region: "",
  type: "",
  providerId: "",
  full: false,
  discover: false,
  noNetwork: false,
  noModel: false,
  dryRun: false,
  skipPostPublishChecks: false,
  skipLinkCheck: false,
  rebuildCanonical: false
};

function parseArgs(argv = process.argv.slice(2)) {
  const config = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") config.mode = argv[++index];
    else if (arg === "--providers") config.providers = argv[++index];
    else if (arg === "--canonical") config.canonical = argv[++index];
    else if (arg === "--state") config.state = argv[++index];
    else if (arg === "--evidence") config.evidence = argv[++index];
    else if (arg === "--captures") config.captures = argv[++index];
    else if (arg === "--latest-run") config.latestRun = argv[++index];
    else if (arg === "--run-log") config.runLog = argv[++index];
    else if (arg === "--change-log") config.changeLog = argv[++index];
    else if (arg === "--rollout") config.rollout = argv[++index];
    else if (arg === "--control-room") config.controlRoom = argv[++index];
    else if (arg === "--report") config.report = argv[++index];
    else if (arg === "--watchlist") config.watchlist = argv[++index];
    else if (arg === "--places-candidates") config.placesCandidates = argv[++index];
    else if (arg === "--model") config.model = argv[++index];
    else if (arg === "--limit") config.limit = Number(argv[++index]);
    else if (arg === "--max-pages") config.maxPagesPerDomain = Number(argv[++index]);
    else if (arg === "--max-model-pages") config.maxModelPagesPerProvider = Number(argv[++index]);
    else if (arg === "--rate-limit-ms") config.rateLimitMs = Number(argv[++index]);
    else if (arg === "--crawl-concurrency") config.crawlConcurrency = Number(argv[++index]);
    else if (arg === "--discovery-concurrency") config.discoveryConcurrency = Number(argv[++index]);
    else if (arg === "--model-concurrency") config.modelConcurrency = Number(argv[++index]);
    else if (arg === "--max-change-percent") config.maxChangePercent = Number(argv[++index]);
    else if (arg === "--region") config.region = argv[++index];
    else if (arg === "--type") config.type = argv[++index];
    else if (arg === "--provider-id") config.providerId = argv[++index];
    else if (arg === "--full") config.full = true;
    else if (arg === "--discover") config.discover = true;
    else if (arg === "--no-network") config.noNetwork = true;
    else if (arg === "--no-model") config.noModel = true;
    else if (arg === "--dry-run") config.dryRun = true;
    else if (arg === "--skip-post-publish-checks") config.skipPostPublishChecks = true;
    else if (arg === "--skip-link-check") config.skipLinkCheck = true;
    else if (arg === "--rebuild-canonical") config.rebuildCanonical = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["shadow", "publish", "report"].includes(config.mode)) throw new Error(`Unsupported mode: ${config.mode}`);
  return config;
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return structuredClone(fallback);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function readJsonLines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

export async function mapWithConcurrency(items = [], concurrency = 1, worker = async (item) => item) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

function currentCanonical(config, state) {
  if (!fs.existsSync(config.canonical)) {
    const publicProviders = JSON.parse(fs.readFileSync(config.providers, "utf8"));
    const canonical = buildCanonicalProviderDataset(publicProviders, { previousState: state, source: config.providers });
    if (!config.dryRun) writeCanonicalDataset(config.canonical, canonical);
    return canonical;
  }
  const canonical = readCanonicalDataset(config.canonical, config.providers);
  if (!config.rebuildCanonical) return canonical;
  const publicProviders = JSON.parse(fs.readFileSync(config.providers, "utf8"));
  const refreshed = refreshCanonicalProviderDataset(canonical, publicProviders, { previousState: state, source: config.providers });
  if (!config.dryRun) writeCanonicalDataset(config.canonical, refreshed);
  return refreshed;
}

export function googlePlacesDiscoveryMap(value = {}) {
  const map = new Map();
  for (const candidate of value.candidates || []) {
    if (!candidate?.website) continue;
    const matchedIds = unique([
      ...(candidate.possibleProviderIds || []),
      ...(candidate.existingProviderMatches || []).map((match) => typeof match === "string" ? match : match?.providerId)
    ]);
    for (const providerId of matchedIds) {
      const current = map.get(providerId) || [];
      current.push({
        url: candidate.website,
        title: candidate.name || "",
        sourceType: "google_places",
        discoveryOnly: true,
        discoveryReason: "Google Places supplied a candidate public practice website; the website must still pass identity and evidence policy."
      });
      map.set(providerId, current);
    }
  }
  return map;
}

function ensureState(canonical, previous = {}) {
  const output = {
    version: 1,
    generatedAt: previous.generatedAt || "",
    runId: previous.runId || "",
    providers: { ...(previous.providers || {}) }
  };
  for (const provider of canonical.providers || []) {
    output.providers[provider.id] = defaultProviderValidation(provider, output.providers[provider.id] || provider.validation || {});
  }
  return output;
}

function canonicalProviderUrls(provider) {
  return unique([provider.website, provider.source])
    .map((url) => canonicaliseCrawlUrl(url))
    .filter(Boolean);
}

async function discoveredUrls(provider, config, run) {
  if (!config.discover || config.noNetwork) return [];
  const results = [...(config.placesDiscovery?.get(provider.id) || [])];
  try {
    results.push(...await discoverProviderSourcesWithGoogleCse(provider, {
      maxQueries: 4,
      maxResultsPerQuery: 3,
      rateLimitMs: 250
    }));
  } catch (error) {
    run.discoveryErrors.push({ providerId: provider.id, source: "google_cse", error: error.message });
  }
  if (run.modelCredentialsPresent && !config.noModel) {
    try {
      results.push(...await discoverProviderSourcesWithOpenAI(provider, { model: config.model }));
    } catch (error) {
      run.discoveryErrors.push({ providerId: provider.id, source: "openai_web_search", error: error.message });
    }
  }
  return results;
}

async function buildDomainPlans(providers, config, run) {
  const plans = new Map();
  const providerDiscovery = await mapWithConcurrency(providers, config.discoveryConcurrency, async (provider) => ({
    provider,
    discovery: await discoveredUrls(provider, config, run)
  }));
  for (const { provider, discovery } of providerDiscovery) {
    const canonicalUrls = canonicalProviderUrls(provider);
    const discoveredProviderUrls = discovery.map((item) => canonicaliseCrawlUrl(item.url)).filter(Boolean);
    const urls = unique([...canonicalUrls, ...discoveredProviderUrls]);
    run.searchSources.push(...discovery.map((item) => ({ providerId: provider.id, ...item })));
    for (const url of urls) {
      const domain = sourceDomain(url);
      if (!domain) continue;
      const plan = plans.get(domain) || { domain, seedUrls: [], providerIds: [], discoveredProviderIds: [] };
      plan.seedUrls.push(url);
      plan.providerIds.push(provider.id);
      if (discoveredProviderUrls.includes(url) && !canonicalUrls.includes(url)) plan.discoveredProviderIds.push(provider.id);
      plans.set(domain, plan);
    }
  }
  return [...plans.values()].map((plan) => ({
    ...plan,
    seedUrls: unique(plan.seedUrls),
    providerIds: unique(plan.providerIds),
    discoveredProviderIds: unique(plan.discoveredProviderIds)
  }));
}

function pageMetadata(page, domainResult) {
  return {
    url: page.url,
    finalUrl: page.finalUrl,
    canonicalUrl: page.canonicalUrl,
    domain: domainResult.domain,
    capturedAt: page.capturedAt,
    status: page.status,
    contentType: page.contentType,
    sourceHash: page.sourceHash,
    etag: page.etag,
    lastModified: page.lastModified,
    cacheControl: page.cacheControl,
    renderedWithHeadlessBrowser: Boolean(page.renderedWithHeadlessBrowser),
    javascriptFallbackNeeded: Boolean(page.javascriptFallbackNeeded),
    providerIds: domainResult.providerIds
  };
}

function providerPageMatches(provider, page, domainResult) {
  if (!domainResult.providerIds.includes(provider.id)) return false;
  if (page.notModified && page.cachedProviderIds?.includes(provider.id)) return true;
  const text = capturedPageEvidenceText(page.text || "");
  if (pageIdentityMatchesProvider(provider, text)) return true;
  const providerUrls = canonicalProviderUrls(provider);
  const pageUrl = canonicaliseCrawlUrl(page.finalUrl || page.url);
  if (providerUrls.includes(pageUrl)) return true;
  const pathname = new URL(pageUrl).pathname;
  return /\b(contact|service|fee|cost|referral|telehealth|appointment|booking|availability|about|team)\b/i.test(pathname)
    && providerUrls.some((url) => sourceDomain(url) === domainResult.domain);
}

function pagesForProvider(provider, domainResults) {
  return domainResults.flatMap((domainResult) => domainResult.pages
    .filter((page) => providerPageMatches(provider, page, domainResult))
    .map((page) => ({ page, domainResult })));
}

function sourceTypeForPage(provider, page, domainIdentityVerified, discoveredDomain = false) {
  const known = sourceTypeFromUrl(page.finalUrl || page.url);
  if (known !== "unknown") return known;
  if (!domainIdentityVerified) return "unknown";
  return classifyProviderSource({
    url: page.finalUrl || page.url,
    provider,
    pageText: page.evidenceText,
    allowIdentityMatchedDomain: discoveredDomain
  });
}

function pageApplicationCounts(providers, domainResults) {
  const counts = {};
  for (const domainResult of domainResults) {
    for (const page of domainResult.pages) {
      const matching = providers.filter((provider) => providerPageMatches(provider, page, domainResult));
      counts[page.finalUrl || page.url] = matching.length;
    }
  }
  return counts;
}

function previousClaimsForProvider(evidence, providerId, replacedUrls, now) {
  return (evidence.claims || [])
    .filter((claim) => claim.providerId === providerId)
    .filter((claim) => !replacedUrls.has(claim.sourceUrl))
    .filter((claim) => !isClaimStale(claim, now));
}

export function revalidateUnmodifiedClaims(evidence = {}, providerId = "", page = {}) {
  const urls = new Set([page.url, page.finalUrl, page.canonicalUrl].filter(Boolean));
  return (evidence.claims || [])
    .filter((claim) => claim.providerId === providerId && urls.has(claim.sourceUrl))
    .filter((claim) => claim.verification?.decision)
    .map((claim) => ({
      ...claim,
      capturedAt: page.capturedAt,
      pageHash: page.sourceHash || claim.pageHash || "",
      expiresAt: claimExpiresAt(claim.field, claim.value, page.capturedAt),
      sourceRevalidatedAt: page.capturedAt,
      sourceRevalidation: "http-304-not-modified"
    }));
}

function fetchOutcomeFor(providerPages, domainResults, providerId) {
  if (providerPages.length) return "fetched";
  const associated = domainResults.filter((domain) => domain.providerIds.includes(providerId));
  if (!associated.length) return "no_source";
  if (associated.some((domain) => domain.blocked.length)) return "blocked";
  if (associated.some((domain) => domain.errors.length)) return "unreachable";
  return "no_relevant_page";
}

function mergeClaims(claims) {
  const byId = new Map();
  for (const claim of claims) byId.set(claim.claimId, claim);
  return [...byId.values()];
}

async function validateSelectedProvider(provider, domainResults, previousEvidence, previousState, config, run, applicationCounts) {
  const pagePairs = pagesForProvider(provider, domainResults);
  const domains = unique(pagePairs.map(({ domainResult }) => domainResult.domain));
  const domainIdentity = new Map(domains.map((domain) => {
    const pages = pagePairs.filter((pair) => pair.domainResult.domain === domain).map((pair) => pair.page);
    const knownType = sourceTypeFromUrl(pages[0]?.finalUrl || pages[0]?.url || "");
    return [domain, knownType !== "unknown" || pages.some((page) => pageIdentityMatchesProvider(provider, capturedPageEvidenceText(page.text || "")))];
  }));
  const pageClaims = [];
  const modelPages = pagePairs.slice(0, config.maxModelPagesPerProvider);
  let providerModelComplete = run.modelCredentialsPresent && !config.noModel && modelPages.length > 0;

  for (const { page, domainResult } of pagePairs) {
    const evidenceText = capturedPageEvidenceText(page.text || "");
    const enrichedPage = { ...page, evidenceText };
    const sourceType = sourceTypeForPage(
      provider,
      enrichedPage,
      domainIdentity.get(domainResult.domain),
      domainResult.discoveredProviderIds?.includes(provider.id)
    );
    enrichedPage.sourceType = sourceType;
    enrichedPage.domainIdentityVerified = Boolean(domainIdentity.get(domainResult.domain));
    if (page.notModified) {
      const revalidated = revalidateUnmodifiedClaims(previousEvidence, provider.id, page);
      pageClaims.push(...revalidated);
      if (modelPages.some((pair) => pair.page === page) && !revalidated.length) providerModelComplete = false;
      continue;
    }
    const deterministic = extractDeterministicProviderClaims(provider, enrichedPage, { sourceType, domainIdentityVerified: enrichedPage.domainIdentityVerified });
    if (containsPromptInjectionAttempt(evidenceText)) {
      providerModelComplete = false;
      run.promptInjectionPages.push({ providerId: provider.id, sourceUrl: page.finalUrl || page.url, detectedBy: "deterministic-pattern" });
      pageClaims.push(...deterministic);
      continue;
    }
    const shouldUseModel = modelPages.some((pair) => pair.page === page) && run.modelCredentialsPresent && !config.noModel;
    if (!shouldUseModel) {
      pageClaims.push(...deterministic);
      continue;
    }
    try {
      const result = await extractVerifyAndAdjudicate(provider, enrichedPage, {
        model: config.model,
        seedClaims: deterministic
      });
      if (result.promptInjectionDetected) {
        providerModelComplete = false;
        run.promptInjectionPages.push({ providerId: provider.id, sourceUrl: page.finalUrl || page.url, detectedBy: "structured-extractor" });
        pageClaims.push(...deterministic);
        continue;
      }
      pageClaims.push(...result.claims);
      const adjudications = result.claims.filter((claim) => claim.verification?.adjudicatedAt).length;
      run.modelCalls += 2 + adjudications;
      run.adjudications += adjudications;
    } catch (error) {
      providerModelComplete = false;
      run.schemaErrors += /structured|json|schema|output/i.test(error.message) ? 1 : 0;
      run.modelErrors.push({ providerId: provider.id, sourceUrl: page.finalUrl || page.url, error: error.message });
      pageClaims.push(...deterministic);
    }
  }

  const replacedUrls = new Set(pagePairs.map(({ page }) => page.finalUrl || page.url));
  const previousClaims = previousClaimsForProvider(previousEvidence, provider.id, replacedUrls, run.now);
  const claims = mergeClaims([...previousClaims, ...pageClaims]);
  const fetchOutcome = config.noNetwork ? previousState.fetchOutcome || "not_checked" : fetchOutcomeFor(pagePairs, domainResults, provider.id);
  const decision = decideProviderValidation({
    provider,
    claims,
    previous: previousState,
    fetchOutcome,
    runId: run.runId,
    modelComplete: providerModelComplete,
    now: run.now,
    pageApplicationCount: applicationCounts
  });
  return { decision, claims, pagesChecked: pagePairs.length, providerModelComplete };
}

async function crawlPlans(plans, config, previousCaptures, run) {
  if (config.noNetwork) return [];
  const cache = Object.fromEntries((previousCaptures.pages || []).map((page) => [page.finalUrl || page.url, page]));
  const results = await mapWithConcurrency(plans, config.crawlConcurrency, async (plan) => {
    const result = await crawlProviderSite({
      seedUrls: plan.seedUrls,
      maxPages: Math.min(100, Math.max(config.maxPagesPerDomain, plan.seedUrls.length)),
      rateLimitMs: config.rateLimitMs,
      cache
    });
    const output = { ...result, providerIds: plan.providerIds, discoveredProviderIds: plan.discoveredProviderIds || [] };
    run.blockedSources.push(...result.blocked.map((item) => ({ domain: plan.domain, ...item })));
    run.fetchErrors.push(...result.errors.map((item) => ({ domain: plan.domain, ...item })));
    return output;
  });
  return results;
}

function providerTimeline(provider, state, claims) {
  const storedSourceDate = provider.lastVerified || provider.verified || provider._canonical?.importedFromPublicAt || "";
  const storedSources = unique([provider.website, provider.source]).map((sourceUrl) => ({
    at: storedSourceDate,
    event: "stored_source_pending_validation",
    detail: "Source retained from the current provider record; its individual claims have not yet passed this validation engine.",
    sourceUrl
  }));
  return [
    ...storedSources,
    ...(state.observations || []).map((item) => ({
      at: item.capturedAt,
      event: item.kind,
      detail: `${item.value}: ${item.excerpt}`,
      sourceUrl: item.sourceUrl
    })),
    ...claims.slice(-12).map((claim) => ({
      at: claim.capturedAt,
      event: claim.verification?.decision || "captured",
      detail: `${claim.field}: ${Array.isArray(claim.value) ? claim.value.join(", ") : claim.value}`,
      sourceUrl: claim.sourceUrl
    }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);
}

function buildControlRoom(canonical, state, evidence, run, projection, rollout, history = {}) {
  const claimsByProvider = new Map();
  for (const claim of evidence.claims || []) {
    const bucket = claimsByProvider.get(claim.providerId) || [];
    bucket.push(claim);
    claimsByProvider.set(claim.providerId, bucket);
  }
  const providers = (canonical.providers || []).map((provider) => {
    const providerState = state.providers[provider.id] || defaultProviderValidation(provider);
    const claims = claimsByProvider.get(provider.id) || [];
    return {
      providerId: provider.id,
      name: provider.name,
      clinicianName: provider.clinicianName || "",
      practiceName: provider.practiceName || "",
      type: provider.type,
      region: provider.region,
      city: provider.city,
      status: providerState.status,
      fetchOutcome: providerState.fetchOutcome,
      lastCheckedAt: providerState.lastCheckedAt,
      approvedClaims: providerState.evidenceSummary?.accepted || 0,
      rejectedClaims: providerState.evidenceSummary?.rejected || 0,
      conflicts: providerState.conflicts || [],
      reasons: providerState.reasons || [],
      sourceUrls: unique([provider.website, provider.source, ...claims.map((claim) => claim.sourceUrl)]),
      staleClaims: claims.filter((claim) => isClaimStale(claim, run.now)).length,
      timeline: providerTimeline(provider, providerState, claims)
    };
  });
  const stateCounts = providers.reduce((counts, provider) => {
    counts[provider.status] = (counts[provider.status] || 0) + 1;
    return counts;
  }, {});
  return {
    version: 1,
    generatedAt: run.generatedAt,
    rollout,
    latestRun: {
      runId: run.runId,
      mode: run.mode,
      clean: run.clean,
      model: run.model,
      modelComplete: run.modelComplete,
      providersSelected: run.providersSelected,
      providersChecked: run.providersChecked,
      requiredProvidersForCleanStage: run.requiredProvidersForCleanStage || 0,
      completeStageCoverage: Boolean(run.completeStageCoverage),
      pagesFetched: run.pagesFetched,
      claimsCaptured: evidence.claims?.length || 0,
      modelCalls: run.modelCalls,
      adjudications: run.adjudications,
      schemaErrors: run.schemaErrors,
      promptInjectionPages: run.promptInjectionPages.length,
      searchSources: run.searchSources.length,
      blockedSources: run.blockedSources.length,
      fetchErrors: run.fetchErrors.length,
      publishGate: run.publishGate
    },
    metrics: {
      providers: providers.length,
      states: stateCounts,
      staleClaims: providers.reduce((sum, provider) => sum + provider.staleClaims, 0),
      blockedSources: run.blockedSources.length,
      materialChangesProposed: projection.summary.materialChanges,
      suppressionsProposed: projection.summary.suppressions
    },
    blockedSources: run.blockedSources,
    fetchErrors: run.fetchErrors,
    searchSources: run.searchSources.slice(0, 200),
    automaticChanges: projection.changes.map((change) => ({ providerId: change.providerId, providerName: change.providerName, reason: change.reason })),
    suppressions: projection.suppressions.map((change) => ({ providerId: change.providerId, providerName: change.providerName, reason: change.reason })),
    regionalCoverage: projection.coverage,
    runHistory: history.runHistory || [],
    rollbackHistory: history.rollbackHistory || [],
    providers
  };
}

function markdownReport(controlRoom, evaluation) {
  const run = controlRoom.latestRun;
  const lines = [
    "# Autonomous Provider Validation Report",
    "",
    `Generated: ${controlRoom.generatedAt}`,
    `Run: ${run.runId}`,
    `Mode: ${run.mode}`,
    `Rollout stage: ${controlRoom.rollout.stage}`,
    "",
    "## Run Health",
    "",
    `- Clean run: ${run.clean ? "yes" : "no"}`,
    `- Model: ${run.model}`,
    `- Model verification complete: ${run.modelComplete ? "yes" : "no"}`,
    `- Providers selected/checked: ${run.providersSelected}/${run.providersChecked}`,
    `- Pages fetched: ${run.pagesFetched}`,
    `- Evidence claims retained: ${run.claimsCaptured}`,
    `- Structured-output errors: ${run.schemaErrors}`,
    `- Blocked sources: ${run.blockedSources}`,
    `- Fetch errors: ${run.fetchErrors}`,
    `- Synthetic claim-evaluation precision: ${(evaluation.precision * 100).toFixed(2)}% (${evaluation.cases} versioned cases)`,
    "",
    "## Publish Gate",
    "",
    `- Passed: ${run.publishGate.passed ? "yes" : "no"}`,
    ...(run.publishGate.failures.length ? run.publishGate.failures.map((failure) => `- Blocked: ${failure}`) : ["- No publish blockers detected."]),
    "",
    "## Proposed Changes",
    "",
    `- Material updates: ${controlRoom.metrics.materialChangesProposed}`,
    `- Reversible suppressions: ${controlRoom.metrics.suppressionsProposed}`,
    "",
    "## Validation States",
    ""
  ];
  for (const [state, count] of Object.entries(controlRoom.metrics.states)) lines.push(`- ${state}: ${count}`);
  lines.push("", "## Remaining Risks", "");
  lines.push("- Blocked, login-only, private, or robots-disallowed sources remain unverified and are not bypassed.");
  lines.push("- Published phone and email details mean the provider publicly lists them; this process does not call or send test messages.");
  lines.push("- The 99.5% gate applies to the versioned claim fixture. Production precision still depends on source coverage and should be monitored through rollback and smoke checks.");
  lines.push("- A model credential is mandatory for publishing. Credential-less runs are diagnostic shadow runs only.");
  return `${lines.join("\n")}\n`;
}

function postPublishChecks(config) {
  const testFiles = fs.readdirSync("tests")
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => path.join("tests", file));
  const commands = [
    [process.execPath, ["tools/validate-provider-data.mjs"]],
    [process.execPath, ["tools/audit-provider-source-fit.mjs"]],
    [process.execPath, ["tools/audit-provider-availability.mjs"]],
    [process.execPath, ["tools/audit-psychiatrist-referrals.mjs"]],
    [process.execPath, ["tools/audit-address-coverage.mjs", "providers.json"]],
    [process.execPath, ["--test", ...testFiles]]
  ];
  if (!config.skipLinkCheck) commands.push([process.execPath, ["tools/check-links.mjs"]]);
  const results = [];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", shell: false });
    results.push({ command: `${command} ${args.join(" ")}`, status: result.status, output: `${result.stdout || ""}${result.stderr || ""}`.slice(-4000) });
    if (result.status !== 0) return { passed: false, results };
  }
  return { passed: true, results };
}

export function updateCanonicalFromProjection(canonical, state, projection) {
  return {
    ...canonical,
    generatedAt: projection.generatedAt,
    providers: canonical.providers.map((provider) => ({
      ...provider,
      validation: state.providers[provider.id] || provider.validation
    }))
  };
}

function updateWatchlist(filePath, projection) {
  const current = readJson(filePath, { version: 1, updated: "", items: [] });
  const items = Array.isArray(current) ? current : current.items || [];
  const byProvider = new Map(items.map((item) => [item.providerId || item.providerCandidate?.id, item]));
  for (const suppression of projection.suppressions) {
    const old = suppression.oldProvider;
    byProvider.set(old.id, {
      ...(byProvider.get(old.id) || {}),
      providerId: old.id,
      providerCandidate: old,
      sourceUrl: old.availabilitySource || old.source || old.website || "",
      evidencePhrase: suppression.reason,
      checkedDate: projection.generatedAt.slice(0, 10),
      lastKnownStatus: "automatically_suppressed",
      monitor: true,
      reason: suppression.reason
    });
  }
  const nextItems = [...byProvider.values()];
  writeJson(filePath, Array.isArray(current) ? nextItems : {
    ...current,
    version: current.version || 1,
    updated: projection.generatedAt.slice(0, 10),
    items: nextItems
  });
}

function writeRunArtifacts(config, { state, evidence, captures, run, projection, rollout, canonical, evaluation }) {
  const runHistory = [...readJsonLines(config.runLog), run]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.runId === item.runId) === index)
    .slice(-100);
  const rollbackHistory = readJsonLines(config.changeLog).filter((item) => item.action === "rollback").slice(-100);
  const controlRoom = buildControlRoom(canonical, state, evidence, run, projection, rollout, { runHistory, rollbackHistory });
  if (!config.dryRun) {
    writeJson(config.state, state);
    writeJson(config.evidence, evidence);
    writeJson(config.captures, captures);
    writeJson(config.latestRun, run);
    appendJsonLine(config.runLog, run);
    writeJson(config.controlRoom, controlRoom);
    writeJson(config.projectionSummary, {
      generatedAt: projection.generatedAt,
      runId: projection.runId,
      summary: projection.summary,
      coverage: projection.coverage,
      changes: projection.changes.map(({ oldProvider, newProvider, ...change }) => change),
      suppressions: projection.suppressions.map(({ oldProvider, newProvider, ...change }) => change)
    });
    writeText(config.report, markdownReport(controlRoom, evaluation));
  }
  return controlRoom;
}

function reportOnly(config) {
  const latestRun = readJson(config.latestRun, { runId: "", generatedAt: new Date().toISOString(), mode: "report", now: new Date() });
  const state = readJson(config.state, { providers: {} });
  const evidence = readJson(config.evidence, { claims: [] });
  const canonical = readCanonicalDataset(config.canonical, config.providers);
  const currentPublicProviders = readJson(config.providers, []);
  const rollout = readRolloutState(config.rollout);
  const projection = compilePublicProviderProjection(canonical, state, {
    runId: latestRun.runId,
    generatedAt: latestRun.generatedAt,
    publicProviders: currentPublicProviders
  });
  const evaluation = evaluateProviderValidationFixture();
  const run = { ...latestRun, now: new Date(), publishGate: latestRun.publishGate || { passed: false, failures: ["report-only"] }, clean: Boolean(latestRun.clean) };
  const controlRoom = buildControlRoom(canonical, state, evidence, run, projection, rollout, {
    runHistory: readJsonLines(config.runLog).slice(-100),
    rollbackHistory: readJsonLines(config.changeLog).filter((item) => item.action === "rollback").slice(-100)
  });
  if (!config.dryRun) {
    writeJson(config.controlRoom, controlRoom);
    writeText(config.report, markdownReport(controlRoom, evaluation));
  }
  return { run, projection, rollout, controlRoom, evaluation };
}

export async function verifyProviders(options = {}) {
  const config = { ...DEFAULTS, ...options };
  if (config.mode === "report") return reportOnly(config);
  config.placesDiscovery = config.discover
    ? googlePlacesDiscoveryMap(readJson(config.placesCandidates, { candidates: [] }))
    : new Map();
  const generatedAt = new Date().toISOString();
  const now = new Date(generatedAt);
  const previousStateRaw = readJson(config.state, { providers: {} });
  const canonical = currentCanonical(config, previousStateRaw);
  const currentPublicProviders = readJson(config.providers, []);
  const state = ensureState(canonical, previousStateRaw);
  const previousEvidence = readJson(config.evidence, { version: 1, claims: [] });
  const previousCaptures = readJson(config.captures, { version: 1, pages: [] });
  const rolloutBefore = readRolloutState(config.rollout);
  const modelCredentialsPresent = Boolean(process.env.OPENAI_API_KEY);
  const run = {
    version: 1,
    runId: runIdFor(generatedAt),
    generatedAt,
    mode: config.mode,
    model: config.model,
    engineVersion: VALIDATION_ENGINE_VERSION,
    modelCredentialsPresent,
    modelComplete: false,
    providersSelected: 0,
    providersChecked: 0,
    pagesFetched: 0,
    modelCalls: 0,
    adjudications: 0,
    schemaErrors: 0,
    unexplainedConflicts: 0,
    pageFanoutViolations: 0,
    promptInjectionPages: [],
    blockedSources: [],
    fetchErrors: [],
    modelErrors: [],
    discoveryErrors: [],
    searchSources: [],
    publishGate: { passed: false, failures: [] },
    clean: false,
    now
  };

  let selectedIds;
  if (config.providerId) selectedIds = [config.providerId];
  else {
    const configuredLimit = config.limit > 0 ? config.limit : null;
    const rolloutLimit = stageProviderLimit(rolloutBefore.stage);
    let requestedLimit;
    if (rolloutBefore.stage === "shadow") {
      requestedLimit = config.full ? undefined : configuredLimit || 25;
    } else if (Number.isFinite(rolloutLimit)) {
      requestedLimit = config.mode === "publish" || config.full
        ? rolloutLimit
        : Math.min(configuredLimit || rolloutLimit, rolloutLimit);
    } else {
      requestedLimit = config.mode === "publish" || config.full ? undefined : configuredLimit || undefined;
    }
    const selectionProviders = canonical.providers.map((provider) => ({
      ...provider,
      validation: state.providers[provider.id]
    }));
    selectedIds = selectRolloutProviders(selectionProviders, rolloutBefore, {
      limit: requestedLimit,
      shadowAll: config.full,
      region: config.region,
      type: config.type
    });
  }
  const selectedSet = new Set(selectedIds);
  const selected = canonical.providers.filter((provider) => selectedSet.has(provider.id));
  run.providersSelected = selected.length;

  const plans = await buildDomainPlans(selected, config, run);
  const domainResults = await crawlPlans(plans, config, previousCaptures, run);
  run.pagesFetched = domainResults.reduce((sum, domain) => sum + domain.pages.length, 0);
  const applicationCounts = pageApplicationCounts(selected, domainResults);
  const updatedClaims = [];
  let everyProviderModelComplete = modelCredentialsPresent && !config.noModel;

  const validationResults = await mapWithConcurrency(selected, config.modelConcurrency, (provider) => validateSelectedProvider(
      provider,
      domainResults,
      previousEvidence,
      state.providers[provider.id],
      config,
      run,
      applicationCounts
    ));
  for (let index = 0; index < selected.length; index += 1) {
    const provider = selected[index];
    const result = validationResults[index];
    state.providers[provider.id] = result.decision;
    updatedClaims.push(...result.claims);
    run.providersChecked += 1;
    run.unexplainedConflicts += result.decision.conflicts.length;
    run.pageFanoutViolations += new Set((result.decision.evaluatedClaims || [])
      .filter((claim) => claim.policy?.reasons?.includes("source-page-applied-to-too-many-providers"))
      .map((claim) => claim.sourceUrl)
      .filter(Boolean)).size;
    everyProviderModelComplete &&= result.providerModelComplete;
  }

  const untouchedClaims = (previousEvidence.claims || []).filter((claim) => !selectedSet.has(claim.providerId));
  const evidence = {
    version: 1,
    generatedAt,
    runId: run.runId,
    engineVersion: VALIDATION_ENGINE_VERSION,
    claims: mergeClaims([...untouchedClaims, ...updatedClaims])
  };
  const capturedUrls = new Set(domainResults.flatMap((domain) => domain.pages.map((page) => page.finalUrl || page.url)));
  const captures = {
    version: 1,
    generatedAt,
    runId: run.runId,
    pages: [
      ...(previousCaptures.pages || []).filter((page) => !capturedUrls.has(page.finalUrl || page.url)),
      ...domainResults.flatMap((domain) => domain.pages.map((page) => pageMetadata(page, domain)))
    ],
    blocked: run.blockedSources,
    errors: run.fetchErrors
  };
  state.generatedAt = generatedAt;
  state.runId = run.runId;
  run.modelComplete = everyProviderModelComplete && run.modelErrors.length === 0;

  const evaluation = evaluateProviderValidationFixture();
  run.claimPrecision = evaluation.precision;
  const projection = compilePublicProviderProjection(canonical, state, {
    runId: run.runId,
    generatedAt,
    applyProviderIds: selectedIds,
    publicProviders: currentPublicProviders
  });
  const preRolloutGate = evaluatePublishGates({ projection, run, rollout: rolloutBefore, maxChangePercent: config.maxChangePercent });
  run.publishGate = preRolloutGate;
  const requiredProviders = requiredValidationBatchSize(rolloutBefore, canonical.providers.length);
  const completeStageCoverage = validationBatchIsComplete(rolloutBefore, {
    totalProviders: canonical.providers.length,
    selected: selected.length,
    checked: run.providersChecked
  });
  run.requiredProvidersForCleanStage = requiredProviders;
  run.completeStageCoverage = completeStageCoverage;
  run.clean = modelCredentialsPresent
    && run.modelComplete
    && run.schemaErrors === 0
    && run.unexplainedConflicts === 0
    && run.pageFanoutViolations === 0
    && evaluation.passed
    && completeStageCoverage;

  let rollout = rolloutBefore;
  if (config.mode === "shadow") {
    rollout = recordValidationRun(rolloutBefore, {
      runId: run.runId,
      generatedAt,
      clean: run.clean,
      mode: "shadow",
      providersChecked: run.providersChecked,
      reason: run.clean ? "All shadow safety gates passed." : "One or more shadow safety gates did not pass."
    });
    if (!config.dryRun) writeRolloutState(config.rollout, rollout);
  }

  if (config.mode === "publish") {
    run.publishGate = evaluatePublishGates({ projection, run, rollout: rolloutBefore, maxChangePercent: config.maxChangePercent });
    if (!rolloutBefore.readyToPublish) run.publishGate.failures.push("rollout-not-marked-ready-to-publish");
    run.publishGate.passed = run.publishGate.failures.length === 0;
    if (!run.publishGate.passed) {
      writeRunArtifacts(config, { state, evidence, captures, run, projection, rollout, canonical, evaluation });
      throw new Error(`Provider publish blocked: ${unique(run.publishGate.failures).join(", ")}`);
    }
    if (!config.dryRun) {
      const oldPublic = fs.readFileSync(config.providers, "utf8");
      writePublicProjection(config.providers, projection);
      const checks = config.skipPostPublishChecks ? { passed: true, results: [] } : postPublishChecks(config);
      run.postPublishChecks = checks;
      if (!checks.passed) {
        fs.writeFileSync(config.providers, oldPublic);
        run.publishGate = { passed: false, failures: ["post-publish-checks-failed"] };
        writeRunArtifacts(config, { state, evidence, captures, run, projection, rollout, canonical, evaluation });
        throw new Error(`Published projection failed checks and was rolled back: ${checks.results.find((result) => result.status !== 0)?.command || "unknown check"}`);
      }
      const updatedCanonical = updateCanonicalFromProjection(canonical, state, projection);
      writeCanonicalDataset(config.canonical, updatedCanonical);
      appendProjectionChangeLog(config.changeLog, projection, { generatedAt, engineVersion: VALIDATION_ENGINE_VERSION });
      updateWatchlist(config.watchlist, projection);
      rollout = advanceRolloutAfterPublish(rolloutBefore, run.runId, generatedAt);
      writeRolloutState(config.rollout, rollout);
    }
  }

  const controlRoom = writeRunArtifacts(config, { state, evidence, captures, run, projection, rollout, canonical, evaluation });
  return { config, canonical, state, evidence, captures, run, projection, rollout, controlRoom, evaluation };
}

export async function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const result = await verifyProviders(config);
  console.log(`Provider validation ${result.run.mode}: ${result.run.providersChecked}/${result.run.providersSelected} providers checked.`);
  console.log(`Run ${result.run.runId}: ${result.run.clean ? "clean" : "not clean"}; publish gate ${result.run.publishGate.passed ? "passed" : "blocked"}.`);
  console.log(`Control room data: ${config.controlRoom}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
