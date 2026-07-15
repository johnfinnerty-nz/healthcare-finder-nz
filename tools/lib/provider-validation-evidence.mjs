import crypto from "node:crypto";
import {
  classifyProviderSource,
  evidenceItem,
  normaliseComparable,
  sourceDomain,
  unique
} from "./provider-evidence-scorer.mjs";
import { detectAvailabilityFromText } from "./provider-availability.mjs";
import { claimExpiresAt } from "./provider-validation-policy.mjs";

const needPatterns = {
  depression: /\b(depression|depressive disorders?|low mood|mood disorders?)\b/i,
  anxiety: /\b(anxiety|panic attacks?|panic disorder|obsessive[- ]compulsive|ocd|overwhelm)\b/i,
  trauma: /\b(trauma|post[- ]traumatic stress|ptsd|sexual harm|sexual abuse|sensitive claims|emdr)\b/i,
  addiction: /\b(addiction|alcohol and other drugs?|alcohol|drug|gambling harm|substance use|aod)\b/i,
  work: /\b(work(?:place)? stress|burnout|employment|return to work|vocational|study stress|housing stress|financial stress|money stress)\b/i
};

const preferencePatterns = {
  maori: /\b(kaupapa maori|kaupapa māori|maori clients?|māori clients?|tangata whenua|taha maori|taha māori|te ao maori|te ao māori)\b/i,
  pasifika: /\b(pasifika|pacific peoples?|pacific clients?|pacific communities|(?:support|services?|counselling|therapy|language)\s+(?:for|in)\s+(?:samoan|tongan|cook islands maori|cook islands māori)|(?:speaks?|fluent in|sessions? in)\s+(?:samoan|tongan))\b/i,
  asian: /\b(asian clients?|asian communities|asian services?|(?:support|services?|counselling|therapy|language)\s+(?:for|in)\s+(?:chinese|korean|indian|mandarin|cantonese|hindi|japanese|vietnamese|filipino|thai)|(?:speaks?|fluent in|sessions? in)\s+(?:mandarin|cantonese|hindi|korean|japanese|vietnamese|filipino|thai))\b/i,
  rainbow: /\b(rainbow|lgbtqia?\+?|lgbtq\+?|gender diverse|transgender|takatapui|takatāpui|queer affirming)\b/i,
  "trauma-informed": /\btrauma[- ]informed\b/i,
  telehealth: /\b(telehealth|online (?:appointments?|sessions?|consultations?)|video (?:appointments?|sessions?|consultations?)|phone (?:appointments?|sessions?|consultations?)|zoom sessions?)\b/i
};

const typePatterns = [
  ["psychiatrist", /\b(psychiatrist|psychiatry|franzcp)\b/i],
  ["psychologist", /\b(clinical psychologist|registered psychologist|psychologist|mnzccp)\b/i],
  ["counsellor", /\b(counsellor|counselor|psychotherapist|therapist)\b/i],
  ["gp", /\b(general practice|general practitioner|family doctor|medical centre|gp clinic)\b/i],
  ["addiction", /\b(addiction service|alcohol and other drug|aod service|gambling harm)\b/i],
  ["youth", /\b(youth service|rangatahi service|young people)\b/i],
  ["public-service", /\b(community mental health|public mental health|health new zealand|te whatu ora)\b/i]
];
const clinicianBoundFields = new Set([
  "tags",
  "needScope",
  "specialties",
  "advertisedSpecialties",
  "patientGroups",
  "ageGroups",
  "providerGender",
  "onlineAvailable",
  "phoneSupport",
  "inPerson",
  "availabilityStatus"
]);

const entityMap = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["#39", "'"],
  ["ndash", "-"],
  ["mdash", "-"]
]);

function decodeEntities(value = "") {
  return String(value)
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, (full, key) => {
      const lower = key.toLowerCase();
      if (entityMap.has(lower)) return entityMap.get(lower);
      if (/^#x/.test(lower)) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (/^#\d+$/.test(lower)) return String.fromCodePoint(Number(lower.slice(1)));
      return full;
    });
}

export function containsPromptInjectionAttempt(value = "") {
  return /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|prompts?)\b|\byou\s+are\s+(?:chatgpt|an?\s+ai|a\s+language\s+model)\b|\b(?:system|assistant|developer)\s+message\s*:/i.test(String(value || ""));
}

