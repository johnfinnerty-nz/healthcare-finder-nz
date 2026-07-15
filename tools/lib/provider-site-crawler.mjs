import { setTimeout as delay } from "node:timers/promises";
import { sourceDomain, unique } from "./provider-evidence-scorer.mjs";
import { fetchPublicSource } from "./source-fetcher.mjs";

const relevantPathPattern = /\b(about|team|people|clinician|staff|service|treatment|therapy|psychology|psychiatry|counsell|contact|location|fee|cost|fund|acc|referral|telehealth|online|appointment|booking|availability|faq|new-client|patient|enrol|special|expertise|areas-of-practice)\b/i;
const ignoredPathPattern = /\b(blog|news|event|privacy|terms|cookie|career|vacanc|shop|cart|checkout|wp-admin|wp-login|feed|tag|category)\b/i;

export function canonicaliseCrawlUrl(value, base = "") {
  try {
    const url = new URL(value, base || undefined);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function robotsGroups(text = "") {
  const groups = [];
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], crawlDelay: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === "allow" || key === "disallow")) {
      current.rules.push({ type: key, path: value });
    } else if (current && key === "crawl-delay") {
      current.crawlDelay = Number(value) || 0;
    }
  }
  return groups;
}

export function parseRobotsTxt(text = "", userAgent = "CareFinderAotearoaProviderValidator") {
  const groups = robotsGroups(text);
  const agent = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((value) => value !== "*" && agent.includes(value)));
  const selected = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
  return {
    rules: selected.flatMap((group) => group.rules),
    crawlDelayMs: Math.max(0, ...selected.map((group) => group.crawlDelay * 1000)),
    sitemaps: [...String(text).matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((match) => match[1])
  };
}

function robotsPathMatch(rulePath, requestPath) {
  if (!rulePath) return false;
  const escaped = rulePath
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\$$/, "$");
  try {
    return new RegExp(`^${escaped}`).test(requestPath);
  } catch {
    return requestPath.startsWith(rulePath);
  }
}

export function isAllowedByRobots(url, policy = {}) {
  const parsed = new URL(url);
  const requestPath = `${parsed.pathname}${parsed.search}` || "/";
  const matches = (policy.rules || [])
    .filter((rule) => robotsPathMatch(rule.path, requestPath))
    .sort((a, b) => b.path.length - a.path.length || (a.type === "allow" ? -1 : 1));
  return !matches.length || matches[0].type !== "disallow";
}

export function parseSitemapUrls(xml = "", baseUrl = "") {
  return unique([...String(xml).matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => canonicaliseCrawlUrl(match[1].replace(/&amp;/gi, "&").trim(), baseUrl))
    .filter(Boolean));
}

export function extractPageLinks(html = "", pageUrl = "") {
  const links = [];
  for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = canonicaliseCrawlUrl(match[1], pageUrl);
    if (url) links.push(url);
  }
  return unique(links);
}

