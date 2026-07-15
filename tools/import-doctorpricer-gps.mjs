import fs from "node:fs";
import path from "node:path";
import { geocodeProviderRecords } from "./lib/provider-geocoder.mjs";
import { withAvailabilityDefaults } from "./lib/provider-availability.mjs";
import { confidenceByField, evidenceItem, sourceEvidenceShape } from "./lib/provider-evidence-scorer.mjs";

const DOCTORPRICER_API = "https://doctorpricer.co.nz/api/practices";
const DOCTORPRICER_HOME = "https://doctorpricer.co.nz/";
const IMPORT_SOURCE = "doctorpricer";
const DEFAULT_RATE_LIMIT_MS = 3500;
const DEFAULT_AGE = 25;
const DEFAULT_CSC = false;
const upstreamUrlOverrides = new Map([
  [
    "https://birkenheadmedical.co.nz/",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/birkenhead-medical-centre/at/4-rawene-road-birkenhead-auckland/"
  ],
  [
    "https://www.birkenheadmedical.co.nz/",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/birkenhead-medical-centre/at/4-rawene-road-birkenhead-auckland/"
  ],
  [
    "https://kawhiahc.co.nz",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/kawhia-health-centre/"
  ],
  [
    "https://kawhiahc.co.nz/",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/kawhia-health-centre/"
  ],
  ["https://ashhursthealthcare.nz/", "https://localhealth.nz/"],
  ["https://groupmedical.nz/", "https://localhealth.nz/contact-us/"],
  [
    "https://alexapi.medtechglobal.com:8443/?id=F1Y021-F",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/stewart-street-surgery/"
  ],
  ["http://waverleyhealth.co.nz", ""],
  [
    "http://www.touch-sub.com/pcst/Rosehill%20Christian%20Medical%20Center.html",
    "https://www.healthpoint.co.nz/gps-accident-urgent-medical-care/gp/rosehill-christian-medical-centre/at/2-4-tairere-crescent-rosehill-papakura/"
  ]
]);