export function normaliseCapturedPageText(html = "") {
  return decodeEntities(String(html)
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|li|section|article|h[1-6]|tr|td|br)>/gi, "\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function capturedPageEvidenceText(html = "") {
  const source = String(html || "");
  const attributeEvidence = [
    ...[...source.matchAll(/href\s*=\s*["'](?:mailto|tel):[^"']+["']/gi)].map((match) => match[0]),
    ...[...source.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>[\s\S]{0,500}?(?:book|appointment|availability)[\s\S]{0,500}?<\/a>/gi)].map((match) => match[0])
  ].filter(Boolean);
  const jsonLdEvidence = [...source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...attributeEvidence, normaliseCapturedPageText(source), ...jsonLdEvidence].filter(Boolean).join("\n");
}

function exactExcerpt(text, pattern, max = 420) {
  const source = String(text || "");
  const match = source.match(pattern);
  if (!match || typeof match.index !== "number") return "";
  const lineStart = Math.max(source.lastIndexOf("\n", match.index) + 1, match.index - Math.floor(max / 2));
  const lineEndCandidate = source.indexOf("\n", match.index + match[0].length);
  const lineEnd = Math.min(source.length, lineEndCandidate < 0 ? lineStart + max : lineEndCandidate);
  return source.slice(lineStart, Math.min(lineEnd, lineStart + max)).trim();
}

function parseJsonLd(html = "") {
  const values = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]).map((value) => ({ value, raw: match[1].trim() })));
    } catch {
      // Invalid JSON-LD is ignored; it is never repaired into evidence.
    }
  }
  return values;
}

function walkObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  output.push(value);
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, output);
  } else {
    for (const child of Object.values(value)) walkObjects(child, output);
  }
  return output;
}

function normalisePhone(value = "") {
  const text = decodeURIComponent(String(value).replace(/^tel:/i, "")).trim();
  return text.replace(/\s+/g, " ").replace(/^0064/, "+64");
}

function normaliseEmail(value = "") {
  return decodeURIComponent(String(value).replace(/^mailto:/i, "").split("?")[0]).trim().toLowerCase();
}

function subjectBinding(provider, pageText, domainIdentityVerified = false) {
  const normalised = normaliseComparable(pageText);
  const clinicianName = provider.clinicianName || "";
  const practiceName = provider.practiceName || "";
  const providerName = provider.name || "";
  const clinicianMatched = clinicianName && normalised.includes(normaliseComparable(clinicianName));
  const practiceMatched = practiceName && normalised.includes(normaliseComparable(practiceName));
  const providerMatched = providerName && normalised.includes(normaliseComparable(providerName));
  if (clinicianMatched) return { subjectType: "clinician", subjectId: provider._canonical?.clinicianId || provider.id, subjectName: clinicianName, subjectMatched: true };
  if (practiceMatched) return { subjectType: "practice", subjectId: provider._canonical?.practiceId || provider.id, subjectName: practiceName, subjectMatched: true };
  if (providerMatched) return { subjectType: "provider", subjectId: provider.id, subjectName: providerName, subjectMatched: true };
  return { subjectType: "provider", subjectId: provider.id, subjectName: providerName, subjectMatched: Boolean(domainIdentityVerified) };
}

function nearbyExcerptText(pageText = "", excerpt = "", lineRadius = 2) {
  const lines = String(pageText).split("\n");
  const index = lines.findIndex((line) => line.includes(excerpt));
  if (index < 0) return String(excerpt || "");
  return lines.slice(Math.max(0, index - lineRadius), Math.min(lines.length, index + lineRadius + 1)).join("\n");
}

function clinicianProfilePageMatches(provider = {}, page = {}) {
  const clinicianName = normaliseComparable(provider.clinicianName || "");
  if (!clinicianName) return false;
  const nameParts = clinicianName.split(" ").filter((part) => part.length >= 3);
  const pathname = normaliseComparable(new URL(page.finalUrl || page.url || "https://invalid.example").pathname);
  const urlMatch = nameParts.length >= 2 && nameParts.every((part) => pathname.includes(part));
  const headingText = [...String(page.text || "").matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi)]
    .map((match) => normaliseComparable(normaliseCapturedPageText(match[1])))
    .join(" ");
  return urlMatch || headingText.includes(clinicianName);
}

