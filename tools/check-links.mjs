import fs from "node:fs";

const files = [
  "index.html",
  "privacy.html",
  "terms.html",
  "data-sources.html",
  "crisis.html",
  "README.md",
  "PROVIDER_DATABASE.md"
];
const urls = new Set();
const providerLinkMode = process.env.CHECK_PROVIDER_LINKS || "sample";
const providerLinkLimit = Number(process.env.PROVIDER_LINK_LIMIT || 150);
const checkProviderSources = process.env.CHECK_PROVIDER_SOURCES === "true";
const linkCheckConcurrency = Math.max(1, Number(process.env.LINK_CHECK_CONCURRENCY || 10));
const linkCheckRetries = Math.max(0, Number(process.env.LINK_CHECK_RETRIES || 2));
const headTimeoutMs = Math.max(5000, Number(process.env.LINK_CHECK_HEAD_TIMEOUT_MS || 15000));
const getTimeoutMs = Math.max(10000, Number(process.env.LINK_CHECK_GET_TIMEOUT_MS || 45000));
const browserUserAgent = process.env.LINK_CHECK_USER_AGENT
  || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const transientBlockedStatuses = new Set([401, 403, 429, 520, 522, 523, 524]);
const transientBlockedHosts = new Set([
  "healthpoint.co.nz",
  "new.healthpoint.co.nz",
  "www.healthpoint.co.nz",
  "youthline.co.nz",
  "www.youthline.co.nz"
]);
const authenticatedUrls = new Set([
  "https://github.com/johnfinnertynz/healthcare-finder-nz"
]);

function collectFromText(text) {
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>),]+/g)) {
    const url = match[0].replace(/[.;`]+$/, "");
    const localPublishedFile = projectFileForPublishedUrl(url);
    if (localPublishedFile && fs.existsSync(localPublishedFile)) continue;
    if (!isLocalDevUrl(url)) urls.add(url);
  }
}

function isLocalDevUrl(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function projectFileForPublishedUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "johnfinnertynz.github.io") return "";
    if (!url.pathname.startsWith("/healthcare-finder-nz/")) return "";
    const page = decodeURIComponent(url.pathname.replace("/healthcare-finder-nz/", "")) || "index.html";
    if (!page || page.endsWith("/")) return `${page}index.html`;
    return page;
  } catch {
    return "";
  }
}

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  collectFromText(fs.readFileSync(file, "utf8"));
}

if (fs.existsSync("providers.json") && providerLinkMode !== "off") {
  const providers = JSON.parse(fs.readFileSync("providers.json", "utf8"));
  const providerUrls = providers
    .flatMap((provider) => [
      provider.website ? { url: provider.website, generatedGp: provider.importSource === "doctorpricer" } : null,
      checkProviderSources && provider.source ? { url: provider.source, generatedGp: false } : null
    ].filter(Boolean))
    .filter((item) => /^https?:\/\//i.test(item.url));

  const mustCheck = providerUrls.filter((item) => !item.generatedGp).map((item) => item.url);
  const generated = providerUrls.filter((item) => item.generatedGp).map((item) => item.url).sort();
  const generatedLimit = providerLinkMode === "full" ? generated.length : Math.max(0, providerLinkLimit);

  for (const url of mustCheck) urls.add(url);
  for (const url of generated.slice(0, generatedLimit)) urls.add(url);
}

async function request(url, method, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": browserUserAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-NZ,en;q=0.9",
        "cache-control": "no-cache",
        "upgrade-insecure-requests": "1"
      }
    });
    clearTimeout(timer);
    return { response };
  } catch (error) {
    clearTimeout(timer);
    return { error };
  }
}

function isTransientError(error) {
  const code = error?.cause?.code || error?.code;
  const message = String(error?.message || "");
  return ["AbortError", "TimeoutError", "TypeError"].includes(error?.name)
    || ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code)
    || /timeout|network|fetch failed|connection/i.test(message);
}

function errorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function isDefinitelyBrokenNetworkError(error) {
  const code = errorCode(error);
  return code === "ENOTFOUND" || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL");
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(result, attempt) {
  const retryAfter = result.response?.headers?.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 5000);
  }
  return 500 * (attempt + 1);
}

async function requestWithRetry(url, method, timeoutMs) {
  let result;

  for (let attempt = 0; attempt <= linkCheckRetries; attempt += 1) {
    result = await request(url, method, timeoutMs);
    if (!result.error && !isTransientStatus(result.response.status)) return result;
    if (attempt < linkCheckRetries) await delay(retryDelayMs(result, attempt));
  }

  return result;
}

function isKnownBlockedHost(hostname) {
  return [...transientBlockedHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isBlockedResponse(status) {
  return transientBlockedStatuses.has(status);
}

function isAuthenticatedUrl(url) {
  return authenticatedUrls.has(String(url || "").replace(/\/$/, ""));
}

async function check(url) {
  let { response, error } = await requestWithRetry(url, "HEAD", headTimeoutMs);

  if (error || [400, 403, 405].includes(response.status) || isTransientStatus(response.status)) {
    ({ response, error } = await requestWithRetry(url, "GET", getTimeoutMs));
  }

  if (error) {
    let blockedBySite = false;
    try {
      const host = new URL(url).hostname;
      blockedBySite = isTransientError(error)
        && (isKnownBlockedHost(host) || !isDefinitelyBrokenNetworkError(error));
    } catch {
      blockedBySite = false;
    }
    return {
      url,
      status: "ERR",
      error: error.name,
      errorCode: errorCode(error),
      ok: false,
      blocked: blockedBySite
    };
  }

  return {
    url,
    status: response.status,
    final: response.url,
    ok: response.status >= 200 && response.status < 400,
    blocked: isBlockedResponse(response.status) || (response.status === 404 && isAuthenticatedUrl(url))
  };
}

async function checkAll(urlList) {
  const results = new Array(urlList.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urlList.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await check(urlList[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(linkCheckConcurrency, urlList.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

const sortedUrls = [...urls].sort();
const results = await checkAll(sortedUrls);

const broken = results.filter((result) => !result.ok && !result.blocked);
const blocked = results.filter((result) => result.blocked);
const redirected = results.filter((result) => result.ok && result.final && result.final !== result.url);

for (const result of broken) {
  const detail = [result.error, result.errorCode].filter(Boolean).join(":");
  console.log(`BROKEN ${result.status} ${result.url}${detail ? ` (${detail})` : ""}`);
}

for (const result of blocked) {
  const detail = [result.error, result.errorCode].filter(Boolean).join(":");
  console.log(`BLOCKED ${result.status} ${result.url}${detail ? ` (${detail})` : ""}`);
}

for (const result of redirected) {
  console.log(`REDIRECT ${result.status} ${result.url} -> ${result.final}`);
}

console.log(`Checked ${results.length} links with concurrency ${linkCheckConcurrency}. Broken: ${broken.length}. Blocked by site: ${blocked.length}. Redirects: ${redirected.length}.`);
process.exitCode = broken.length ? 1 : 0;
