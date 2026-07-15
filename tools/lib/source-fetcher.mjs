import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { sourceDomain } from "./provider-evidence-scorer.mjs";

export const defaultUserAgent = "CareFinderAotearoaProviderValidator/2.0 (+https://finnerty.me/care/)";
const blockedStatusCodes = new Set([401, 403, 407, 429]);
const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
const maxBytesDefault = 750_000;

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

export function isPrivateIpAddress(value = "") {
  const ip = String(value || "").trim().toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && parts[2] === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && parts[2] === 100)
      || (a === 203 && b === 0 && parts[2] === 113)
      || a >= 224;
  }
  if (family === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (/^(?:fc|fd|fe[89ab]|ff)/i.test(ip.replace(/^\[/, ""))) return true;
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return mapped ? isPrivateIpAddress(mapped) : false;
  }
  return false;
}

export function publicUrlSyntaxError(value = "") {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "invalid-url";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "not-http";
  if (parsed.username || parsed.password) return "url-credentials-not-allowed";
  if (parsed.port && !["80", "443"].includes(parsed.port)) return "non-standard-port";
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "private-hostname";
  if (isPrivateIpAddress(host)) return "private-address";
  return "";
}

export async function resolvePublicHostname(hostname, options = {}) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, addresses: [], error: "invalid-hostname" };
  if (net.isIP(host)) {
    return isPrivateIpAddress(host)
      ? { ok: false, addresses: [host], error: "private-address" }
      : { ok: true, addresses: [host], error: "" };
  }
  if (options.resolveDns === false) return { ok: true, addresses: [], error: "" };

  try {
    const lookup = options.dnsLookup || ((name) => dns.lookup(name, { all: true, verbatim: true }));
    const answer = await lookup(host);
    const addresses = (Array.isArray(answer) ? answer : [answer])
      .map((item) => typeof item === "string" ? item : item?.address)
      .filter(Boolean);
    if (!addresses.length) return { ok: false, addresses, error: "dns-no-address" };
    if (addresses.some(isPrivateIpAddress)) return { ok: false, addresses, error: "private-address" };
    return { ok: true, addresses, error: "" };
  } catch (error) {
    return { ok: false, addresses: [], error: `dns-${error.code || error.message || "failed"}` };
  }
}

export async function validatePublicUrl(value, options = {}) {
  const syntaxError = publicUrlSyntaxError(value);
  if (syntaxError) return { ok: false, error: syntaxError, addresses: [] };
  const parsed = new URL(value);
  const resolved = await resolvePublicHostname(parsed.hostname, options);
  return { ...resolved, url: parsed.toString() };
}

export function shouldNotFetch(url = "") {
  if (!isHttpUrl(url)) return "not-http";
  const syntaxError = publicUrlSyntaxError(url);
  if (syntaxError) return syntaxError;
  const host = sourceDomain(url);
  if (!host) return "invalid-url";
  if (/google\.com$|bing\.com$|duckduckgo\.com$/i.test(host) && /\/search/i.test(new URL(url).pathname)) return "search-result-page";
  if (/facebook\.com$|instagram\.com$|x\.com$|twitter\.com$/i.test(host)) return "social-network";
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z)(?:$|\?)/i.test(url)) return "large-or-binary-file";
  return "";
}

export function isLikelyLoginPage(text = "", finalUrl = "") {
  const source = String(text || "");
  const url = String(finalUrl || "");
  const visibleText = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  if (/\b(?:verify you are human|access denied|checking your browser|enable javascript and cookies(?: to continue)?|complete (?:the )?(?:security check|captcha)|unusual traffic)\b/i.test(visibleText)) return true;
  if (/<(?:title|h1)[^>]*>\s*(?:captcha|human verification|security check|access denied|attention required|just a moment)\b/i.test(source)) return true;
  if (/\b(login|signin|sign-in|logon|auth|account)\b/i.test(url)) return true;
  if (/<input[^>]+type=["']?password["']?/i.test(source)) return true;
  if (/<form[^>]+(?:login|signin|sign-in|logon|auth)/i.test(source)) return true;
  if (/<title[^>]*>\s*(?:log in|login|sign in|create account)\b/i.test(source)) return true;
  if (/<h1[^>]*>\s*(?:log in|login|sign in|create account)\b/i.test(source)) return true;
  return false;
}

async function readLimitedText(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) return { tooLarge: true, text: "" };
  if (!response.body?.getReader) {
    const text = await response.text();
    return Buffer.byteLength(text, "utf8") > maxBytes
      ? { tooLarge: true, text: text.slice(0, maxBytes) }
      : { tooLarge: false, text };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("page-budget-exceeded").catch(() => {});
      return { tooLarge: true, text: Buffer.concat(chunks).toString("utf8") };
    }
    chunks.push(Buffer.from(value));
  }
  return { tooLarge: false, text: Buffer.concat(chunks).toString("utf8") };
}

