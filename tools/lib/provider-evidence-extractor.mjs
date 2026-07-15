import {
  compact,
  evidenceItem,
  sourceDomain,
  sourceTypeFromUrl,
  unique
} from "./provider-evidence-scorer.mjs";
import { detectAvailabilityFromText } from "./provider-availability.mjs";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?:\+64|0)(?:[\s().-]*\d){7,10}/g;
const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
const addressPattern = /\b\d{1,5}\s+[A-Z][A-Za-z'\- ]{2,70}\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Place|Pl|Terrace|Tce|Way|Crescent|Cres|Court|Ct|Parade|Highway|Hwy)\b(?:,\s*[A-Z][A-Za-z'\- ]{2,40})?/g;

const typePatterns = [
  ["psychiatrist", /\b(psychiatrist|psychiatry|franzcp)\b/i],
  ["psychologist", /\b(clinical psychologist|psychologist|registered psychologist|mnzccp|nzccp)\b/i],
  ["counsellor", /\b(counsellor|counselor|psychotherapist|therapist|counselling|counseling)\b/i],
  ["gp", /\b(general practice|medical centre|family doctor|gp clinic|gp\b|doctor)\b/i],
  ["addiction", /\b(addiction|alcohol and drug|aod|gambling harm)\b/i],
  ["youth", /\b(youth|rangatahi|young people|adolescent)\b/i],
  ["public-service", /\b(community mental health|health nz|crisis team|public mental health)\b/i]
];

const needPatterns = {
  depression: /\b(depression|depressive|low mood|mood disorder|mood disorders)\b/i,
  anxiety: /\b(anxiety|panic|ocd|obsessive-compulsive|worry|overwhelm)\b/i,
  trauma: /\b(trauma|ptsd|post-traumatic|sexual harm|sexual abuse|sensitive claims|emdr)\b/i,
  addiction: /\b(addiction|alcohol|drug|gambling|substance|aod)\b/i,
  work: /\b(work stress|burnout|workplace|employment|return to work|vocational|study stress|housing stress|money stress)\b/i
};

const supportPatterns = {
  maori: /\b(maori|kaupapa|whanau|whanau|iwi|marae|tangata whenua|takatapui)\b/i,
  pasifika: /\b(pasifika|pacific|samoan|tongan|cook islands|fijian|vaka|fono)\b/i,
  asian: /\b(asian|chinese|korean|indian|mandarin|cantonese|hindi|japanese|vietnamese|filipino|thai)\b/i,
  rainbow: /\b(rainbow|lgbt|lgbtq|lgbtqia|gender diverse|transgender|gay|lesbian|bisexual|intersex)\b/i,
  "trauma-informed": /\b(trauma-informed|trauma informed)\b/i,
  telehealth: /\b(telehealth|online appointments?|video appointments?|zoom|remote sessions?|virtual appointments?)\b/i
};

const agePatterns = {
  Children: /\b(children|child|tamariki|under 13|0-12|5 years)\b/i,
  Adolescents: /\b(adolescent|teen|rangatahi|youth|young people|13-17|16-24)\b/i,
  Adults: /\b(adult|adults|18\+|18-60|pakeke)\b/i,
  "Older adults": /\b(older adult|senior|65\+|60\+|kaumatua|kaumātua)\b/i
};

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&minus;|&mdash;/gi, "-");
}

export function stripHtml(value = "") {
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptAround(text, patternOrValue, max = 340) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const index = patternOrValue instanceof RegExp
    ? source.search(patternOrValue)
    : source.toLowerCase().indexOf(String(patternOrValue || "").toLowerCase());
  if (index < 0) return compact(source, max);
  const start = Math.max(0, index - Math.floor(max / 2));
  return compact(source.slice(start, start + max), max);
}