const regionSeeds = [
  { region: "Northland", city: "Whangarei", lat: -35.7251, lng: 174.3237 },
  { region: "Auckland", city: "Auckland", lat: -36.8485, lng: 174.7633 },
  { region: "Waikato", city: "Hamilton", lat: -37.787, lng: 175.2793 },
  { region: "Bay of Plenty", city: "Tauranga", lat: -37.6878, lng: 176.1651 },
  { region: "Rotorua and Taupo", city: "Rotorua", lat: -38.1368, lng: 176.2497 },
  { region: "Tairawhiti", city: "Gisborne", lat: -38.6623, lng: 178.0176 },
  { region: "Hawke's Bay", city: "Napier", lat: -39.4928, lng: 176.912 },
  { region: "Taranaki", city: "New Plymouth", lat: -39.0579, lng: 174.0742 },
  { region: "Manawatu-Whanganui", city: "Palmerston North", lat: -40.3523, lng: 175.6082 },
  { region: "Wairarapa", city: "Masterton", lat: -40.9497, lng: 175.6575 },
  { region: "Wellington", city: "Wellington", lat: -41.2865, lng: 174.7762 },
  { region: "Nelson Marlborough Tasman", city: "Nelson", lat: -41.2706, lng: 173.284 },
  { region: "Canterbury", city: "Christchurch", lat: -43.5321, lng: 172.6362 },
  { region: "South Canterbury", city: "Timaru", lat: -44.3967, lng: 171.2536 },
  { region: "West Coast", city: "Greymouth", lat: -42.4504, lng: 171.2108 },
  { region: "Otago", city: "Dunedin", lat: -45.8788, lng: 170.5028 },
  { region: "Southland", city: "Invercargill", lat: -46.4132, lng: 168.3538 }
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noGeocode = args.includes("--no-geocode");
const replaceSource = args.includes("--replace-source");
const positional = args.filter((arg) => !arg.startsWith("--"));
const providersPath = positional[0] || "providers.json";
const rateLimitMs = numberOption("--rate-limit-ms", DEFAULT_RATE_LIMIT_MS);
const age = numberOption("--age", DEFAULT_AGE);
const csc = stringOption("--csc", String(DEFAULT_CSC));
const onlyRegion = stringOption("--region", "");
const seedList = onlyRegion
  ? regionSeeds.filter((seed) => seed.region.toLowerCase() === onlyRegion.toLowerCase())
  : regionSeeds;

if (!seedList.length) {
  console.error(`No DoctorPricer seed matched region "${onlyRegion}".`);
  process.exit(1);
}

function numberOption(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function stringOption(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 || !args[index + 1] ? fallback : args[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function publicUrl(value) {
  const url = normaliseWhitespace(value);
  if (!url || /^null$/i.test(url)) return "";
  if (upstreamUrlOverrides.has(url)) return upstreamUrlOverrides.get(url);
  if (/(health365\.co\.nz|managemyhealth\.co\.nz|patientportal\.myindici\.co\.nz)/i.test(url)) return "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function numberOrEmpty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function kmBetween(aLat, aLng, bLat, bLng) {
  const radius = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const first = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180)
    * Math.cos(bLat * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(first), Math.sqrt(1 - first));
}

function nearestSeed(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return regionSeeds
    .map((seed) => ({ ...seed, distance: kmBetween(lat, lng, seed.lat, seed.lng) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

function cityFromAddress(address, fallbackCity, region) {
  const parts = normaliseWhitespace(address)
    .split(",")
    .map((part) => part.trim().replace(/\b\d{4}\b/g, "").trim())
    .filter(Boolean);
  const regionTokens = new Set([
    region,
    ...regionSeeds.map((seed) => seed.region),
    "New Zealand"
  ].map((value) => String(value || "").toLowerCase()));

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part || regionTokens.has(part.toLowerCase())) continue;
    if (/^(level|suite|unit|shop|floor)\b/i.test(part)) continue;
    if (/^\d/.test(part) && index === 0) continue;
    return part;
  }

  return fallbackCity || "";
}

function hasPublicGpShape(practice) {
  const text = [
    practice.name,
    practice.address,
    practice.url,
    practice.pho
  ].join(" ").toLowerCase();

  if (/(urgent care|accident|after hours|emergency|a\s*&\s*e|white cross|shorecare)/i.test(text)) return false;
  if (/(school|college|student health|university)/i.test(text)) return false;
  if (/(dental|dentist|pharmacy|radiology|physio|physiotherapy|skin clinic|cosmetic)/i.test(text)) return false;

  const pho = normaliseWhitespace(practice.pho);
  if (pho && pho.toLowerCase() !== "null") return true;

  return /(medical|health|doctor|doctors|family|clinic|practice|gp|hauora|whanau|whānau|community)/i.test(text);
}

function culturalTags(practice) {
  const text = [
    practice.name,
    practice.url
  ].join(" ").toLowerCase();
  const tags = [];

  if (/(hauora|whanau|whānau|marae|iwi|maori|māori|kaupapa|ngāti|ngati)/i.test(text)) tags.push("maori");
  if (/(pasifika|pacific|etu pasifika|etū pasifika|tongan|samoan|cook islands|vaka|fono)/i.test(text)) tags.push("pasifika");
  if (/(asian|chinese|korean|indian|mandarin|cantonese|hong kong|vietnamese|japanese|filipino|thai)/i.test(text)) tags.push("asian");

  return tags;
}

function priceLabel(price) {
  const number = Number(price);
  if (!Number.isFinite(number) || number <= 0 || number >= 900) {
    return "Fees vary by practice. Ask about enrolled-patient fees, Community Services Card rates, low-cost access, and funded mental health support.";
  }
  const rounded = Math.round(number * 100) / 100;
  return `DoctorPricer reports an adult GP fee around $${rounded}; fees can change, so ask about the current fee, Community Services Card rates, and funded mental health support.`;
}

function firstStepFor(practice) {
  const enrolling = Boolean(practice.active);
  const intro = practice.phone
    ? `Call ${practice.phone}`
    : "Use the practice website";

  if (enrolling) {
    return `${intro} and ask whether they are enrolling new patients, what the first appointment costs, and whether a GP or nurse can help with mental health or medication support.`;
  }

  return `${intro} to ask about a GP or nurse appointment. If you are not enrolled there, ask whether enrolments have reopened or whether they can suggest the nearest practice taking new patients.`;
}

function mapPractice(practice, seed, fetchedAt) {
  const lat = numberOrEmpty(practice.lat);
  const lon = numberOrEmpty(practice.lng);
  const nearest = nearestSeed(lat, lon) || seed;
  const region = nearest.region;
  const city = cityFromAddress(practice.address, nearest.city, region);
  const name = normaliseWhitespace(practice.name);
  const address = normaliseWhitespace(practice.address);
  const phone = normaliseWhitespace(practice.phone);
  const website = publicUrl(practice.url);
  const tags = [
    "gp",
    "primary-care",
    "mental-health",
    "medication",
    "depression",
    "anxiety",
    "work",
    "cost",
    practice.active ? "enrolling" : "not-enrolling",
    ...culturalTags(practice)
  ];
  const capturedAt = `${fetchedAt}-01T00:00:00.000Z`;
  const evidence = [
    evidenceItem({ field: "name", value: name, sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: `DoctorPricer practice name: ${name}.`, capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true }),
    evidenceItem({ field: "type", value: "gp", sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: "DoctorPricer public practice listing used for GP discovery and fees.", capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true }),
    evidenceItem({ field: "address", value: address, sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: `DoctorPricer practice address: ${address}.`, capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true }),
    evidenceItem({ field: "phone", value: phone, sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: `DoctorPricer practice phone: ${phone}.`, capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true }),
    evidenceItem({ field: "website", value: website, sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: `DoctorPricer linked website: ${website}.`, capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true }),
    evidenceItem({ field: "cost", value: priceLabel(practice.price), sourceUrl: DOCTORPRICER_HOME, sourceType: "third_party_directory", excerpt: `DoctorPricer adult fee/enrolment data: ${priceLabel(practice.price)}.`, capturedAt, confidence: "medium", extractor: IMPORT_SOURCE, needsManualReview: true })
  ].filter((item) => item.value);

  return withAvailabilityDefaults({
    id: `gp-${slugify(practice.id || `${name}-${practice.address}`)}`,
    name,
    type: "gp",
    region,
    city,
    address,
    phone,
    text: "",
    email: "",
    website,
    lat,
    lon,
    ...(lat && lon ? {
      coordinateSource: `DoctorPricer public API ${fetchedAt}`,
      coordinatePrecision: "business listing",
      coordinateConfidence: "medium",
      geocodeNeedsManualReview: true
    } : {}),
    hours: "Ask the practice about appointment, enrolment, and after-hours options.",
    cost: priceLabel(practice.price),
    tags: [...new Set(tags)],
    needScope: [],
    fit: "General practice team that can help with mental health first steps, medication discussion, medical certificates, referrals, and access to funded primary mental health support where available.",
    firstStep: firstStepFor(practice),
    source: DOCTORPRICER_HOME,
    verified: fetchedAt,
    lastVerified: fetchedAt,
    confidence: "medium",
    sourceQuality: "third-party public GP listing",
    needsManualVerification: true,
    importSource: IMPORT_SOURCE,
    doctorPricer: {
      id: practice.id || "",
      pho: normaliseWhitespace(practice.pho),
      enrolling: Boolean(practice.active),
      adultFee: Number.isFinite(Number(practice.price)) ? Number(practice.price) : ""
    },
    sourceEvidence: sourceEvidenceShape(evidence),
    confidenceByField: confidenceByField(evidence)
  }, { checkedAt: fetchedAt });
}

function mergeProvider(previous, incoming) {
  if (!previous) return incoming;
  const merged = { ...previous };

  for (const [key, value] of Object.entries(incoming)) {
    if (previous.importSource === IMPORT_SOURCE && key === "website" && value === "") {
      merged.website = "";
      continue;
    }

    const emptyArray = Array.isArray(value) && value.length === 0 && key !== "needScope";
    const emptyObject = value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length;
    if (value === "" || value === undefined || value === null || emptyArray || emptyObject) continue;
    merged[key] = value;
  }

  return merged;
}

async function fetchPracticesForSeed(seed, attempt = 1) {
  const url = new URL(DOCTORPRICER_API);
  url.searchParams.set("lat", seed.lat);
  url.searchParams.set("lng", seed.lng);
  url.searchParams.set("age", age);
  url.searchParams.set("csc", csc);

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "CareFinderAotearoa/1.0 GP refresh (https://github.com/johnfinnertynz/healthcare-finder-nz)"
    }
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) {
    const waitMs = response.status === 429 ? Math.max(rateLimitMs * 6, 60000) : rateLimitMs * 2;
    if (attempt < 3) {
      console.warn(`DoctorPricer ${seed.region} returned ${response.status}; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}.`);
      await sleep(waitMs);
      return fetchPracticesForSeed(seed, attempt + 1);
    }

    throw new Error(`DoctorPricer request failed for ${seed.region}: ${response.status} ${response.statusText || ""}`);
  }

  return response.json();
}

const existing = fs.existsSync(providersPath) ? JSON.parse(fs.readFileSync(providersPath, "utf8")) : [];
const providersById = new Map(existing.map((provider) => [provider.id, provider]));
const fetchedAt = new Date().toISOString().slice(0, 7);
const seenDoctorPricerIds = new Set();
const changedIds = new Set();
const importedKeys = new Set();
const importedById = new Map();
let rawCount = 0;
let filteredOut = 0;
let added = 0;
let updated = 0;

for (const [index, seed] of seedList.entries()) {
  const practices = await fetchPracticesForSeed(seed);
  rawCount += practices.length;
  console.log(`DoctorPricer ${seed.region}: ${practices.length} records`);

  for (const practice of practices) {
    if (!practice?.name || !hasPublicGpShape(practice)) {
      filteredOut += 1;
      continue;
    }

    const key = slugify(`${practice.name}-${practice.address || practice.id || ""}`);
    if (importedKeys.has(key)) continue;

    const record = mapPractice(practice, seed, fetchedAt);
    if (importedById.has(record.id)) continue;
    importedKeys.add(key);
    importedById.set(record.id, record);
    seenDoctorPricerIds.add(record.id);
  }

  if (index < seedList.length - 1) await sleep(rateLimitMs);
}

for (const record of importedById.values()) {
  if (providersById.has(record.id)) updated += 1;
  else added += 1;

  providersById.set(record.id, mergeProvider(providersById.get(record.id), record));
  changedIds.add(record.id);
}

if (replaceSource && seedList.length === regionSeeds.length) {
  for (const [id, provider] of providersById.entries()) {
    if (provider.importSource === IMPORT_SOURCE && !seenDoctorPricerIds.has(id)) {
      providersById.delete(id);
    }
  }
}

const output = [...providersById.values()].sort((a, b) =>
  a.region.localeCompare(b.region) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
);

const geocodeSummary = noGeocode
  ? null
  : await geocodeProviderRecords(output, {
      providerIds: changedIds,
      failSoft: true
    });

if (!dryRun) {
  fs.mkdirSync(path.dirname(path.resolve(providersPath)), { recursive: true });
  fs.writeFileSync(providersPath, `${JSON.stringify(output, null, 2)}\n`);
}

console.log(`DoctorPricer GP import complete. Raw records ${rawCount}; filtered out ${filteredOut}; unique public GP clinics ${importedById.size}.`);
console.log(`Added ${added}; updated ${updated};${dryRun ? " dry run, not written;" : ""} output ${path.resolve(providersPath)}.`);
if (geocodeSummary) {
  for (const line of geocodeSummary.logs) console.log(line);
  console.log(`Geocoding for this import: checked ${geocodeSummary.checked}; updated ${geocodeSummary.updated}; no match ${geocodeSummary.noMatch}; failed ${geocodeSummary.failed}; skipped ${geocodeSummary.skipped}.`);
}