function resultBase(url, capturedAt, extras = {}) {
  return {
    url,
    finalUrl: extras.finalUrl || url,
    capturedAt,
    ok: false,
    blocked: false,
    skipped: false,
    status: 0,
    contentType: "",
    error: "",
    text: "",
    sourceHash: "",
    etag: "",
    lastModified: "",
    cacheControl: "",
    notModified: false,
    redirectChain: [],
    resolvedAddresses: [],
    ...extras
  };
}

export async function fetchPublicSource(url, options = {}) {
  const capturedAt = new Date().toISOString();
  const skipReason = shouldNotFetch(url);
  if (skipReason) {
    return resultBase(url, capturedAt, {
      blocked: ["search-result-page", "social-network", "private-hostname", "private-address"].includes(skipReason),
      skipped: true,
      error: skipReason
    });
  }

  const timeoutMs = options.timeoutMs || 12_000;
  const maxBytes = options.maxBytes || maxBytesDefault;
  const maxRedirects = options.maxRedirects ?? 5;
  const redirectChain = [];
  let currentUrl = new URL(url).toString();

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const validation = await validatePublicUrl(currentUrl, options);
      if (!validation.ok) {
        return resultBase(url, capturedAt, {
          finalUrl: currentUrl,
          blocked: validation.error === "private-address",
          skipped: true,
          error: validation.error,
          redirectChain,
          resolvedAddresses: validation.addresses || []
        });
      }

      const headers = {
        accept: "text/html, text/plain, application/xhtml+xml, application/json",
        "user-agent": options.userAgent || defaultUserAgent
      };
      if (options.etag) headers["if-none-match"] = options.etag;
      if (options.lastModified) headers["if-modified-since"] = options.lastModified;

      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers
      });
      const contentType = response.headers.get("content-type") || "";
      const metadata = {
        etag: response.headers.get("etag") || "",
        lastModified: response.headers.get("last-modified") || "",
        cacheControl: response.headers.get("cache-control") || ""
      };

      if (response.status === 304) {
        return resultBase(url, capturedAt, {
          finalUrl: currentUrl,
          ok: true,
          status: 304,
          contentType,
          notModified: true,
          redirectChain,
          resolvedAddresses: validation.addresses || [],
          ...metadata
        });
      }

      if (redirectStatusCodes.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) return resultBase(url, capturedAt, { finalUrl: currentUrl, status: response.status, error: "redirect-without-location", redirectChain });
        if (redirectCount === maxRedirects) return resultBase(url, capturedAt, { finalUrl: currentUrl, status: response.status, error: "too-many-redirects", redirectChain });
        const nextUrl = new URL(location, currentUrl).toString();
        if (redirectChain.includes(nextUrl) || nextUrl === currentUrl) return resultBase(url, capturedAt, { finalUrl: currentUrl, status: response.status, error: "redirect-loop", redirectChain });
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      const blocked = blockedStatusCodes.has(response.status);
      if (!response.ok || blocked) {
        return resultBase(url, capturedAt, {
          finalUrl: currentUrl,
          blocked,
          status: response.status,
          contentType,
          error: blocked ? "blocked-by-site" : response.statusText,
          redirectChain,
          resolvedAddresses: validation.addresses || [],
          ...metadata
        });
      }

      if (contentType && !/text\/html|text\/plain|application\/xhtml|application\/json|application\/xml|text\/xml/i.test(contentType)) {
        return resultBase(url, capturedAt, {
          finalUrl: currentUrl,
          skipped: true,
          status: response.status,
          contentType,
          error: "unsupported-content-type",
          redirectChain,
          resolvedAddresses: validation.addresses || [],
          ...metadata
        });
      }

      const limited = await readLimitedText(response, maxBytes);
      const sourceHash = crypto.createHash("sha256").update(limited.text || "").digest("hex");
      if (limited.tooLarge) {
        return resultBase(url, capturedAt, {
          finalUrl: currentUrl,
          skipped: true,
          status: response.status,
          contentType,
          error: "too-large",
          sourceHash,
          redirectChain,
          resolvedAddresses: validation.addresses || [],
          ...metadata
        });
      }

      const loginRequired = isLikelyLoginPage(limited.text, currentUrl);
      return resultBase(url, capturedAt, {
        finalUrl: currentUrl,
        ok: !loginRequired,
        blocked: loginRequired,
        status: response.status,
        contentType,
        error: loginRequired ? "login-or-captcha-required" : "",
        text: loginRequired ? "" : limited.text,
        sourceHash,
        redirectChain,
        resolvedAddresses: validation.addresses || [],
        ...metadata
      });
    }
  } catch (error) {
    return resultBase(url, capturedAt, {
      finalUrl: currentUrl,
      error: error.name === "TimeoutError" ? "timeout" : error.message,
      redirectChain
    });
  }

  return resultBase(url, capturedAt, { finalUrl: currentUrl, error: "unexpected-fetch-state", redirectChain });
}

export async function fetchSources(urls, options = {}) {
  const results = [];
  const rateLimitMs = options.rateLimitMs ?? 1500;
  for (const url of urls) {
    results.push(await fetchPublicSource(url, options));
    if (rateLimitMs > 0) await delay(rateLimitMs);
  }
  return results;
}