function titleFromHtml(html) {
  return stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function h1FromHtml(html) {
  return stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
}

function isAnnouncementHeading(value = "") {
  return /\b(closing|closed|closure|shutting|doors shortly|temporarily unavailable|not taking|waitlist|waiting list|paused|announcement|update|news)\b/i.test(value);
}

function titleCandidates(value = "") {
  const title = String(value || "").trim();
  if (!title) return [];
  const parts = title
    .split(/\s[-|]\s|\s+[–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return unique([
    ...parts,
    ...parts.slice().reverse(),
    title
  ]);
}

function usefulPageLabel({ title = "", h1 = "", url = "" } = {}) {
  const host = sourceDomain(url);
  const candidates = [
    h1,
    ...titleCandidates(title)
  ]
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((candidate) => !isAnnouncementHeading(candidate))
    .filter((candidate) => !/^home$|^about$|^contact$|^services$|^welcome$/i.test(candidate));
  const withCareWords = candidates.find((candidate) => /\b(psychology|psychiatry|counselling|counseling|therapy|medical centre|health|clinic|wellbeing|wellness|care|minds)\b/i.test(candidate));
  if (withCareWords) return withCareWords;
  if (candidates[0]) return candidates[0];
  return host ? host.replace(/\.(co|org|health|net|com)\.nz$|\.co\.nz$|\.org\.nz$|\.nz$/i, "").replace(/[-.]/g, " ") : "";
}

function possibleClinicianName(text) {
  const match = text.match(/\b(Dr|Mr|Mrs|Ms|Mx)\s+[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}\b/);
  if (match) {
    const parts = match[0].trim().split(/\s+/);
    if (parts.length > 3) return parts.slice(0, 3).join(" ");
    return match[0].trim();
  }
  const roleBlock = text.match(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})\s+(?:is|,)\s+(?:a|an)\s+(?:clinical psychologist|psychologist|psychiatrist|counsellor|psychotherapist|therapist)\b/);
  return roleBlock?.[1]?.trim() || "";
}

function possiblePracticeName({ title, h1, text, url }) {
  const host = sourceDomain(url);
  const titleCandidate = usefulPageLabel({ title, h1, url });
  if (titleCandidate) return titleCandidate;
  const clinicMatch = text.match(/\b([A-Z][A-Za-z'&\- ]{2,80}(?:Psychology|Psychiatry|Counselling|Counseling|Therapy|Medical Centre|Health|Clinic|Wellbeing|Wellness))\b/);
  if (clinicMatch) return clinicMatch[1].trim();
  return host ? host.replace(/\.(co|org|health|net|com)\.nz$|\.co\.nz$|\.org\.nz$|\.nz$/i, "").replace(/[-.]/g, " ") : "";
}

function cleanUrl(value) {
  return String(value || "").replace(/[),.;]+$/g, "");
}

function claim(field, value, context, options = {}) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return evidenceItem({
    field,
    value: Array.isArray(value) ? value : String(value).trim(),
    sourceUrl: context.sourceUrl,
    sourceType: options.sourceType || context.sourceType,
    excerpt: options.excerpt || excerptAround(context.text, String(Array.isArray(value) ? value[0] : value)),
    capturedAt: context.capturedAt,
    confidence: options.confidence || "low",
    extractor: options.extractor || "provider-evidence-extractor",
    needsManualReview: options.needsManualReview !== false
  });
}

export function extractProviderEvidence({ html = "", text = "", url = "", sourceType = "", capturedAt = new Date().toISOString(), title = "", snippet = "", region = "", city = "", type = "" } = {}) {
  const sourceUrl = url;
  const resolvedSourceType = sourceType || sourceTypeFromUrl(url);
  const pageTitle = title || titleFromHtml(html);
  const h1 = h1FromHtml(html);
  const pageLabel = usefulPageLabel({ title: pageTitle, h1, url });
  const bodyText = stripHtml(text || html || `${pageTitle} ${snippet}`);
  const combined = [pageTitle, h1, snippet, bodyText].filter(Boolean).join(" ");
  const context = { sourceUrl, sourceType: resolvedSourceType, capturedAt, text: combined };
  const claims = [];

  claims.push(claim("name", pageLabel || h1 || pageTitle, context, { confidence: resolvedSourceType === "search_result" ? "low" : "medium" }));
  claims.push(claim("clinicianName", possibleClinicianName(combined), context, { confidence: resolvedSourceType === "linkedIn_public" ? "medium" : "low" }));
  claims.push(claim("practiceName", possiblePracticeName({ title: pageTitle, h1, text: combined, url }), context, { confidence: "medium" }));
  claims.push(claim("region", region, context, { confidence: "low", excerpt: `Region from discovery context: ${region}.` }));
  claims.push(claim("city", city, context, { confidence: "low", excerpt: `City from discovery context: ${city}.` }));

  let foundType = false;
  for (const [type, pattern] of typePatterns) {
    if (pattern.test(combined)) {
      claims.push(claim("type", type, context, {
        excerpt: excerptAround(combined, pattern),
        confidence: resolvedSourceType === "search_result" ? "low" : "medium"
      }));
      foundType = true;
      break;
    }
  }
  if (!foundType) claims.push(claim("type", type, context, { confidence: "low", excerpt: `Provider type from discovery context: ${type}.` }));

  for (const email of unique([...combined.matchAll(emailPattern)].map((match) => match[0].toLowerCase()))) {
    claims.push(claim("email", email, context, { confidence: resolvedSourceType === "search_result" ? "low" : "high" }));
  }
  for (const phone of unique([...combined.matchAll(phonePattern)].map((match) => match[0].replace(/\s+/g, " ").trim()))) {
    claims.push(claim("phone", phone, context, { confidence: resolvedSourceType === "search_result" ? "low" : "high" }));
  }
  for (const address of unique([...combined.matchAll(addressPattern)].map((match) => match[0].trim()))) {
    claims.push(claim("address", address, context, { confidence: resolvedSourceType === "search_result" ? "low" : "medium" }));
  }
  for (const foundUrl of unique([...combined.matchAll(urlPattern)].map((match) => cleanUrl(match[0])))) {
    if (!/linkedin\.com\/(?:in|company)\//i.test(foundUrl) || resolvedSourceType === "linkedIn_public") {
      claims.push(claim("website", foundUrl, context, { confidence: resolvedSourceType === "search_result" ? "low" : "medium" }));
    }
  }

  const bookingMatch = html.match(/href=["']([^"']*(?:book|booking|appointment|cliniko|carepatron|halaxy|hotdoc|myindici)[^"']*)["']/i);
  if (bookingMatch) {
    const bookingUrl = bookingMatch[1].startsWith("http") ? bookingMatch[1] : new URL(bookingMatch[1], url).toString();
    claims.push(claim("bookingUrl", bookingUrl, context, { confidence: "medium", excerpt: "Booking or appointment link found on source page." }));
  }

  const availability = detectAvailabilityFromText(combined);
  if (availability.status !== "not_published") {
    claims.push(claim("availabilityStatus", availability.status, context, {
      excerpt: availability.evidence,
      confidence: availability.status === "accepting" && resolvedSourceType !== "search_result" ? "high" : "medium"
    }));
  }

  if (/\b(gp referral|required referral|referral from (?:your )?gp|must first see (?:your )?gp)\b/i.test(combined)) {
    claims.push(claim("referralType", "gp", context, {
      excerpt: excerptAround(combined, /\b(gp referral|required referral|referral from (?:your )?gp|must first see (?:your )?gp)\b/i),
      confidence: "high",
      needsManualReview: false
    }));
  } else if (/\b(self[-\s]?referrals?|self[-\s]?refer(?:red|ring)?|book directly|direct booking|no referral required)\b/i.test(combined)) {
    claims.push(claim("referralType", "self", context, {
      excerpt: excerptAround(combined, /\b(self[-\s]?referrals?|self[-\s]?refer(?:red|ring)?|book directly|direct booking|no referral required)\b/i),
      confidence: resolvedSourceType === "search_result" ? "low" : "medium"
    }));
  }

  for (const [tag, pattern] of Object.entries(needPatterns)) {
    if (pattern.test(combined)) {
      claims.push(claim("tags", tag, context, {
        excerpt: excerptAround(combined, pattern),
        confidence: resolvedSourceType === "search_result" ? "low" : "medium"
      }));
      claims.push(claim("advertisedSpecialties", tag, context, {
        excerpt: excerptAround(combined, pattern),
        confidence: resolvedSourceType === "search_result" ? "low" : "medium"
      }));
    }
  }
  for (const [tag, pattern] of Object.entries(supportPatterns)) {
    if (pattern.test(combined)) {
      claims.push(claim("tags", tag, context, {
        excerpt: excerptAround(combined, pattern),
        confidence: resolvedSourceType === "search_result" ? "low" : "medium"
      }));
    }
  }

  const ageGroups = Object.entries(agePatterns)
    .filter(([, pattern]) => pattern.test(combined))
    .map(([label]) => label);
  if (ageGroups.length) claims.push(claim("ageGroups", ageGroups, context, { confidence: "medium" }));

  if (/\b(acc sensitive claims|sensitive claims|acc registered|winz|disability allowance|eap|funded|low[- ]cost|free)\b/i.test(combined)) {
    claims.push(claim("cost", excerptAround(combined, /\b(acc sensitive claims|sensitive claims|acc registered|winz|disability allowance|eap|funded|low[- ]cost|free)\b/i), context, { confidence: "medium" }));
  }

  return claims.filter(Boolean);
}

export function extractFromSearchResult(result = {}, context = {}) {
  const sourceUrl = result.url || result.link || "";
  const sourceType = sourceTypeFromUrl(sourceUrl);
  const claims = extractProviderEvidence({
    url: sourceUrl,
    title: result.title || result.name || "",
    snippet: result.snippet || "",
    text: `${result.title || result.name || ""} ${result.snippet || ""} ${sourceUrl}`,
    sourceType: "search_result",
    capturedAt: context.capturedAt || new Date().toISOString(),
    region: context.region || "",
    city: context.city || "",
    type: context.type || ""
  });
  claims.push(evidenceItem({
    field: "sourceUrl",
    value: sourceUrl,
    sourceUrl,
    sourceType: "search_result",
    excerpt: compact(result.snippet || result.title || ""),
    capturedAt: context.capturedAt,
    confidence: "low",
    extractor: "search-api-result",
    needsManualReview: true
  }));
  if (sourceType === "linkedIn_public") {
    claims.push(evidenceItem({
      field: "linkedInPublicSignal",
      value: sourceUrl,
      sourceUrl,
      sourceType,
      excerpt: compact(result.snippet || result.title || ""),
      capturedAt: context.capturedAt,
      confidence: "low",
      extractor: "search-api-result",
      needsManualReview: true
    }));
  }
  return claims;
}