export function claimSubjectMatchesProviderEvidence(provider = {}, page = {}, claim = {}) {
  const excerpt = String(claim.excerpt || "");
  if (!excerpt || !String(page.evidenceText || "").includes(excerpt)) return false;
  const expectedNames = claim.subjectType === "clinician"
    ? [provider.clinicianName, provider.name]
    : claim.subjectType === "practice"
      ? [provider.practiceName, provider.name]
      : [provider.name, provider.clinicianName, provider.practiceName];
  const claimed = normaliseComparable(claim.subjectName || "");
  const namedSubjectMatches = expectedNames.filter(Boolean).some((name) => {
    const expected = normaliseComparable(name);
    return expected && claimed && (expected === claimed || expected.includes(claimed) || claimed.includes(expected));
  });
  if (!namedSubjectMatches) return false;
  if (!provider.clinicianName || !clinicianBoundFields.has(claim.field)) return true;
  if (claim.subjectType !== "clinician") return false;
  const nearby = normaliseComparable(nearbyExcerptText(page.evidenceText, excerpt));
  const clinicianName = normaliseComparable(provider.clinicianName);
  return nearby.includes(clinicianName) || clinicianProfilePageMatches(provider, page);
}

function bindingForClaim(provider, page, field, excerpt) {
  if (!provider.clinicianName || !clinicianBoundFields.has(field)) {
    return subjectBinding(provider, page.evidenceText, page.domainIdentityVerified);
  }
  const nearby = nearbyExcerptText(page.evidenceText, excerpt);
  const binding = subjectBinding(provider, nearby, false);
  if (binding.subjectType === "clinician" && binding.subjectMatched) return binding;
  if (clinicianProfilePageMatches(provider, page)) {
    return {
      subjectType: "clinician",
      subjectId: provider._canonical?.clinicianId || provider.id,
      subjectName: provider.clinicianName,
      subjectMatched: true
    };
  }
  return { ...binding, subjectMatched: false };
}