export function extractCanonicalLink(html = "", pageUrl = "") {
  const match = String(html).match(/<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["']/i);
  return canonicaliseCrawlUrl(match?.[1] || match?.[2] || "", pageUrl);
}

export function pageNeedsJavascriptFallback(html = "") {
  const visible = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return visible.length < 160 && /<script\b|id=["'](?:root|app|__next)["']/i.test(html);
}

function relevanceScore(url, seedUrls = []) {
  const parsed = new URL(url);
  let score = seedUrls.includes(url) ? 100 : 0;
  if (parsed.pathname === "/") score += 60;
  if (relevantPathPattern.test(`${parsed.pathname} ${parsed.search}`)) score += 40;
  if (ignoredPathPattern.test(`${parsed.pathname} ${parsed.search}`)) score -= 100;
  score -= Math.max(0, parsed.pathname.split("/").filter(Boolean).length - 3) * 5;
  return score;
}

function sameHost(url, host) {
  return sourceDomain(url) === host;
}

async function readRobots(origin, fetchSource, options) {
  const robotsUrl = `${origin}/robots.txt`;
  const result = await fetchSource(robotsUrl, { ...options, respectRobots: false, maxBytes: 150_000 });
  if (!result.ok) return { url: robotsUrl, fetched: false, policy: { rules: [], crawlDelayMs: 0, sitemaps: [] }, result };
  return { url: robotsUrl, fetched: true, policy: parseRobotsTxt(result.text, options.userAgent), result };
}

export async function crawlProviderSite(options = {}) {
  const seedUrls = unique((options.seedUrls || []).map((url) => canonicaliseCrawlUrl(url)).filter(Boolean));
  if (!seedUrls.length) return { domain: "", pages: [], blocked: [], skipped: [], errors: ["no-seed-url"], robots: null, sitemaps: [] };
  const domain = sourceDomain(seedUrls[0]);
  const origin = new URL(seedUrls[0]).origin;
  const fetchSource = options.fetchSource || fetchPublicSource;
  const maxPages = Math.max(1, options.maxPages ?? 24);
  const maxSitemapUrls = Math.max(0, options.maxSitemapUrls ?? 80);
  const baseRateLimitMs = Math.max(0, options.rateLimitMs ?? 1500);
  const cache = options.cache || {};
  const pages = [];
  const blocked = [];
  const skipped = [];
  const errors = [];

  const robots = await readRobots(origin, fetchSource, options);
  const rateLimitMs = Math.max(baseRateLimitMs, robots.policy.crawlDelayMs || 0);
  const sitemapCandidates = unique([...robots.policy.sitemaps, `${origin}/sitemap.xml`])
    .filter((url) => sameHost(canonicaliseCrawlUrl(url), domain));
  const sitemapUrls = [];
  for (const sitemapUrl of sitemapCandidates.slice(0, 4)) {
    const result = await fetchSource(sitemapUrl, { ...options, maxBytes: 600_000 });
    if (result.ok) sitemapUrls.push(...parseSitemapUrls(result.text, sitemapUrl).filter((url) => sameHost(url, domain)));
    if (rateLimitMs) await delay(rateLimitMs);
  }

  const queue = unique([
    ...seedUrls.filter((url) => sameHost(url, domain)),
    canonicaliseCrawlUrl(origin),
    ...sitemapUrls.slice(0, maxSitemapUrls)
  ]).sort((a, b) => relevanceScore(b, seedUrls) - relevanceScore(a, seedUrls));
  const visited = new Set();

  while (queue.length && pages.length < maxPages) {
    const nextUrl = queue.shift();
    if (!nextUrl || visited.has(nextUrl) || !sameHost(nextUrl, domain)) continue;
    visited.add(nextUrl);
    if (!isAllowedByRobots(nextUrl, robots.policy)) {
      skipped.push({ url: nextUrl, reason: "robots-disallowed" });
      continue;
    }
    if (relevanceScore(nextUrl, seedUrls) < 0) {
      skipped.push({ url: nextUrl, reason: "irrelevant-path" });
      continue;
    }

    const cached = cache[nextUrl] || {};
    let result = await fetchSource(nextUrl, {
      ...options,
      etag: cached.etag || "",
      lastModified: cached.lastModified || ""
    });
    let rendered = false;
    if (result.ok && pageNeedsJavascriptFallback(result.text) && typeof options.renderPage === "function") {
      const renderedResult = await options.renderPage(result.finalUrl || nextUrl, options);
      if (renderedResult?.ok && renderedResult.text) {
        result = { ...result, ...renderedResult, renderedWithHeadlessBrowser: true };
        rendered = true;
      }
    }

    if (!result.ok) {
      const bucket = result.blocked ? blocked : errors;
      bucket.push({ url: nextUrl, status: result.status, reason: result.error || "fetch-failed" });
      if (rateLimitMs) await delay(rateLimitMs);
      continue;
    }
    if (result.notModified) {
      result = {
        ...result,
        text: cached.text || "",
        sourceHash: cached.sourceHash || result.sourceHash,
        cachedProviderIds: cached.providerIds || []
      };
    }

    const canonicalUrl = extractCanonicalLink(result.text, result.finalUrl || nextUrl);
    const links = extractPageLinks(result.text, result.finalUrl || nextUrl)
      .filter((url) => sameHost(url, domain));
    pages.push({
      ...result,
      url: nextUrl,
      canonicalUrl: canonicalUrl || result.finalUrl || nextUrl,
      links,
      renderedWithHeadlessBrowser: rendered,
      javascriptFallbackNeeded: pageNeedsJavascriptFallback(result.text)
    });

    for (const link of links) {
      if (!visited.has(link) && relevanceScore(link, seedUrls) >= 0) queue.push(link);
    }
    queue.sort((a, b) => relevanceScore(b, seedUrls) - relevanceScore(a, seedUrls));
    if (rateLimitMs) await delay(rateLimitMs);
  }

  return {
    domain,
    origin,
    capturedAt: new Date().toISOString(),
    robots: {
      url: robots.url,
      fetched: robots.fetched,
      rules: robots.policy.rules,
      crawlDelayMs: robots.policy.crawlDelayMs
    },
    sitemaps: sitemapCandidates,
    discoveredSitemapUrls: unique(sitemapUrls).length,
    pages,
    blocked,
    skipped,
    errors,
    budget: { maxPages, pagesFetched: pages.length, visited: visited.size }
  };
}

export async function crawlProviderDomains(providers = [], options = {}) {
  const grouped = new Map();
  for (const provider of providers) {
    const urls = unique([provider.website, provider.source]).filter(Boolean);
    for (const url of urls) {
      const domain = sourceDomain(url);
      if (!domain) continue;
      const group = grouped.get(domain) || { domain, providerIds: [], seedUrls: [] };
      group.providerIds.push(provider.id);
      group.seedUrls.push(url);
      grouped.set(domain, group);
    }
  }

  const domains = [];
  for (const group of [...grouped.values()].slice(0, options.maxDomains || grouped.size)) {
    const crawl = await crawlProviderSite({ ...options, seedUrls: unique(group.seedUrls) });
    domains.push({ ...crawl, providerIds: unique(group.providerIds) });
  }
  return domains;
}