function practiceWideEvidence(text, excerpt) {
  const nearby = exactExcerpt(text, new RegExp(String(excerpt || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), 700);
  return /\b(our|all)\s+(?:clinicians?|psychologists?|psychiatrists?|counsellors?|therapists?|team)|\bthe\s+(?:clinic|practice)\s+(?:offers?|provides?)\b/i.test(nearby);
}

function claimId(providerId, field, value, sourceUrl, excerpt) {
  return `claim-${crypto.createHash("sha256").update(`${providerId}|${field}|${JSON.stringify(value)}|${sourceUrl}|${excerpt}`).digest("hex").slice(0, 20)}`;
}

function addClaim(claims, provider, page, field, value, excerpt, extras = {}) {
  if (value === undefined || value === null || value === "" || !excerpt) return;
  const sourceType = extras.sourceType || page.sourceType || "unknown";
  const capturedAt = page.capturedAt || new Date().toISOString();
  const binding = extras.binding || bindingForClaim(provider, page, field, excerpt);
  const item = evidenceItem({
    field,
    value,
    sourceUrl: page.finalUrl || page.url,
    sourceType,
    excerpt,
    capturedAt,
    confidence: extras.confidence || "medium",
    extractor: "deterministic-provider-evidence",
    extractorVersion: "1.0.0",
    needsManualReview: true,
    subjectType: binding.subjectType,
    subjectId: binding.subjectId,
    subjectName: binding.subjectName,
    pageHash: page.sourceHash || "",
    expiresAt: claimExpiresAt(field, value, capturedAt)
  });
  item.claimId = claimId(provider.id, field, value, item.sourceUrl, excerpt);
  item.providerId = provider.id;
  item.subjectMatched = extras.subjectMatched ?? binding.subjectMatched;
  item.practiceWide = extras.practiceWide ?? practiceWideEvidence(page.evidenceText, excerpt);
  item.exactExcerpt = page.evidenceText.includes(excerpt) || String(page.text || "").includes(excerpt);
  item.evidenceKind = extras.evidenceKind || "visible_text";
  claims.push(item);
}

function identityClaims(provider, page, claims) {
  const text = page.evidenceText;
  for (const [field, value] of [["name", provider.name], ["clinicianName", provider.clinicianName], ["practiceName", provider.practiceName]]) {
    if (!value) continue;
    const excerpt = exactExcerpt(text, new RegExp(normaliseComparable(value).split(" ").filter(Boolean).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\n]{0,8}"), "i"));
    if (excerpt) addClaim(claims, provider, page, field, value, excerpt, { confidence: "high", subjectMatched: true });
  }

  for (const [type, pattern] of typePatterns) {
    const excerpt = exactExcerpt(text, pattern);
    if (!excerpt) continue;
    addClaim(claims, provider, page, "type", type, excerpt, { confidence: type === provider.type ? "high" : "medium" });
    break;
  }
}

function contactClaims(provider, page, claims) {
  const html = page.text || "";
  const text = page.evidenceText;
  const mailtos = [...new Map([...html.matchAll(/href\s*=\s*["'](mailto:[^"']+)["']/gi)]
    .map((match) => [normaliseEmail(match[1]), { value: normaliseEmail(match[1]), attribute: match[0] }])).values()];
  const tels = [...new Map([...html.matchAll(/href\s*=\s*["'](tel:[^"']+)["']/gi)]
    .map((match) => [normalisePhone(match[1]), { value: normalisePhone(match[1]), attribute: match[0] }])).values()];
  for (const { value: email, attribute } of mailtos) {
    const visibleExcerpt = exactExcerpt(normaliseCapturedPageText(html), new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    const excerpt = visibleExcerpt || attribute;
    addClaim(claims, provider, page, "email", email, excerpt, { confidence: "high", evidenceKind: visibleExcerpt ? "visible_text" : "mailto_attribute" });
  }
  for (const { value: phone, attribute } of tels) {
    const digits = phone.replace(/\D/g, "");
    const pattern = new RegExp(digits.split("").join("[^0-9]{0,3}"));
    const visibleExcerpt = exactExcerpt(normaliseCapturedPageText(html).replace(/\+64/g, "0"), pattern);
    const excerpt = visibleExcerpt || attribute;
    addClaim(claims, provider, page, "phone", phone, excerpt, { confidence: "high", evidenceKind: visibleExcerpt ? "visible_text" : "tel_attribute" });
  }

  const bookingMatch = html.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]{0,180}?(?:book|appointment|availability)[\s\S]{0,180}?<\/a>/i);
  if (bookingMatch) {
    const bookingUrl = new URL(bookingMatch[1], page.finalUrl || page.url).toString();
    const excerpt = exactExcerpt(text, /\b(book|booking|appointment|check availability)\b/i) || bookingMatch[0].slice(0, 420);
    addClaim(claims, provider, page, "bookingUrl", bookingUrl, excerpt, { confidence: "medium", evidenceKind: "generic_booking_button" });
  }

  const pageUrl = page.finalUrl || page.url;
  const identityName = provider.practiceName || provider.clinicianName || provider.name || "";
  const identityPattern = normaliseComparable(identityName).split(" ").filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\n]{0,12}");
  const domainExcerpt = identityPattern ? exactExcerpt(text, new RegExp(identityPattern, "i")) : "";
  if (domainExcerpt) addClaim(claims, provider, page, "website", new URL(pageUrl).origin, domainExcerpt, { confidence: "high" });

  for (const entry of parseJsonLd(html)) for (const value of walkObjects(entry.value)) {
    const jsonName = value.name || value.legalName || "";
    const binding = subjectBinding(provider, `${text}\n${jsonName}`, page.domainIdentityVerified);
    const jsonExcerpt = (needle) => needle
      ? exactExcerpt(entry.raw, new RegExp(String(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      : "";
    if (value.email) addClaim(claims, provider, page, "email", normaliseEmail(value.email), jsonExcerpt(value.email), { confidence: "high", binding, evidenceKind: "json_ld", subjectMatched: binding.subjectMatched });
    if (value.telephone) addClaim(claims, provider, page, "phone", normalisePhone(value.telephone), jsonExcerpt(value.telephone), { confidence: "high", binding, evidenceKind: "json_ld", subjectMatched: binding.subjectMatched });
    const address = typeof value.address === "string" ? value.address : value.address && typeof value.address === "object"
      ? [value.address.streetAddress, value.address.addressLocality, value.address.addressRegion, value.address.postalCode, value.address.addressCountry].filter(Boolean).join(", ")
      : "";
    const addressNeedle = typeof value.address === "object" ? value.address.streetAddress || value.address.addressLocality : address;
    if (address) addClaim(claims, provider, page, "address", address, jsonExcerpt(addressNeedle), { confidence: "high", binding, evidenceKind: "json_ld", subjectMatched: binding.subjectMatched });
  }
}

function clinicalClaims(provider, page, claims) {
  const text = page.evidenceText;
  const availability = detectAvailabilityFromText(text);
  if (availability.status !== "not_published") {
    const escapedEvidence = String(availability.evidence || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const excerpt = escapedEvidence ? exactExcerpt(text, new RegExp(escapedEvidence, "i")) || availability.evidence : "";
    addClaim(claims, provider, page, "availabilityStatus", availability.status, excerpt, { confidence: "high" });
  }

  const gpReferral = exactExcerpt(text, /\b(gp referral|required referral|referral from (?:your )?gp|must first see (?:your )?gp|referred by (?:a|your) gp)\b/i);
  const selfReferral = exactExcerpt(text, /\b(self[-\s]?referrals?|self[-\s]?refer(?:red|ring)?|refer yourself|book directly|no referral required|without a referral)\b/i);
  if (gpReferral) addClaim(claims, provider, page, "referralType", "gp", gpReferral, { confidence: "high" });
  else if (selfReferral) addClaim(claims, provider, page, "referralType", "self", selfReferral, { confidence: "high" });

  for (const [tag, pattern] of Object.entries(needPatterns)) {
    const excerpt = exactExcerpt(text, pattern);
    if (!excerpt) continue;
    addClaim(claims, provider, page, "tags", tag, excerpt, { confidence: "medium" });
    if (/\b(special interests?|areas? of (?:special interest|expertise|practice)|expertise includes?|I (?:specialise|specialize)|we (?:specialise|specialize))\b/i.test(exactExcerpt(text, pattern, 850))) {
      addClaim(claims, provider, page, "advertisedSpecialties", tag, excerpt, { confidence: "medium" });
    }
  }
  for (const [tag, pattern] of Object.entries(preferencePatterns)) {
    const excerpt = exactExcerpt(text, pattern);
    if (!excerpt) continue;
    addClaim(claims, provider, page, "tags", tag, excerpt, { confidence: "medium" });
    if (tag === "telehealth") addClaim(claims, provider, page, "onlineAvailable", true, excerpt, { confidence: "high" });
  }

  const ageMatches = [
    ["Children", /\b(children|child clients?|tamariki|ages?\s+\d+\s*(?:-|to)\s*1[0-2])\b/i],
    ["Adolescents", /\b(adolescents?|teenagers?|rangatahi|youth|young people|ages?\s+1[3-7])\b/i],
    ["Adults", /\b(adult clients?|adults?|ages?\s+18\+)\b/i],
    ["Older adults", /\b(older adults?|seniors?|kaumatua|kaumātua|ages?\s+(?:60|65)\+)\b/i]
  ];
  for (const [label, pattern] of ageMatches) {
    const excerpt = exactExcerpt(text, pattern);
    if (excerpt) addClaim(claims, provider, page, "ageGroups", [label], excerpt, { confidence: "medium" });
  }

  const genderExcerpt = exactExcerpt(text, /\bpronouns?\s*:?[ \t]*(she\s*\/\s*her|he\s*\/\s*him)\b/i);
  if (genderExcerpt) {
    const value = /she\s*\/\s*her/i.test(genderExcerpt) ? "female" : "male";
    addClaim(claims, provider, page, "providerGender", value, genderExcerpt, { confidence: "high" });
  }

  const costExcerpt = exactExcerpt(text, /\b(\$\s*\d{2,4}(?:\.\d{2})?|fees?|costs?|acc sensitive claims?|winz|disability allowance|eap|funded sessions?|free counselling|sliding scale|reduced fee)\b/i);
  if (costExcerpt) addClaim(claims, provider, page, "cost", costExcerpt, costExcerpt, { confidence: "medium" });
}

export function extractDeterministicProviderClaims(provider, page, options = {}) {
  const evidenceText = page.evidenceText || capturedPageEvidenceText(page.text || "");
  const sourceType = options.sourceType || page.sourceType || classifyProviderSource({
    url: page.finalUrl || page.url,
    provider,
    pageText: evidenceText
  });
  const domainIdentityVerified = options.domainIdentityVerified ?? (sourceType === "provider_owned" || sourceType === "clinic_owned");
  const enrichedPage = { ...page, evidenceText, sourceType, domainIdentityVerified };
  const claims = [];
  identityClaims(provider, enrichedPage, claims);
  contactClaims(provider, enrichedPage, claims);
  clinicalClaims(provider, enrichedPage, claims);
  return claims.filter((claim, index, all) => all.findIndex((candidate) => candidate.claimId === claim.claimId) === index);
}

export function pageIdentityMatchesProvider(provider, pageText = "") {
  const text = normaliseComparable(pageText);
  const names = unique([provider.clinicianName, provider.practiceName, provider.name]).map(normaliseComparable).filter(Boolean);
  const nameMatch = names.some((name) => name.length >= 5 && text.includes(name));
  const typeMatch = typePatterns.some(([type, pattern]) => type === provider.type && pattern.test(pageText));
  return Boolean(nameMatch && typeMatch);
}
