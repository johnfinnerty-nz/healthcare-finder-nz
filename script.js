const form = document.querySelector("#intakeForm");
const profileLine = document.querySelector("#profileLine");
const resultList = document.querySelector("#resultList");
const contactMessage = document.querySelector("#contactMessage");
const contactName = document.querySelector("#contactName");
const contactReply = document.querySelector("#contactReply");
const contactAsk = document.querySelector("#contactAsk");
const contactComfort = document.querySelector("#contactComfort");
const contactPreference = document.querySelector("#contactPreference");
const copyMessage = document.querySelector("#copyMessage");
const copyStatus = document.querySelector("#copyStatus");
const emailMessage = document.querySelector("#emailMessage");
const callTarget = document.querySelector("#callTarget");
const textTarget = document.querySelector("#textTarget");
const websiteTarget = document.querySelector("#websiteTarget");
const contactAvailability = document.querySelector("#contactAvailability");
const addressInput = document.querySelector("#address");
const addressSuggestions = document.querySelector("#addressSuggestions");
const addressStatus = document.querySelector("#addressStatus");
const providerSearch = document.querySelector("#providerSearch");
const providerType = document.querySelector("#providerType");
const providerCost = document.querySelector("#providerCost");
const providerCount = document.querySelector("#providerCount");
const providerUpdatedDate = document.querySelector("#providerUpdatedDate");
const providerList = document.querySelector("#providerList");
const showMoreProviders = document.querySelector("#showMoreProviders");
const selectedProvider = document.querySelector("#selectedProvider");
const providerFinder = document.querySelector(".provider-finder");
const contactLayout = document.querySelector(".contact-layout");
const canterburyOnlyContact = document.querySelector(".canterbury-only-contact");
const formProgressBar = document.querySelector("#formProgressBar");
const formProgressText = document.querySelector("#formProgressText");

let providers = [];
let selectedProviderId = "";
let contactProviderId = "";
let providerVisibleCount = 5;
let userCoords = null;
let matchedRegion = "";
let providerLoadError = "";
let providerDirectoryFallbackActive = false;
let addressSuggestionMatches = [];
let activeAddressSuggestionIndex = -1;
let addressLookupController = null;
let addressLookupToken = 0;
let wasIntakeComplete = false;
let pendingCarePathScroll = false;
let carePathScrollScheduled = false;
const providerBatchSize = 5;
const telehealthDistanceThresholdKm = 100;
const localInPersonDistanceCapKm = 30;
const availabilityStatuses = new Set([
  "accepting",
  "waitlist",
  "not_accepting",
  "referrals_paused",
  "unknown",
  "not_published"
]);
const restrictiveAvailabilityStatuses = new Set(["not_accepting", "referrals_paused"]);
const psychiatristReferralTypes = new Set(["gp", "self", "specialist", "unknown"]);
const psychiatristReferralConfidences = new Set(["high", "medium", "low"]);
const distanceCappedLocalTypes = new Set(["gp", "counsellor", "psychologist", "psychiatrist", "mens-centre"]);
const availabilityCadenceDays = {
  accepting: 90,
  waitlist: 30,
  not_accepting: 14,
  referrals_paused: 14,
  unknown: 90,
  not_published: 90
};

const links = {
  healthNz: "https://www.healthnz.govt.nz/health-topics/mental-health/where-to-get-help",
  winz: "https://www.workandincome.govt.nz/eligibility/health-and-disability/counselling.html",
  accessChoice: "https://www.wellbeingsupport.health.nz/about-access-and-choice",
  healthpoint: "https://www.healthpoint.co.nz/mental-health-addictions/",
  canMen: "https://www.canmen.org.nz/",
  acc: "https://www.acc.co.nz/for-providers/provider-contracts-and-services/sensitive-claims-service"
};

const needLabels = {
  depression: "depression or low mood",
  anxiety: "anxiety, panic, or overwhelm",
  trauma: "trauma or sexual harm",
  addiction: "alcohol, drug, or gambling harm",
  work: "work, study, money, or housing stress"
};

const scopedNeedLabels = {
  trauma: "trauma or sexual harm",
  addiction: "alcohol, drug, or gambling harm",
  work: "work, study, money, or housing stress"
};

const broadNeedTags = ["depression", "anxiety", "work", "stress", "relationships", "grief", "addiction"];

const barrierLabels = {
  cost: "cost",
  wait: "long waits",
  transport: "transport",
  privacy: "privacy or shame",
  culture: "finding culturally safe support"
};

const preferenceLabels = {
  maori: "Maori provider or kaupapa Maori support",
  pasifika: "Pasifika provider or service",
  asian: "Asian provider or service",
  rainbow: "Rainbow / LGBTQIA+ affirming support",
  "trauma-informed": "trauma-informed support",
  telehealth: "phone or video appointments",
  "female-provider": "a female provider",
  "male-provider": "a male provider"
};

const regionAliases = {
  northland: "Northland",
  auckland: "Auckland",
  waikato: "Waikato",
  "bay of plenty": "Bay of Plenty",
  "rotorua and taupo": "Rotorua and Taupo",
  rotorua: "Rotorua and Taupo",
  taupo: "Rotorua and Taupo",
  gisborne: "Tairawhiti",
  tairawhiti: "Tairawhiti",
  "hawke's bay": "Hawke's Bay",
  hawkes: "Hawke's Bay",
  taranaki: "Taranaki",
  "manawatu-whanganui": "Manawatu-Whanganui",
  manawatu: "Manawatu-Whanganui",
  whanganui: "Manawatu-Whanganui",
  wairarapa: "Wairarapa",
  wellington: "Wellington",
  hutt: "Wellington",
  kapiti: "Wellington",
  tasman: "Nelson Marlborough Tasman",
  nelson: "Nelson Marlborough Tasman",
  marlborough: "Nelson Marlborough Tasman",
  "west coast": "West Coast",
  canterbury: "Canterbury",
  christchurch: "Canterbury",
  "south canterbury": "South Canterbury",
  timaru: "South Canterbury",
  otago: "Otago",
  dunedin: "Otago",
  southland: "Southland",
  invercargill: "Southland"
};

const regionCentres = [
  { region: "Northland", lat: -35.725, lon: 174.323 },
  { region: "Auckland", lat: -36.848, lon: 174.763 },
  { region: "Waikato", lat: -37.787, lon: 175.279 },
  { region: "Bay of Plenty", lat: -37.687, lon: 176.166 },
  { region: "Rotorua and Taupo", lat: -38.136, lon: 176.249 },
  { region: "Tairawhiti", lat: -38.662, lon: 178.018 },
  { region: "Hawke's Bay", lat: -39.492, lon: 176.912 },
  { region: "Taranaki", lat: -39.057, lon: 174.079 },
  { region: "Manawatu-Whanganui", lat: -40.353, lon: 175.608 },
  { region: "Wairarapa", lat: -40.951, lon: 175.658 },
  { region: "Wellington", lat: -41.286, lon: 174.776 },
  { region: "Nelson Marlborough Tasman", lat: -41.513, lon: 173.962 },
  { region: "West Coast", lat: -42.451, lon: 171.211 },
  { region: "Canterbury", lat: -43.532, lon: 172.636 },
  { region: "South Canterbury", lat: -44.397, lon: 171.255 },
  { region: "Otago", lat: -45.879, lon: 170.501 },
  { region: "Southland", lat: -46.413, lon: 168.353 }
];

const fallbackAddressPlaces = [
  { name: "Auckland Central", city: "Auckland", region: "Auckland", lat: -36.8485, lon: 174.7633 },
  { name: "Albany", city: "Auckland", region: "Auckland", lat: -36.7285, lon: 174.7013 },
  { name: "Henderson", city: "Auckland", region: "Auckland", lat: -36.8772, lon: 174.6302 },
  { name: "Manukau", city: "Auckland", region: "Auckland", lat: -36.9928, lon: 174.8793 },
  { name: "New Lynn", city: "Auckland", region: "Auckland", lat: -36.9089, lon: 174.6858 },
  { name: "Hamilton", city: "Hamilton", region: "Waikato", lat: -37.787, lon: 175.2793 },
  { name: "Tauranga", city: "Tauranga", region: "Bay of Plenty", lat: -37.6878, lon: 176.1651 },
  { name: "Rotorua", city: "Rotorua", region: "Rotorua and Taupo", lat: -38.1368, lon: 176.2497 },
  { name: "Taupo", city: "Taupo", region: "Rotorua and Taupo", lat: -38.6857, lon: 176.0702 },
  { name: "Gisborne", city: "Gisborne", region: "Tairawhiti", lat: -38.6623, lon: 178.0176 },
  { name: "Napier", city: "Napier", region: "Hawke's Bay", lat: -39.4928, lon: 176.912 },
  { name: "Hastings", city: "Hastings", region: "Hawke's Bay", lat: -39.6381, lon: 176.8492 },
  { name: "New Plymouth", city: "New Plymouth", region: "Taranaki", lat: -39.0556, lon: 174.0752 },
  { name: "Palmerston North", city: "Palmerston North", region: "Manawatu-Whanganui", lat: -40.3523, lon: 175.6082 },
  { name: "Whanganui", city: "Whanganui", region: "Manawatu-Whanganui", lat: -39.9301, lon: 175.0479 },
  { name: "Masterton", city: "Masterton", region: "Wairarapa", lat: -40.9511, lon: 175.6574 },
  { name: "Wellington Central", city: "Wellington", region: "Wellington", lat: -41.2865, lon: 174.7762 },
  { name: "Lower Hutt", city: "Lower Hutt", region: "Wellington", lat: -41.2125, lon: 174.9003 },
  { name: "Porirua", city: "Porirua", region: "Wellington", lat: -41.1243, lon: 174.8393 },
  { name: "Nelson", city: "Nelson", region: "Nelson Marlborough Tasman", lat: -41.2706, lon: 173.284 },
  { name: "Golden Bay / Takaka", city: "Takaka", region: "Nelson Marlborough Tasman", lat: -40.8564, lon: 172.8069 },
  { name: "Blenheim", city: "Blenheim", region: "Nelson Marlborough Tasman", lat: -41.5134, lon: 173.9612 },
  { name: "Greymouth", city: "Greymouth", region: "West Coast", lat: -42.4504, lon: 171.2108 },
  { name: "Christchurch Central", city: "Christchurch", region: "Canterbury", lat: -43.5321, lon: 172.6362 },
  { name: "Linwood", city: "Christchurch", region: "Canterbury", lat: -43.5329, lon: 172.6724 },
  { name: "Riccarton", city: "Christchurch", region: "Canterbury", lat: -43.5309, lon: 172.5986 },
  { name: "Papanui", city: "Christchurch", region: "Canterbury", lat: -43.4955, lon: 172.6076 },
  { name: "New Brighton", city: "Christchurch", region: "Canterbury", lat: -43.5067, lon: 172.7292 },
  { name: "Rangiora", city: "Rangiora", region: "Canterbury", lat: -43.3035, lon: 172.5957 },
  { name: "Rolleston", city: "Rolleston", region: "Canterbury", lat: -43.5962, lon: 172.3832 },
  { name: "Timaru", city: "Timaru", region: "South Canterbury", lat: -44.397, lon: 171.255 },
  { name: "Dunedin Central", city: "Dunedin", region: "Otago", lat: -45.8795, lon: 170.5006 },
  { name: "Queenstown", city: "Queenstown", region: "Otago", lat: -45.0312, lon: 168.6626 },
  { name: "Invercargill", city: "Invercargill", region: "Southland", lat: -46.4132, lon: 168.3538 }
];

const optInPreferenceTags = ["maori", "pasifika", "asian", "rainbow"];
const supportPreferenceTags = [...optInPreferenceTags, "trauma-informed"];
const providerGenderPreferenceTags = {
  "female-provider": "female",
  "male-provider": "male"
};
const matchablePreferenceTags = [
  ...supportPreferenceTags,
  ...Object.values(providerGenderPreferenceTags)
];

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
}

function enforceExclusiveProviderGenderPreference(changedInput) {
  if (!changedInput || changedInput.name !== "preference" || !changedInput.checked) return;
  const opposite = {
    "female-provider": "male-provider",
    "male-provider": "female-provider"
  }[changedInput.value];
  if (!opposite) return;
  const oppositeInput = document.querySelector(`input[name="preference"][value="${opposite}"]`);
  if (oppositeInput) oppositeInput.checked = false;
}

function intakeStatus() {
  const age = Number(document.querySelector("#age").value || 0);
  const address = addressInput.value.trim();
  const hasResolvedAddress = Boolean(matchedRegion || userCoords);
  const identity = document.querySelector("#identity").value;
  const needs = checkedValues("need");
  const preferences = checkedValues("preference");
  const telehealthPreferred = preferences.includes("telehealth");
  const preference = contactPreference.value;
  const missing = [];
  let completed = 0;

  if (age) completed += 1;
  else missing.push("age");
  if (telehealthPreferred || (address && hasResolvedAddress)) completed += 1;
  else missing.push("street address or suburb");
  if (identity) completed += 1;
  else missing.push("gender");
  if (needs.length) completed += 1;
  else missing.push("what is happening");
  if (preference) completed += 1;
  else missing.push("who you want to talk to");

  return { complete: missing.length === 0, completed, total: 5, missing };
}

function renderProgress(status) {
  const percent = Math.round((status.completed / status.total) * 100);
  formProgressBar.style.width = `${percent}%`;
  formProgressText.textContent = status.complete
    ? "Guide questions complete"
    : `${status.completed} of ${status.total} guide questions complete`;
}

function syncAddressRequirement() {
  const telehealthPreferred = checkedValues("preference").includes("telehealth");
  const addressEmpty = !addressInput.value.trim() && !matchedRegion && !userCoords;

  addressInput.required = !telehealthPreferred;
  addressInput.setAttribute("aria-required", telehealthPreferred ? "false" : "true");

  if (telehealthPreferred && addressEmpty) {
    addressStatus.textContent = "Address is optional when you choose telehealth.";
  } else if (!telehealthPreferred && addressEmpty) {
    addressStatus.textContent = "Start typing a New Zealand address or suburb.";
  }
}

function sentenceList(items) {
  if (items.length === 0) return "general wellbeing support";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function labelledList(items, labels) {
  return sentenceList(items.map((item) => labels[item] || item));
}

function preferenceTagFor(preference) {
  return providerGenderPreferenceTags[preference] || preference;
}

function selectedSupportPreferences(preferences = checkedValues("preference")) {
  return preferences
    .map(preferenceTagFor)
    .filter((preference) => matchablePreferenceTags.includes(preference));
}

function selectedProviderGenderPreference(preferences = checkedValues("preference")) {
  const wantsFemale = preferences.includes("female-provider");
  const wantsMale = preferences.includes("male-provider");
  if (wantsFemale === wantsMale) return "";
  return wantsFemale ? "female" : "male";
}

function providerGenderFor(providerOrTags = {}) {
  const tags = Array.isArray(providerOrTags) ? providerOrTags : providerOrTags.tags || [];
  const explicit = Array.isArray(providerOrTags) ? "" : String(providerOrTags.providerGender || "").toLowerCase();
  if (explicit === "female" || explicit === "male") return explicit;

  const hasFemaleTag = tags.includes("female");
  const hasMaleTag = tags.includes("male");
  if (hasFemaleTag && !hasMaleTag) return "female";
  if (hasMaleTag && !hasFemaleTag) return "male";
  return "";
}

function providerMatchesSelectedGender(providerOrTags, preferences = checkedValues("preference")) {
  const selectedGender = selectedProviderGenderPreference(preferences);
  return !selectedGender || providerGenderFor(providerOrTags) === selectedGender;
}

function supportPreferenceMatches(providerOrTags, preferences = checkedValues("preference")) {
  const tags = Array.isArray(providerOrTags) ? providerOrTags : providerOrTags.tags || [];
  const selected = selectedSupportPreferences(preferences);
  const providerGender = providerGenderFor(providerOrTags);

  return selected.filter((preference) => {
    if (preference === "female" || preference === "male") return providerGender === preference;
    return tags.includes(preference);
  });
}

function hasProviderGenderConflict(providerOrTags, preferences = checkedValues("preference")) {
  const selectedGender = selectedProviderGenderPreference(preferences);
  const providerGender = providerGenderFor(providerOrTags);
  return Boolean(selectedGender && providerGender && providerGender !== selectedGender);
}

function addPath(paths, item) {
  if (!paths.some((path) => path.title === item.title)) paths.push(item);
}

function normalisePhone(phone) {
  return String(phone || "")
    .replace(/[^\d+]/g, "")
    .replace(/(?!^)\+/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeClassToken(value, fallback = "unknown") {
  const token = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || fallback;
}

function safeMailAddress(value) {
  const email = String(value || "").trim();
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) return "";
  return email;
}

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) return "";
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" });
}

function providerDatabaseDateLabel() {
  const verifiedMonths = providers
    .map((provider) => provider.lastVerified || provider.verified)
    .filter((value) => /^\d{4}-\d{2}$/.test(value || ""))
    .sort();
  return monthLabel(verifiedMonths.at(-1));
}

function renderProviderUpdatedDate() {
  if (!providerUpdatedDate) return;
  const label = providerDatabaseDateLabel();
  providerUpdatedDate.textContent = label
    ? `Provider database last updated: ${label}. Please confirm availability, cost, and eligibility with the provider.`
    : "Provider database update date unavailable. Please confirm details with the provider.";
}

function providerAvailabilityStatus(provider) {
  return availabilityStatuses.has(provider.availabilityStatus)
    ? provider.availabilityStatus
    : "not_published";
}

function parseAvailabilityDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return new Date(`${text}-01T00:00:00Z`);
  return null;
}

function availabilityDateLabel(value) {
  const date = parseAvailabilityDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-NZ", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function providerAvailabilityStale(provider) {
  const status = providerAvailabilityStatus(provider);
  const cadence = availabilityCadenceDays[status];
  const date = parseAvailabilityDate(provider.availabilityCheckedAt);
  if (!cadence || !date) return false;
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days > cadence;
}

function providerExplicitlyAccepting(provider) {
  return providerAvailabilityStatus(provider) === "accepting"
    && Boolean(String(provider.availabilityEvidence || "").trim())
    && !providerAvailabilityStale(provider);
}

function isUnavailableForFirstRecommendations(provider) {
  return restrictiveAvailabilityStatuses.has(providerAvailabilityStatus(provider));
}

function providerAvailabilitySortTier(provider) {
  const status = providerAvailabilityStatus(provider);
  if (providerExplicitlyAccepting(provider)) return 3;
  if (status === "unknown" || status === "not_published") return 2;
  if (status === "waitlist") return 1;
  return isUnavailableForFirstRecommendations(provider) ? 0 : 2;
}

function providerAvailabilityScore(provider) {
  const status = providerAvailabilityStatus(provider);
  if (providerExplicitlyAccepting(provider)) return 2;
  if (status === "waitlist") return -10;
  if (isUnavailableForFirstRecommendations(provider)) return -120;
  return 0;
}

function providerAvailabilityNote(provider, { compact = false } = {}) {
  const status = providerAvailabilityStatus(provider);
  const checkedLabel = availabilityDateLabel(provider.availabilityCheckedAt);
  const stale = providerAvailabilityStale(provider);
  const showStalePrefix = stale && !["unknown", "not_published"].includes(status);
  const suffix = checkedLabel
    ? ` Last checked ${checkedLabel}; confirm before relying on it.`
    : " Confirm before relying on it.";
  const stalePrefix = showStalePrefix ? "Availability needs rechecking: " : "";

  const labels = {
    accepting: "Listed as accepting new clients.",
    waitlist: "May have a waitlist.",
    not_accepting: "Listed as not accepting new clients.",
    referrals_paused: "Referrals appear to be paused.",
    unknown: "Availability is not clearly published.",
    not_published: "Availability is not clearly published."
  };

  if (compact) return `${stalePrefix}${labels[status] || "Availability should be confirmed."}${suffix}`;
  return `${stalePrefix}${labels[status] || "Availability should be confirmed."}${suffix}`;
}

function isPsychiatryProvider(provider) {
  return provider.type === "psychiatrist" || provider.tags?.includes("psychiatry-service");
}

function providerReferralType(provider) {
  return psychiatristReferralTypes.has(provider.referralType) ? provider.referralType : "unknown";
}

function providerReferralConfidence(provider) {
  return psychiatristReferralConfidences.has(provider.referralConfidence) ? provider.referralConfidence : "low";
}

function providerRequiresGpReferral(provider) {
  return isPsychiatryProvider(provider)
    && (provider.requiresReferral === true || providerReferralType(provider) === "gp");
}

function providerReferralSortTier(provider) {
  if (!isPsychiatryProvider(provider)) return 2;
  const type = providerReferralType(provider);
  if (type === "self") return 3;
  if (type === "unknown") return 2;
  return type === "gp" || type === "specialist" ? 1 : 2;
}

function providerReferralScore(provider) {
  if (selectedContactType() !== "psychiatrist" || !isPsychiatryProvider(provider)) return 0;
  const type = providerReferralType(provider);
  if (type === "self") return 8;
  if (type === "unknown") return -2;
  if (type === "gp" || type === "specialist") return -6;
  return 0;
}

function providerReferralNote(provider) {
  if (!isPsychiatryProvider(provider)) return "";
  const type = providerReferralType(provider);
  if (type === "self") return "Self-referral appears available. Please confirm current booking requirements.";
  if (type === "gp") return "GP referral required. A GP appointment is the practical first step.";
  if (type === "specialist") return "Specialist referral may be required. Please check the referral pathway first.";
  return "Referral requirements unclear - please check with the provider or your GP.";
}

function safeHref(value, { allowHash = false } = {}) {
  const href = String(value || "").trim();
  if (allowHash && /^#[\w-]+$/.test(href)) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return "";
}

function externalLinkAttrs(href) {
  return /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
}

function isChristchurchMensSupportRelevant(location = matchedRegion) {
  return location === "Canterbury";
}

function profileText(provider) {
  return [
    provider.name,
    provider.type,
    provider.region,
    provider.city,
    provider.cost,
    provider.fit,
    provider.firstStep,
    provider.appointmentWait,
    ...(provider.specialties || []),
    ...(provider.services || []),
    ...(provider.ageGroups || []),
    ...(provider.patientGroups || []),
    ...(provider.languages || []),
    ...(provider.tags || [])
  ].join(" ").toLowerCase();
}

function specialtySupportedByText(specialty, text) {
  const value = String(specialty || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!value) return false;
  if (text.includes(value)) return true;
  const words = value
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 4 && !["disorder", "disorders", "support", "therapy", "assessment"].includes(word));
  return words.length > 0 && words.some((word) => text.includes(word));
}

function advertisedSpecialtyEvidenceText(provider) {
  return (provider.advertisedSpecialtyEvidence || [])
    .map((item) => {
      if (typeof item === "string") return item;
      return [
        item?.value,
        item?.excerpt,
        item?.field,
        item?.sourceUrl
      ].filter(Boolean).join(" ");
    })
    .join(" ")
    .toLowerCase();
}

function sourceBackedAdvertisedSpecialties(provider) {
  const listed = Array.isArray(provider.advertisedSpecialties) ? provider.advertisedSpecialties : [];
  if (!listed.length) return [];
  const evidence = advertisedSpecialtyEvidenceText(provider);
  if (!evidence) return [];
  return listed.filter((specialty) => specialtySupportedByText(specialty, evidence));
}

function advertisedSpecialtyText(provider) {
  const listed = Array.isArray(provider.advertisedSpecialties) && provider.advertisedSpecialties.length
    ? sourceBackedAdvertisedSpecialties(provider)
    : Array.isArray(provider.specialties)
      ? provider.specialties
      : [];

  const values = [
    ...listed,
    ...(provider.services || []),
    ...(provider.patientGroups || [])
  ];

  if (provider.type !== "psychiatrist") {
    values.push(provider.fit || "", provider.firstStep || "", ...(provider.tags || []));
  } else {
    const fit = provider.fit || "";
    const match = fit.match(/(?:specialt(?:y|ies)|special interests?|listed interests?) (?:including|include|are)?\s+(.+?)(?:\.|$)/i);
    if (match) values.push(match[1]);
  }

  return values.join(" ").toLowerCase();
}

function hasAdvertisedSpecialtyMatch(provider, need) {
  const text = advertisedSpecialtyText(provider);
  const terms = {
    depression: ["depression", "low mood", "mood"],
    anxiety: ["anxiety", "panic", "overwhelm", "obsessive-compulsive", "ocd"],
    trauma: ["trauma", "sexual harm", "sexual abuse", "sensitive claims", "emdr", "dissociative"],
    addiction: ["addiction", "alcohol", "drug", "gambling"],
    work: ["work", "stress", "study", "money", "housing", "burnout"]
  }[need] || [need];

  return terms.some((term) => text.includes(term));
}

function hasPsychiatristBaselineMatch(provider, need) {
  if (provider.type !== "psychiatrist") return false;
  const scope = (provider.baselineScope || []).join(" ").toLowerCase();
  const terms = {
    depression: ["depression", "mood", "bipolar", "medication", "diagnosis", "risk"],
    anxiety: ["anxiety", "medication", "diagnosis", "risk"],
    trauma: ["trauma", "ptsd", "medication", "diagnosis", "risk"],
    addiction: ["addiction", "substance", "medication", "diagnosis", "risk"],
    work: ["diagnosis", "risk"]
  }[need] || [need];
  return terms.some((term) => scope.includes(term));
}

function providerSourcePath(provider) {
  try {
    return new URL(provider.source || provider.website || "").pathname.toLowerCase();
  } catch {
    return "";
  }
}

function providerNeedScope(provider) {
  if (Array.isArray(provider.needScope) && provider.needScope.length) {
    return [...new Set(provider.needScope.filter((need) => scopedNeedLabels[need]))];
  }

  const tags = provider.tags || [];
  const text = profileText(provider);
  const scopes = [];
  const hasBroadNeed = broadNeedTags.some((tag) => tags.includes(tag));
  const sexualHarmOnly = (tags.includes("sexual-harm")
      || tags.includes("sensitive-claims")
      || providerSourcePath(provider).includes("/sexual-harm/")
      || /rape|sexual abuse|sexual harm|sensitive claims/i.test(text))
    && !hasBroadNeed;
  const addictionOnly = (provider.type === "addiction"
      || (provider.type === "helpline" && tags.includes("addiction"))
      || tags.includes("gambling"))
    && !["depression", "anxiety", "trauma", "work"].some((tag) => tags.includes(tag));
  const rehabWorkOnly = provider.type === "psychologist"
    && tags.includes("rehabilitation")
    && ["acc", "concussion", "pain", "return-to-work", "vocational"].some((tag) => tags.includes(tag))
    && !["depression", "anxiety", "trauma", "addiction", "relationships", "grief"].some((tag) => tags.includes(tag));

  if (sexualHarmOnly) scopes.push("trauma");
  if (addictionOnly) scopes.push("addiction");
  if (rehabWorkOnly) scopes.push("work");
  return [...new Set(scopes)];
}

function providerMatchesSelectedNeeds(provider, needs = checkedValues("need")) {
  const scope = providerNeedScope(provider);
  return !scope.length || !needs.length || scope.some((need) => needs.includes(need));
}

function providerNeedScopeLabel(provider) {
  const scope = providerNeedScope(provider);
  return scope.map((need) => scopedNeedLabels[need]).filter(Boolean).join(" or ");
}

function providerSpecialties(provider) {
  if (Array.isArray(provider.advertisedSpecialties) && provider.advertisedSpecialties.length) {
    const sourceBacked = sourceBackedAdvertisedSpecialties(provider);
    if (sourceBacked.length) return sourceBacked.slice(0, 6).join(", ");
    if (provider.type === "psychiatrist") return "";
  }

  if (Array.isArray(provider.specialties) && provider.specialties.length) {
    return provider.specialties.slice(0, 6).join(", ");
  }

  const fit = provider.fit || "";
  const match = fit.match(/(?:specialt(?:y|ies)|special interests?) (?:including|include)\s+(.+?)(?:\.|$)/i);
  if (match) return match[1];

  if (provider.type === "psychiatrist") return "";

  const specialtyTags = (provider.tags || [])
    .filter((tag) => ![
      provider.type,
      "fit",
      "clinical-psychologist",
      "primary-care",
      "telehealth",
      "directory",
      "cost"
    ].includes(tag))
    .map((tag) => tag.replace(/-/g, " "));

  return specialtyTags.slice(0, 6).join(", ");
}

function providerSpecialtyLabel(provider) {
  return provider.type === "psychiatrist" ? "Listed interests" : "Specialties";
}

function psychiatristBaselineNote(provider) {
  if (provider.type !== "psychiatrist") return "";
  if (!Array.isArray(provider.baselineScope) || !provider.baselineScope.length) return "";
  return "As a psychiatrist, they may be able to assess and treat a broad range of mental health conditions. Listed interests are separate from this baseline medical-specialist scope.";
}

function providerPatientGroups(provider) {
  if (Array.isArray(provider.patientGroups) && provider.patientGroups.length) {
    return provider.patientGroups.slice(0, 6).join(", ");
  }

  const match = (provider.fit || "").match(/Patient groups listed include\s+(.+?)(?:\.|$)/i);
  return match ? match[1] : "";
}

function isDirectoryLike(provider) {
  return provider.type === "directory" || provider.tags?.includes("directory");
}

function isDirectContact(provider) {
  return !isDirectoryLike(provider) && Boolean(provider.phone || provider.text || provider.email || provider.website);
}

function providerMatchesSelectedType(provider, type, directoryFallback = false) {
  const directory = isDirectoryLike(provider);
  const tags = provider.tags || [];

  if (type === "all") return true;
  if (type === "directory") return directory;

  if (directory) {
    if (!directoryFallback) return false;
    return tags.includes(type) || (type === "counsellor" && tags.includes("therapy"));
  }

  return provider.type === type
    || (type === "counsellor" && provider.type === "mens-centre")
    || (type === "psychiatrist" && tags.includes("psychiatry-service"))
    || (type === "addiction" && tags.includes("addiction"));
}

function selectedContactType() {
  const preference = contactPreference.value;
  if (preference === "therapist") return "counsellor";
  if (preference === "unsure") return "all";
  return preference;
}

function providerMatchesAge(provider) {
  const age = Number(document.querySelector("#age").value || 0);
  if (!age || !Array.isArray(provider.ageGroups) || !provider.ageGroups.length) return true;

  const text = [...provider.ageGroups, ...(provider.patientGroups || [])].join(" ").toLowerCase();
  const allowsChild = /child|children|tamariki|under\s*13|0\s*-\s*12|5\s*years/i.test(text);
  const allowsAdolescent = /adolescent|teen|rangatahi|youth|young adult|13|17|18/i.test(text);
  const allowsAdult = /adult|pakeke|18|25|60/i.test(text);
  const allowsOlder = /older|kaumatua|kaumātua|senior|65|60\+/i.test(text);
  const hasSpecificAge = allowsChild || allowsAdolescent || allowsAdult || allowsOlder;

  if (!hasSpecificAge) return true;
  if (age < 13) return allowsChild;
  if (age < 18) return allowsAdolescent || allowsChild;
  if (age < 25) return allowsAdult || allowsAdolescent;
  if (age < 65) return allowsAdult;
  return allowsOlder || allowsAdult;
}

function providerMatchesProfile(provider) {
  const location = matchedRegion || "";
  const identity = document.querySelector("#identity").value;
  const needs = checkedValues("need");
  const barriers = checkedValues("barrier");
  const preferences = checkedValues("preference");
  const tags = provider.tags || [];
  const distance = distanceToProvider(provider);
  const telehealth = isTelehealthProvider(provider);
  const wantsTelehealth = preferences.includes("telehealth");
  const needScopedMatch = providerMatchesSelectedNeeds(provider, needs);

  let score = providerAvailabilityScore(provider) + providerReferralScore(provider);
  if (!needScopedMatch) score -= 80;
  const preferenceType = selectedContactType();
  if (hasNationalServiceReach(provider)) score += wantsTelehealth ? 4 : (barriers.includes("transport") ? 2 : 0);
  if (!wantsTelehealth && provider.region === location) score += 5;
  if (!wantsTelehealth && distance !== null) {
    if (distance <= 5) score += telehealth ? 2 : 8;
    else if (distance <= 15) score += telehealth ? 1 : 6;
    else if (distance <= 40) score += telehealth ? 0 : 4;
    else if (distance <= 100) score += telehealth ? -1 : 1;
    else if (!telehealth) score -= 4;
  }
  if (preferenceType !== "all" && provider.type === preferenceType) score += 6;
  if (identity === "male" && tags.includes("male")) score += 2;
  if (identity === "female" && tags.includes("female")) score += 2;
  needs.forEach((need) => {
    if (tags.includes(need)) score += provider.type === "psychiatrist" ? 2 : 4;
    if (hasAdvertisedSpecialtyMatch(provider, need)) {
      score += provider.type === "psychiatrist" ? 8 : provider.type === "psychologist" ? 6 : 3;
    } else if (hasPsychiatristBaselineMatch(provider, need)) {
      score += 1;
    }
  });
  if (provider.type === "helpline" && tags.includes("addiction")) {
    if (tags.includes("alcohol") && tags.includes("drug")) score += 3;
    if (tags.includes("meth")) score -= 2;
  }
  barriers.forEach((barrier) => {
    if (tags.includes(barrier)) score += 1;
  });
  if (telehealth) {
    if (wantsTelehealth) score += 30;
    else score += barriers.includes("transport") ? -2 : -14;
  } else if (wantsTelehealth) {
    score -= 18;
  }
  const matchedSupportPreferences = supportPreferenceMatches(provider, preferences);
  if (selectedSupportPreferences(preferences).length) {
    score += matchedSupportPreferences.length * 12;
    if (!matchedSupportPreferences.length) score -= 4;
  }
  if (hasProviderGenderConflict(provider, preferences)) score -= 30;
  preferences.forEach((preference) => {
    const preferenceTag = preferenceTagFor(preference);
    if (!matchablePreferenceTags.includes(preferenceTag) && tags.includes(preferenceTag)) score += 2;
  });
  if (provider.email) score += 2;
  if (provider.phone || provider.text) score += 2;
  if (provider.website) score += 1;
  return score;
}

function providerSortValue(provider) {
  const needs = checkedValues("need");
  const advertisedMatches = needs.filter((need) => hasAdvertisedSpecialtyMatch(provider, need)).length;
  const baselineMatches = needs.filter((need) => !hasAdvertisedSpecialtyMatch(provider, need) && hasPsychiatristBaselineMatch(provider, need)).length;
  const directContacts = [provider.email, provider.phone, provider.text].filter(Boolean).length;
  const distance = distanceToProvider(provider);
  const tags = provider.tags || [];
  const wantsTelehealth = checkedValues("preference").includes("telehealth");
  const telehealth = isTelehealthProvider(provider);
  return {
    preferenceMatches: supportPreferenceMatches(provider).length,
    availabilityTier: providerAvailabilitySortTier(provider),
    referralTier: providerReferralSortTier(provider),
    telehealthMatch: wantsTelehealth && telehealth ? 1 : 0,
    specialtyMatches: advertisedMatches * 3 + baselineMatches,
    directContacts,
    isLocal: !wantsTelehealth && provider.region === (matchedRegion || "") ? 1 : 0,
    isTelehealth: telehealth ? 1 : 0,
    distance: wantsTelehealth ? Infinity : (distance === null ? Infinity : distance)
  };
}

function compareProviders(a, b) {
  const aSort = providerSortValue(a);
  const bSort = providerSortValue(b);
  return b.score - a.score
    || bSort.preferenceMatches - aSort.preferenceMatches
    || bSort.availabilityTier - aSort.availabilityTier
    || bSort.referralTier - aSort.referralTier
    || bSort.telehealthMatch - aSort.telehealthMatch
    || bSort.specialtyMatches - aSort.specialtyMatches
    || bSort.isLocal - aSort.isLocal
    || aSort.isTelehealth - bSort.isTelehealth
    || aSort.distance - bSort.distance
    || bSort.directContacts - aSort.directContacts
    || a.name.localeCompare(b.name);
}

function filteredProviders() {
  const query = providerSearch.value.trim().toLowerCase();
  const type = providerType.value;
  const cost = providerCost.value;
  const location = matchedRegion || "";
  const needs = checkedValues("need");
  const preferences = checkedValues("preference");

  const matchesFor = ({ directoriesOnly = false, directoryFallback = false } = {}) => providers
    .map((provider) => ({ ...provider, score: providerMatchesProfile(provider) }))
    .filter((provider) => {
      const directory = isDirectoryLike(provider);
      const haystack = [
        provider.name,
        provider.type,
        provider.region,
        provider.city,
        provider.address,
        provider.cost,
        provider.fit,
        provider.firstStep,
        provider.clinicianName,
        provider.practiceName,
        ...(provider.tags || [])
      ].join(" ").toLowerCase();

      const typeOk = providerMatchesSelectedType(provider, type, directoryFallback);
      const queryOk = !query || haystack.includes(query);
      const regionOk = providerMatchesSelectedRegion(provider, location, preferences, query);
      const optInTags = (provider.tags || []).filter((tag) => optInPreferenceTags.includes(tag));
      const preferenceOk = optInTags.length === 0 || optInTags.some((tag) => preferences.includes(tag));
      const genderOk = !hasProviderGenderConflict(provider, preferences);
      const ageOk = providerMatchesAge(provider);
      const needOk = Boolean(query) || providerMatchesSelectedNeeds(provider, needs);
      const crisisOk = !provider.tags?.includes("crisis");
      const contactOk = directoriesOnly
        ? directory && Boolean(provider.website)
        : !directory && isDirectContact(provider);
      const costText = `${provider.cost} ${(provider.tags || []).join(" ")}`.toLowerCase();
      const costOk = cost === "any"
        || (cost === "free" && /free|public|funded/.test(costText))
        || (cost === "winz" && /winz|cost|funded|directory/.test(costText));

      return typeOk && queryOk && regionOk && preferenceOk && genderOk && ageOk && needOk && crisisOk && contactOk && costOk;
    })
    .sort(compareProviders);

  providerDirectoryFallbackActive = false;

  if (type === "directory") return matchesFor({ directoriesOnly: true, directoryFallback: true });

  const directMatches = matchesFor();
  if (directMatches.length) return directMatches;

  const directoryMatches = matchesFor({ directoriesOnly: true, directoryFallback: true });
  providerDirectoryFallbackActive = directoryMatches.length > 0;
  return directoryMatches;
}

function recommendationCandidates(type = "all", options = {}) {
  const location = matchedRegion || "";
  const needs = checkedValues("need");
  const preferences = checkedValues("preference");
  const includeUnavailable = Boolean(options.includeUnavailable);

  return providers
    .map((provider) => ({ ...provider, score: providerMatchesProfile(provider) }))
    .filter((provider) => {
      const typeOk = type === "all"
        || provider.type === type
        || (type === "counsellor" && provider.type === "mens-centre")
        || (type === "psychiatrist" && provider.tags?.includes("psychiatry-service"))
        || (type === "addiction" && provider.tags?.includes("addiction"));
      const regionOk = providerMatchesSelectedRegion(provider, location, preferences);
      const optInTags = (provider.tags || []).filter((tag) => optInPreferenceTags.includes(tag));
      const preferenceOk = optInTags.length === 0 || optInTags.some((tag) => preferences.includes(tag));
      const genderOk = !hasProviderGenderConflict(provider, preferences);
      const ageOk = providerMatchesAge(provider);
      const needOk = providerMatchesSelectedNeeds(provider, needs);
      const crisisOk = !provider.tags?.includes("crisis");
      const directOk = isDirectContact(provider);
      const availabilityOk = includeUnavailable || !isUnavailableForFirstRecommendations(provider);
      return typeOk && regionOk && preferenceOk && genderOk && ageOk && needOk && crisisOk && directOk && availabilityOk;
    })
    .sort(compareProviders);
}

function providerTypeLabel(type) {
  return {
    gp: "GP / medical practice",
    counsellor: "Counsellor",
    psychologist: "Psychologist",
    psychiatrist: "Psychiatrist",
    helpline: "Helpline",
    "mens-centre": "Men's centre",
    youth: "Youth",
    addiction: "Addiction",
    directory: "Navigator",
    "public-service": "Public service"
  }[type] || type;
}

function providerTypeClass(type) {
  return String(type || "provider").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

function providerTypeIconAsset(type) {
  const icons = {
    gp: "assets/provider-icons/doctor.png",
    counsellor: "assets/provider-icons/counsellor-therapist.png",
    psychologist: "assets/provider-icons/psychologist.png",
    psychiatrist: "assets/provider-icons/psychiatrist.png",
    helpline: "assets/provider-icons/helpline.svg",
    "mens-centre": "assets/provider-icons/mens-centre.svg",
    youth: "assets/provider-icons/youth.svg",
    addiction: "assets/provider-icons/addiction.svg",
    directory: "assets/provider-icons/directory.svg",
    "public-service": "assets/provider-icons/public-mental-health.svg"
  };
  return icons[type] || "assets/provider-icons/counsellor-therapist.png";
}

function providerTypeBadge(provider) {
  const label = escapeHtml(providerTypeLabel(provider.type));
  const typeClass = safeClassToken(providerTypeClass(provider.type));
  const iconPath = escapeHtml(providerTypeIconAsset(provider.type));
  return `
    <span class="provider-type-badge provider-type-badge--${typeClass}" aria-label="${label}" title="${label}">
      <img src="${iconPath}" alt="" aria-hidden="true" loading="lazy" decoding="async" width="32" height="32">
      <span>${label}</span>
    </span>
  `;
}

function providerPrimaryName(provider) {
  return provider.clinicianName || provider.name;
}

function providerPracticeName(provider) {
  if (!provider.clinicianName) return "";
  const practice = provider.practiceName || provider.name;
  return practice && practice !== provider.clinicianName ? practice : "";
}

function providerDisplayLabel(provider) {
  const practice = providerPracticeName(provider);
  return practice ? `${providerPrimaryName(provider)} at ${practice}` : providerPrimaryName(provider);
}

function providerNameMarkup(provider) {
  const practice = providerPracticeName(provider);
  return `
    <h3>${escapeHtml(providerPrimaryName(provider))}</h3>
    ${practice ? `<p class="provider-practice">${escapeHtml(practice)}</p>` : ""}
  `;
}

function renderProviders() {
  if (!providers.length) {
    providerCount.textContent = providerLoadError || "Loading local provider database...";
    providerList.innerHTML = providerLoadError
      ? `
        <article class="provider-card provider-card--empty">
          <div>
            <h3>Provider database unavailable</h3>
            <p>The local provider list could not be loaded. Refresh the page, or use 1737 if you need to talk with someone now.</p>
            <p class="provider-detail"><strong>Immediate safety:</strong> call 111 if someone may be unsafe right now.</p>
          </div>
        </article>
      `
      : "";
    showMoreProviders.hidden = true;
    return;
  }

  const matches = filteredProviders();
  if (!matches.some((provider) => provider.id === selectedProviderId)) {
    selectedProviderId = matches[0]?.id || "";
  }
  if (contactProviderId && !matches.some((provider) => provider.id === contactProviderId)) {
    contactProviderId = "";
  }
  const visibleMatches = matches.slice(0, providerVisibleCount);
  providerCount.textContent = providerDirectoryFallbackActive
    ? `No direct contact options match these filters, so showing ${visibleMatches.length} of ${matches.length} directory options with websites.`
    : `Showing ${visibleMatches.length} of ${matches.length} contact options from the local database. Best matches are shown first.`;
  providerList.innerHTML = visibleMatches
    .map((provider) => {
      const isSelected = provider.id === selectedProviderId;
      const directory = isDirectoryLike(provider);
      const helpline = provider.type === "helpline";
      const specialty = providerSpecialties(provider);
      const specialtyLabel = providerSpecialtyLabel(provider);
      const baselineNote = psychiatristBaselineNote(provider);
      const patientGroups = providerPatientGroups(provider);
      const distance = distanceToProvider(provider);
      const distanceLabel = providerDistanceLabel(provider, distance);
      const website = safeHref(provider.website);
      const booking = safeHref(provider.bookingUrl);
      const providerId = escapeHtml(provider.id);
      const providerRegion = escapeHtml(provider.region);
      const providerCity = escapeHtml(provider.city);
      const providerFit = escapeHtml(provider.fit);
      const providerFirstStep = escapeHtml(provider.firstStep);
      const providerCost = escapeHtml(provider.cost);
      const providerSpecialty = escapeHtml(specialty);
      const escapedSpecialtyLabel = escapeHtml(specialtyLabel);
      const providerBaselineNote = escapeHtml(baselineNote);
      const providerPatientGroup = escapeHtml(patientGroups);
      const providerDistance = escapeHtml(distanceLabel);
      const availabilityStatus = providerAvailabilityStatus(provider);
      const unavailable = isUnavailableForFirstRecommendations(provider);
      const availabilityNote = providerAvailabilityNote(provider, { compact: true });
      const referralNote = providerReferralNote(provider);
      const gpReferral = providerRequiresGpReferral(provider);
      const contact = [
        !directory && provider.phone ? `Phone ${escapeHtml(provider.phone)}` : "",
        !directory && provider.text ? `Text ${escapeHtml(provider.text)}` : "",
        !directory && provider.email ? escapeHtml(provider.email) : "",
        directory && website ? "Website directory" : ""
      ].filter(Boolean).join(" | ");
      const primaryAction = directory
        ? website
          ? `<a class="button button--primary" href="${escapeHtml(website)}"${externalLinkAttrs(website)}>Open directory</a>`
          : ""
        : helpline
          ? provider.phone
            ? `<a class="button button--primary" href="tel:${normalisePhone(provider.phone)}">Call</a>`
            : provider.text
              ? `<a class="button button--primary" href="sms:${normalisePhone(provider.text)}">Text</a>`
              : website
                ? `<a class="button button--primary" href="${escapeHtml(website)}"${externalLinkAttrs(website)}>Website</a>`
                : ""
        : unavailable
          ? provider.email
            ? `<button class="button button--primary select-provider" type="button" data-provider-id="${providerId}">
                Check availability first
              </button>`
            : provider.phone
              ? `<a class="button button--primary" href="tel:${normalisePhone(provider.phone)}">Call to check availability</a>`
              : website
                ? `<a class="button button--primary" href="${escapeHtml(website)}"${externalLinkAttrs(website)}>Check availability</a>`
                : ""
        : `<button class="button button--primary select-provider" type="button" data-provider-id="${providerId}">
              ${gpReferral ? "Plan GP referral" : "Use this contact"}
            </button>`;
      const secondaryActions = directory
        ? ""
        : helpline
          ? `
            ${provider.phone && provider.text ? `<a class="button button--quiet" href="sms:${normalisePhone(provider.text)}">Text</a>` : ""}
            ${website ? `<a class="button button--quiet" href="${escapeHtml(website)}"${externalLinkAttrs(website)}>Website</a>` : ""}
          `
          : `
            ${provider.phone ? `<a class="button button--quiet" href="tel:${normalisePhone(provider.phone)}">Call</a>` : ""}
            ${provider.text ? `<a class="button button--quiet" href="sms:${normalisePhone(provider.text)}">Text</a>` : ""}
            ${booking ? `<a class="button button--quiet" href="${escapeHtml(booking)}"${externalLinkAttrs(booking)}>Book online</a>` : ""}
            ${website ? `<a class="button button--quiet" href="${escapeHtml(website)}"${externalLinkAttrs(website)}>${booking ? "Profile" : "Website"}</a>` : ""}
          `;

      return `
        <article class="provider-card provider-card--availability-${safeClassToken(availabilityStatus)} ${isSelected ? "selected" : ""}">
          <div class="provider-card__header">
            <div>
              ${providerNameMarkup(provider)}
              <p class="provider-meta">${providerRegion}${provider.city ? ` | ${providerCity}` : ""}${distanceLabel ? ` | ${providerDistance}` : ""}</p>
            </div>
            ${providerTypeBadge(provider)}
          </div>
          <div class="provider-card__body">
            <p>${providerFit}</p>
            ${specialty ? `<p class="provider-detail"><strong>${escapedSpecialtyLabel}:</strong> ${providerSpecialty}</p>` : ""}
            ${providerBaselineNote ? `<p class="provider-detail"><strong>Psychiatrist scope:</strong> ${providerBaselineNote}</p>` : ""}
            ${patientGroups ? `<p class="provider-detail"><strong>Patient groups:</strong> ${providerPatientGroup}</p>` : ""}
            <p class="provider-detail"><strong>First step:</strong> ${providerFirstStep}</p>
            ${referralNote ? `<p class="provider-detail referral-note"><strong>Referral:</strong> ${escapeHtml(referralNote)}</p>` : ""}
            <p class="provider-detail"><strong>Cost:</strong> ${providerCost}</p>
            <p class="provider-detail availability-note availability-note--${safeClassToken(availabilityStatus)}"><strong>Availability:</strong> ${escapeHtml(availabilityNote)}</p>
            ${contact ? `<p class="provider-detail"><strong>Contact:</strong> ${contact}</p>` : ""}
          </div>
          <div class="provider-actions">
            ${primaryAction}
            ${secondaryActions}
          </div>
        </article>
      `;
    })
    .join("");

  if (!visibleMatches.length) {
    const typeLabel = providerType.options[providerType.selectedIndex]?.textContent?.toLowerCase() || "contacts";
    providerList.innerHTML = `
      <article class="provider-card provider-card--empty">
        <div>
          <h3>No direct ${typeLabel} loaded for this area yet</h3>
          <p>We do not have a direct contact that matches these filters yet. Try another contact type, a nearby suburb, or remove the search text.</p>
          <p class="provider-detail"><strong>Still useful:</strong> choose one of the suggested first steps above, or use 1737 if you need to talk to someone now.</p>
        </div>
      </article>
    `;
  }

  showMoreProviders.hidden = providerVisibleCount >= matches.length;
}

async function loadProviders() {
  try {
    providerLoadError = "";
    const response = await fetch("providers.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Provider database failed to load");
    providers = await response.json();
    renderProviderUpdatedDate();
    const firstMatch = filteredProviders()[0];
    if (firstMatch) selectedProviderId = firstMatch.id;
    contactProviderId = "";
    render();
  } catch {
    providerLoadError = "Could not load the local provider database.";
    renderProviderUpdatedDate();
    renderProviders();
    renderContact();
  }
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

function providerCoords(provider) {
  const lat = Number(provider.lat ?? provider.latitude);
  const lon = Number(provider.lon ?? provider.lng ?? provider.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function distanceToProvider(provider) {
  const coords = providerCoords(provider);
  return userCoords && coords ? distanceKm(userCoords, coords) : null;
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

function providerMatchesSelectedRegion(provider, location, preferences = [], query = "") {
  if (query) return true;
  if (hasNationalServiceReach(provider)) return true;
  if (preferences.includes("telehealth") && isTelehealthProvider(provider)) return true;
  if (provider.region !== location) return false;
  if (!userCoords || !distanceCappedLocalTypes.has(provider.type)) return true;
  const distance = distanceToProvider(provider);
  if (distance === null) return false;
  return distance <= localInPersonDistanceCapKm;
}

function providerDistanceLabel(provider, distance = distanceToProvider(provider)) {
  if (isTelehealthProvider(provider) && (checkedValues("preference").includes("telehealth") || distance === null || distance > telehealthDistanceThresholdKm)) return "Telehealth provider";
  if (distance === null) return "";
  return `${distance.toFixed(1)} km away`;
}

function nearestRegionFromCoords(lat, lon) {
  return regionCentres
    .map((centre) => ({ ...centre, distance: distanceKm({ lat, lon }, centre) }))
    .sort((a, b) => a.distance - b.distance)[0]?.region || "";
}

async function reverseGeocodeRegion(lat, lon) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "10");
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) return "";
    const data = await response.json();
    const address = data.address || {};
    return [
      address.state,
      address.region,
      address.city,
      address.town,
      address.suburb
    ].filter(Boolean).map((value) => regionAliases[String(value).toLowerCase()] || value)[0] || "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function inferRegionFromText(value) {
  const text = String(value || "").toLowerCase();
  const match = Object.entries(regionAliases)
    .find(([alias]) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  return match?.[1] || "";
}

function regionFromAddressMatch(match) {
  const address = match?.address || {};
  const values = [
    address.state,
    address.region,
    address.county,
    address.city,
    address.town,
    address.village,
    address.suburb,
    match?.display_name
  ].filter(Boolean);

  for (const value of values) {
    const direct = regionAliases[String(value).toLowerCase()];
    if (direct) return direct;
    const inferred = inferRegionFromText(value);
    if (inferred) return inferred;
  }

  return "";
}

function addressSummary(match) {
  return String(match?.display_name || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

function isNzAddressMatch(match) {
  const address = match?.address || {};
  return address.country_code === "nz" || /\bnew zealand\b/i.test(match?.display_name || "");
}

function addressSuggestionDetail(match) {
  const address = match?.address || {};
  return [
    address.suburb,
    address.city || address.town || address.village,
    address.state || address.region,
    "New Zealand"
  ].filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(", ");
}

function fallbackMatchFromPlace(place) {
  return {
    display_name: `${place.name}, ${place.city}, ${place.region}, New Zealand`,
    lat: place.lat,
    lon: place.lon,
    address: {
      country_code: "nz",
      suburb: place.name === place.city ? "" : place.name,
      city: place.city,
      state: place.region,
      country: "New Zealand"
    }
  };
}

function localAddressMatches(query, limit = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const regionMatches = regionCentres.map((centre) => fallbackMatchFromPlace({
    name: centre.region,
    city: centre.region,
    region: centre.region,
    lat: centre.lat,
    lon: centre.lon
  }));
  const placeMatches = fallbackAddressPlaces.map(fallbackMatchFromPlace);

  return [...placeMatches, ...regionMatches]
    .filter((match) => {
      const text = `${match.display_name} ${Object.values(match.address || {}).join(" ")}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .slice(0, limit);
}

async function fetchAddressMatches(query, limit = 5) {
  if (addressLookupController) addressLookupController.abort();
  const controller = new AbortController();
  addressLookupController = controller;
  let timedOut = false;
  let timeout;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "nz");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", query);

  try {
    const lookup = fetch(url.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    const timeoutError = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const error = new Error("Address lookup timed out");
        error.addressLookupTimedOut = true;
        reject(error);
      }, 1200);
    });
    lookup.catch(() => {});
    const response = await Promise.race([lookup, timeoutError]);
    if (!response.ok) throw new Error("Address lookup failed");
    const matches = await response.json();
    return matches.filter(isNzAddressMatch);
  } catch (error) {
    if (timedOut) error.addressLookupTimedOut = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function renderAddressSuggestions(matches) {
  activeAddressSuggestionIndex = -1;
  addressInput.setAttribute("aria-expanded", matches.length ? "true" : "false");
  addressInput.removeAttribute("aria-activedescendant");
  addressSuggestions.hidden = !matches.length;
  addressSuggestions.innerHTML = matches
    .map((match, index) => {
      const summary = addressSummary(match);
      const detail = addressSuggestionDetail(match);
      const showDetail = detail && detail.toLowerCase() !== summary.toLowerCase();
      return `
        <button
          class="address-suggestion"
          id="address-suggestion-${index}"
          type="button"
          role="option"
          aria-selected="false"
          data-address-index="${index}"
        >
          <span class="address-suggestion__title">${escapeHtml(summary)}</span>
          ${showDetail ? `<span class="address-suggestion__meta">${escapeHtml(detail)}</span>` : ""}
        </button>
      `;
    })
    .join("");
}

function setActiveAddressSuggestion(index) {
  if (!addressSuggestionMatches.length) return;
  activeAddressSuggestionIndex = (index + addressSuggestionMatches.length) % addressSuggestionMatches.length;
  addressInput.setAttribute("aria-activedescendant", `address-suggestion-${activeAddressSuggestionIndex}`);

  [...addressSuggestions.querySelectorAll(".address-suggestion")].forEach((button, buttonIndex) => {
    button.setAttribute("aria-selected", buttonIndex === activeAddressSuggestionIndex ? "true" : "false");
    if (buttonIndex === activeAddressSuggestionIndex) button.scrollIntoView({ block: "nearest" });
  });
}

function hideAddressSuggestions() {
  activeAddressSuggestionIndex = -1;
  addressSuggestions.hidden = true;
  addressSuggestions.innerHTML = "";
  addressInput.setAttribute("aria-expanded", "false");
  addressInput.removeAttribute("aria-activedescendant");
}

async function updateAddressSuggestions(query, token) {
  if (query.length < 3) {
    addressSuggestionMatches = [];
    hideAddressSuggestions();
    return;
  }

  try {
    let usedFallback = false;
    let matches = await fetchAddressMatches(query, 5);
    if (!matches.length) {
      matches = localAddressMatches(query, 5);
      usedFallback = matches.length > 0;
    }
    if (token !== addressLookupToken || addressInput.value.trim() !== query) return;
    addressSuggestionMatches = matches;
    renderAddressSuggestions(matches);
    if (matches.length) {
      addressStatus.textContent = usedFallback
        ? "Showing New Zealand place matches. Choose one to use it."
        : "New Zealand matches found. Choose one to use it.";
    } else {
      addressStatus.textContent = "No New Zealand matches yet. Try a suburb, town, or fuller address.";
    }
  } catch (error) {
    if (error.name === "AbortError" && !error.addressLookupTimedOut) return;
    const matches = localAddressMatches(query, 5);
    if (token !== addressLookupToken || addressInput.value.trim() !== query) return;
    addressSuggestionMatches = matches;
    renderAddressSuggestions(matches);
    if (matches.length) {
      addressStatus.textContent = "Showing New Zealand place matches. Choose one to use it.";
    } else {
      addressStatus.textContent = "Address suggestions did not load. Keep typing a suburb, town, or city.";
    }
  }
}

async function applyAddressMatch(match, statusPrefix = "Using distance from") {
  const lat = Number(match.lat);
  const lon = Number(match.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Address match missing coordinates");

  userCoords = { lat, lon };
  const resolvedRegion = regionFromAddressMatch(match)
    || await reverseGeocodeRegion(lat, lon)
    || nearestRegionFromCoords(lat, lon);

  matchedRegion = resolvedRegion;
  addressInput.value = addressSummary(match);
  addressStatus.textContent = resolvedRegion
    ? `${statusPrefix} ${addressInput.value}.`
    : `Using distance from ${addressInput.value}.`;
  hideAddressSuggestions();
  render();
}

function buildPaths() {
  const age = Number(document.querySelector("#age").value || 0);
  const identity = document.querySelector("#identity").value;
  const needs = checkedValues("need");
  const barriers = checkedValues("barrier");
  const preferences = checkedValues("preference");
  const location = matchedRegion || "your area";
  const profileLocation = preferences.includes("telehealth") && !matchedRegion
    ? "looking for telehealth care"
    : `in ${location}`;
  const paths = [];

  const needText = needs.length ? labelledList(needs, needLabels) : "general wellbeing support";
  const barrierText = barriers.length ? `Main barriers: ${labelledList(barriers, barrierLabels)}.` : "No major barriers selected.";
  const preferenceText = preferences.length ? ` Preferences: ${labelledList(preferences, preferenceLabels)}.` : "";
  profileLine.textContent = `${age || "Adult"} ${profileLocation}: ${needText}. ${barrierText}${preferenceText}`;

  addPath(paths, {
    title: "Book a GP or nurse appointment",
    body: "Ask for a mental health plan, medication discussion if relevant, referral options, and whether the practice has free Access and Choice support such as a Health Improvement Practitioner, health coach, or community support worker.",
    action: "Read about Access and Choice",
    href: links.accessChoice
  });

  if (barriers.includes("cost")) {
    addPath(paths, {
      tone: "funding",
      title: "Ask about WINZ counselling funding",
      body: "If the condition is likely to last at least 6 months and counselling costs are ongoing, Work and Income may help through Disability Allowance. Ask whether the counsellor is a recognised provider and can complete the Disability Certificate - Counselling form.",
      action: "WINZ counselling help",
      href: links.winz
    });
  }

  if (needs.includes("trauma")) {
    addPath(paths, {
      tone: "funding",
      title: "Check ACC Sensitive Claims",
      body: "For distress connected to sexual abuse or assault, ACC Sensitive Claims can provide fully funded support, treatment, and assessment. A registered provider can help start the process.",
      action: "ACC Sensitive Claims",
      href: links.acc
    });
  }

  if (needs.includes("addiction")) {
    addPath(paths, {
      title: "Addiction and mental health support",
      body: "If alcohol, drugs, or gambling are part of the picture, start with a direct addiction service where one fits. If local options are thin, dedicated addiction helplines can talk now and help locate treatment.",
      action: "Show addiction contacts",
      href: "#providerList"
    });
  }

  const wantsFemaleProvider = preferences.includes("female-provider") && !preferences.includes("male-provider");
  if (identity === "male" && !wantsFemaleProvider && isChristchurchMensSupportRelevant(location)) {
    addPath(paths, {
      tone: "local",
      title: "Try Canterbury Men's Centre",
      body: "For men in Christchurch or Canterbury, this can be a lower-pressure front door for a free first assessment, counselling pathways, peer support, and practical navigation.",
      action: "Canterbury Men's Centre",
      href: links.canMen
    });
  } else if (identity === "male" && !wantsFemaleProvider) {
    addPath(paths, {
      tone: "local",
      title: "Look for a male-friendly first contact",
      body: "If talking to someone feels hard, choose a GP, 1737, a local counselling service, or a men's support option in your region. Ask directly whether they work often with men and whether the first contact can be low pressure.",
      action: "Search local services",
      href: links.healthpoint
    });
  }

  if (barriers.includes("wait")) {
    addPath(paths, {
      title: "Use bridge support while waiting",
      body: "Ask services about cancellation lists and short appointments. Use 1737 between appointments, and ask your GP for brief intervention or same-day wellbeing support.",
      action: "Health NZ help options",
      href: links.healthNz
    });
  }

  if (barriers.includes("transport")) {
    addPath(paths, {
      tone: "funding",
      title: "Reduce transport barriers",
      body: "Ask whether phone or video appointments are possible. If eligible, WINZ Disability Allowance can include transport costs for counselling.",
      action: "WINZ counselling help",
      href: links.winz
    });
  }

  if (barriers.includes("culture") || preferences.some((item) => ["maori", "pasifika", "asian", "rainbow", "trauma-informed"].includes(item))) {
    addPath(paths, {
      title: "Ask for a culturally safe fit",
      body: "You can ask for Maori, Pasifika, Asian, Rainbow, youth-friendly, trauma-informed, male, or female support. Fit matters, and changing provider is allowed.",
      action: "Find local services",
      href: links.healthpoint
    });
  }

  if (age > 0 && age < 25) {
    addPath(paths, {
      title: "Youth-friendly support may fit better",
      body: "For rangatahi and young adults, ask about Youthline, school or tertiary counselling, youth one-stop shops, and free digital tools such as Headstrong.",
      action: "Health NZ helplines",
      href: links.healthNz
    });
  }

  addPath(paths, {
    title: "Therapist, psychologist, or psychiatrist",
    body: "Counsellors and therapists are often the easiest talking-therapy route. Psychologists add specialist assessment and therapy. Psychiatrists are medical specialists for complex diagnosis, medication, high risk, or care that is not improving.",
    action: "Search Healthpoint",
    href: links.healthpoint
  });

  return paths;
}

function pathFilterOptions(paths) {
  const options = [
    { label: "All matches", type: "all" },
    { label: "GP or nurse", type: "gp" },
    { label: "Helpline now", type: "helpline" },
    { label: "Counsellor / therapist", type: "counsellor" },
    { label: "Psychologist", type: "psychologist" },
    { label: "Psychiatrist", type: "psychiatrist" },
    { label: "Public mental health", type: "public-service" }
  ];

  if (paths.some((path) => path.title.includes("ACC") || path.title.includes("trauma"))) {
    options.push({ label: "Trauma support", search: "trauma" });
  }

  if (paths.some((path) => path.title.includes("Addiction"))) {
    options.push({ label: "Addiction support", type: "addiction" });
  }

  if (paths.some((path) => path.title.includes("Youth"))) {
    options.push({ label: "Youth support", type: "youth" });
  }

  return options;
}

function providerHeading(provider) {
  if (provider.type === "gp") return "Start with a GP or nurse";
  if (provider.type === "helpline" && provider.tags?.includes("addiction")) return "Use an addiction helpline";
  if (provider.type === "helpline") return "Talk to someone now";
  if (provider.type === "counsellor") return "Ask a counsellor or therapist";
  if (provider.type === "psychologist") return "Look for a psychologist";
  if (provider.type === "mens-centre") return "Use lower-pressure counselling support";
  if (provider.type === "public-service") return "Ask a funded public service";
  if (provider.type === "addiction") return "Use addiction and mental health support";
  if (provider.type === "youth") return "Use youth-friendly support";
  return "Use a service navigator";
}

function reasonForProvider(provider) {
  const age = Number(document.querySelector("#age").value || 0);
  const needs = checkedValues("need");
  const barriers = checkedValues("barrier");
  const preferences = checkedValues("preference");
  const reasons = [];
  const tags = provider.tags || [];
  const specialty = providerSpecialties(provider);
  const advertisedMatchedNeeds = needs.filter((need) => hasAdvertisedSpecialtyMatch(provider, need));
  const baselineMatchedNeeds = needs.filter((need) =>
    !hasAdvertisedSpecialtyMatch(provider, need) && hasPsychiatristBaselineMatch(provider, need)
  );
  const distance = distanceToProvider(provider);
  const distanceLabel = providerDistanceLabel(provider, distance);
  const needScopeLabel = providerNeedScopeLabel(provider);

  if (needScopeLabel) {
    reasons.push(`This service is specifically for ${needScopeLabel}, which matches what you selected.`);
  }

  if (providerExplicitlyAccepting(provider)) {
    reasons.push("Their public information says they are accepting new clients, but it is still worth confirming.");
  } else if (providerAvailabilityStatus(provider) === "waitlist") {
    reasons.push("They may have a waitlist, so ask about timing before putting energy into this option.");
  } else if (isUnavailableForFirstRecommendations(provider)) {
    reasons.push(providerAvailabilityNote(provider, { compact: true }));
  }

  if (distanceLabel === "Telehealth provider") {
    reasons.push(preferences.includes("telehealth")
      ? "This matches your preference for phone or video appointments."
      : "Telehealth provider.");
  } else if (distanceLabel) {
    reasons.push(`This option is about ${distanceLabel.replace(" away", "")} from the address or suburb you entered.`);
  }

  if (provider.type === "gp") {
    reasons.push("A GP or nurse can turn this into a medical plan, referrals, medication options if wanted, and funded primary mental health support.");
    if (barriers.includes("cost")) reasons.push("Because cost is a barrier, ask about free Access and Choice support, Community Services Card fees, and WINZ paperwork.");
    if (barriers.includes("wait")) reasons.push("GP teams can sometimes offer brief same-week support while you wait for counselling.");
  }

  if (provider.type === "helpline") {
    reasons.push("This is useful when booking feels like too much: no enrolment, no diagnosis, and you can call or text first.");
    if (needs.includes("addiction") && tags.includes("addiction")) reasons.push("This is addiction-specific, so you do not have to frame alcohol, drug, or gambling harm as a general mental health issue.");
    if (needs.includes("anxiety")) reasons.push("For anxiety or overwhelm, a helpline can help you slow the next step down into one manageable action.");
    if (barriers.includes("privacy")) reasons.push("Text or phone support can feel more private than walking into a clinic.");
  }

  if (provider.type === "counsellor" || provider.type === "psychologist") {
    reasons.push("Talking therapy is a direct fit for depression, anxiety, trauma, stress, and patterns that are hard to shift alone.");
    if (specialty) reasons.push(`Their listed focus includes ${specialty}.`);
    if (advertisedMatchedNeeds.length) reasons.push(`That directly matches ${labelledList(advertisedMatchedNeeds, needLabels)} from your answers.`);
    if (barriers.includes("cost")) reasons.push("Ask before booking about WINZ Disability Allowance, ACC, EAP, funded places, or reduced-fee sessions.");
    if (preferences.length) reasons.push("Your preferences can be named in the first message so you do not have to explain them on the spot.");
  }

  if (provider.type === "psychiatrist" || tags.includes("psychiatry-service")) {
    reasons.push(tags.includes("psychiatry-service") && provider.type !== "psychiatrist"
      ? "This is a specialist mental-health service that can assess whether psychiatry or medication support is needed."
      : "A psychiatrist is a medical specialist, which can fit medication complexity, diagnosis questions, high risk, or care that has not improved.");
    if (providerRequiresGpReferral(provider)) {
      reasons.push("Their public information indicates a GP referral is needed, so the next practical step is booking with a GP.");
    } else if (providerReferralType(provider) === "self") {
      reasons.push("Their public information suggests self-referral or direct booking may be available.");
    } else {
      reasons.push("Referral requirements are not clear, so check before putting energy into a direct enquiry.");
    }
    if (provider.type === "psychiatrist") {
      reasons.push("As a psychiatrist, they may be able to assess and treat a broad range of mental health conditions; listed interests are separate from that baseline medical-specialist scope.");
    }
    if (specialty) reasons.push(`Their listed interests include ${specialty}.`);
    if (advertisedMatchedNeeds.length) reasons.push(`Those listed interests directly match ${labelledList(advertisedMatchedNeeds, needLabels)} from your answers.`);
    if (!advertisedMatchedNeeds.length && baselineMatchedNeeds.length) {
      reasons.push(`Your selected concern fits common psychiatric assessment or medication scope, but it is not listed as a special interest in this profile.`);
    }
  }

  if (provider.type === "mens-centre" || provider.type === "helpline" || barriers.includes("privacy")) {
    reasons.push("This may feel less exposing if talking about mental health directly is hard, and it can still connect you into proper care.");
  }

  if (provider.type === "public-service") {
    reasons.push("Public services can be a better fit when you need funded support, navigation, or help coordinating several problems at once.");
  }

  if (provider.type === "addiction") {
    reasons.push("Addiction services are built for alcohol, drug, gambling, and mental health overlap, so you do not need to separate the issues first.");
  }

  if (provider.type === "youth" || (age > 0 && age < 25)) {
    reasons.push("Youth-friendly services can be easier to approach and are used to helping young adults start care.");
  }

  if (preferences.includes("maori") && tags.includes("maori")) reasons.push("This matches your preference for Maori or kaupapa Maori support.");
  if (preferences.includes("pasifika") && tags.includes("pasifika")) reasons.push("This matches your preference for Pasifika support.");
  if (preferences.includes("asian") && tags.includes("asian")) reasons.push("This matches your preference for Asian support.");
  if (preferences.includes("rainbow") && tags.includes("rainbow")) reasons.push("This matches your preference for Rainbow-affirming support.");
  if (preferences.includes("trauma-informed") && tags.includes("trauma-informed")) reasons.push("This matches your preference for trauma-informed support.");
  if (preferences.includes("telehealth") && isTelehealthProvider(provider) && distanceLabel !== "Telehealth provider") reasons.push("This matches your preference for phone or video appointments.");
  if (preferences.includes("female-provider") && providerGenderFor(provider) === "female") reasons.push("This matches your preference for a female provider.");
  if (preferences.includes("male-provider") && providerGenderFor(provider) === "male") reasons.push("This matches your preference for a male provider.");

  if (!reasons.length) {
    reasons.push("This option is available for your selected area and gives you a clear next contact step.");
  }

  return reasons.slice(0, 4);
}

function similarActionLabel(provider) {
  if (provider.type === "gp") return "Show similar GP options";
  if (provider.type === "helpline") return "Show similar helplines";
  if (provider.type === "psychologist") return "Show similar psychologists";
  if (provider.type === "counsellor") return "Show similar counsellors";
  if (provider.type === "mens-centre") return "Show similar counselling support";
  return "Show similar contacts";
}

function addRecommendation(recommendations, provider, title) {
  if (!provider || recommendations.some((item) => item.provider.id === provider.id)) return;

  recommendations.push({
    provider,
    title: title || providerHeading(provider),
    similarAction: similarActionLabel(provider),
    reasons: reasonForProvider(provider)
  });
}

function hasSelectedPreferenceMatch(recommendations, preferences) {
  return selectedSupportPreferences(preferences).length > 0
    && recommendations.some((item) => supportPreferenceMatches(item.provider, preferences).length > 0);
}

function recommendationMatchesSelectedType(provider, type = selectedContactType()) {
  if (type === "all") return true;
  if (type === "counsellor") return provider.type === "counsellor" || provider.type === "mens-centre";
  if (type === "addiction") return provider.type === "addiction" || provider.tags?.includes("addiction");
  if (type === "psychiatrist") return provider.type === "psychiatrist" || provider.tags?.includes("psychiatry-service");
  return provider.type === type;
}

function topRecommendations(recommendations, preferences) {
  const selected = selectedSupportPreferences(preferences);
  const selectedType = selectedContactType();
  const ranked = recommendations
    .map((item, index) => ({
      item,
      index,
      typeMatches: recommendationMatchesSelectedType(item.provider, selectedType) ? 1 : 0,
      preferenceMatches: supportPreferenceMatches(item.provider, preferences).length
    }))
    .sort((a, b) => {
      if (selectedType !== "all" && b.typeMatches !== a.typeMatches) return b.typeMatches - a.typeMatches;
      return b.preferenceMatches - a.preferenceMatches || a.index - b.index;
    });

  const top = ranked.slice(0, 3);
  if (selected.length && !top.some((entry) => entry.preferenceMatches > 0)) {
    const supportMatch = ranked.find((entry) => entry.preferenceMatches > 0);
    if (supportMatch) {
      top.splice(Math.min(2, top.length), 1, supportMatch);
    }
  }

  return [...new Map(top.map((entry) => [entry.item.provider.id, entry.item])).values()];
}

function exactPreferenceType() {
  const preference = selectedContactType();
  return ["gp", "psychologist", "psychiatrist"].includes(preference) ? preference : "";
}

function recommendedMoves() {
  const matches = recommendationCandidates();
  const fallbackMatches = matches.length ? matches : recommendationCandidates("all", { includeUnavailable: true });
  const preference = selectedContactType();
  const needs = checkedValues("need");
  const barriers = checkedValues("barrier");
  const preferences = checkedValues("preference");
  const identity = document.querySelector("#identity").value;
  const recommendations = [];
  const best = (predicate) => fallbackMatches.find(predicate);
  const availablePreferredMatches = preference === "all" ? [] : recommendationCandidates(preference);
  const preferredMatches = availablePreferredMatches.length
    ? availablePreferredMatches
    : preference === "all"
      ? []
      : recommendationCandidates(preference, { includeUnavailable: true });
  const exactType = exactPreferenceType();
  const genderPreferredMatches = selectedProviderGenderPreference(preferences)
    ? preferredMatches.filter((provider) => providerMatchesSelectedGender(provider, preferences))
    : [];
  const preferredPathMatches = genderPreferredMatches.length ? genderPreferredMatches : preferredMatches;

  preferredPathMatches.slice(0, 3).forEach((provider, index) => {
    addRecommendation(
      recommendations,
      provider,
      index === 0 ? "Your selected first step" : "Another good option"
    );
  });

  if (!exactType && selectedSupportPreferences(preferences).length && !hasSelectedPreferenceMatch(recommendations, preferences)) {
    addRecommendation(
      recommendations,
      best((provider) => supportPreferenceMatches(provider, preferences).length > 0),
      "Prioritise a safer fit"
    );
  }

  if (exactType) return topRecommendations(recommendations, preferences);

  if (recommendations.length >= 3 && (!selectedSupportPreferences(preferences).length || hasSelectedPreferenceMatch(recommendations, preferences))) {
    return topRecommendations(recommendations, preferences);
  }

  addRecommendation(recommendations, best((provider) => provider.type === "gp"), "Start with a GP or nurse");

  if (contactPreference.value !== "unsure" && (needs.includes("anxiety") || needs.includes("depression") || barriers.includes("privacy"))) {
    addRecommendation(recommendations, best((provider) => provider.type === "helpline"), "Talk to someone before booking");
  }

  if (identity === "male" && contactPreference.value === "therapist") {
    addRecommendation(recommendations, best((provider) => provider.type === "mens-centre" || provider.tags?.includes("male")), "Use lower-pressure counselling support");
  }

  if (preferences.length || barriers.includes("culture")) {
    addRecommendation(
      recommendations,
      best((provider) => supportPreferenceMatches(provider, preferences).length > 0),
      "Prioritise a safer fit"
    );
  }

  if (needs.includes("trauma")) {
    addRecommendation(recommendations, best((provider) => provider.tags?.includes("trauma")), "Use trauma-informed support");
  }

  if (needs.includes("addiction")) {
    addRecommendation(recommendations, best((provider) => provider.type === "addiction" || provider.tags?.includes("addiction")), "Use addiction-aware support");
  }

  if (barriers.includes("cost") || barriers.includes("wait")) {
    addRecommendation(recommendations, best((provider) => provider.type === "public-service" || provider.tags?.includes("cost")), "Look for funded or low-cost support");
  }

  addRecommendation(recommendations, best((provider) => provider.type === "counsellor"), "Ask a counsellor or therapist");
  addRecommendation(recommendations, best((provider) => provider.type === "psychologist"), "Look for a psychologist");
  addRecommendation(recommendations, fallbackMatches[0], "Best overall match");

  return topRecommendations(recommendations, preferences);
}

function contactTarget() {
  const provider = providers.find((item) => item.id === contactProviderId);
  if (provider) {
    const directory = isDirectoryLike(provider);
    const gpReferral = providerRequiresGpReferral(provider);
    const label = providerPrimaryName(provider);
    const fullLabel = providerDisplayLabel(provider);
    const websiteOwner = provider.practiceName || provider.name;
    return {
      label: gpReferral ? "your GP" : label,
      email: directory || gpReferral ? "" : provider.email || "",
      phone: directory || gpReferral ? "" : provider.phone || "",
      text: directory || gpReferral ? "" : provider.text || "",
      website: safeHref(provider.bookingUrl || provider.website),
      websiteLabel: gpReferral
        ? `Open ${label} profile`
        : provider.bookingUrl
          ? "Open booking page"
          : `Open ${websiteOwner} website`,
      isDirectory: directory,
      isGpReferral: gpReferral,
      referralProviderLabel: fullLabel,
      referralNote: providerReferralNote(provider),
      subject: gpReferral ? `Psychiatry referral request for ${fullLabel}` : `Support request for ${fullLabel}`,
      greeting: provider.name.includes("1737") || gpReferral ? "Kia ora" : `Kia ora ${label}`
    };
  }

  const preference = contactPreference.value;

  if (preference === "helpline") {
    return {
      label: "1737",
      email: "",
      phone: "1737",
      text: "1737",
      website: "",
      isDirectory: false,
      subject: "I need mental health support",
      greeting: "Kia ora"
    };
  }

  if (preference === "therapist") {
    return {
      label: "a counsellor or therapist",
      email: "",
      phone: "",
      text: "",
      website: "",
      isDirectory: false,
      subject: "Counselling enquiry",
      greeting: "Kia ora"
    };
  }

  if (preference === "psychologist") {
    return {
      label: "a psychologist",
      email: "",
      phone: "",
      text: "",
      website: "",
      isDirectory: false,
      subject: "Psychology appointment enquiry",
      greeting: "Kia ora"
    };
  }

  if (preference === "psychiatrist") {
    return {
      label: "a psychiatrist",
      email: "",
      phone: "",
      text: "",
      website: "",
      isDirectory: false,
      subject: "Psychiatry appointment enquiry",
      greeting: "Kia ora"
    };
  }

  if (preference === "unsure") {
    return {
      label: "a care provider",
      email: "",
      phone: "",
      text: "",
      website: "",
      isDirectory: false,
      subject: "Mental health support enquiry",
      greeting: "Kia ora"
    };
  }

  return {
    label: "my GP clinic",
    email: "",
    phone: "",
    text: "",
    website: "",
    isDirectory: false,
    subject: "Mental health appointment request",
    greeting: "Kia ora"
  };
}

function askLine() {
  const ask = contactAsk.value;
  if (ask === "callback") return "Could someone please call me back about the next step?";
  if (ask === "cost") return "Could you please confirm your fees and any WINZ, ACC, EAP, funded, or low-cost options?";
  if (ask === "fit") return "Could you please let me know whether your service is a good fit, or suggest another option if not?";
  if (ask === "judgement") return "Could we start with a gentle, non-judgemental first step?";
  return "Could I please book an appointment, or be told the soonest available option?";
}

function messageContextLine(age, location, needs) {
  const ageText = age ? `I am ${age}` : "I am an adult";
  return `${ageText} and based in ${location}. I am looking for support with ${labelledList(needs, needLabels)}.`;
}

function buildContactMessage() {
  const age = Number(document.querySelector("#age").value || 0);
  const location = matchedRegion || "my area";
  const needs = checkedValues("need");
  const barriers = checkedValues("barrier");
  const preferences = checkedValues("preference");
  const target = contactTarget();
  const comfort = contactComfort.value;
  const name = contactName.value.trim();
  const reply = contactReply.value.trim();
  const lines = target.isGpReferral
    ? [
        target.greeting,
        "",
        "I would like to book a GP appointment to talk about a psychiatry referral.",
        messageContextLine(age, location, needs),
        `If appropriate, I would like to discuss referral to ${target.referralProviderLabel}.`,
        "Please let me know what information to bring, including symptoms, medication history, previous diagnoses, and any safety concerns."
      ]
    : [
        target.greeting,
        "",
        messageContextLine(age, location, needs),
        askLine()
      ];

  const selectedContactProvider = providers.find((item) => item.id === contactProviderId);
  if (!target.isGpReferral && selectedContactProvider && isPsychiatryProvider(selectedContactProvider) && providerReferralType(selectedContactProvider) === "unknown") {
    lines.push("Could you please let me know whether I need a GP referral before booking?");
  }

  if (barriers.length && comfort !== "minimal") {
    lines.push(`The main things making care harder are ${labelledList(barriers, barrierLabels)}.`);
  }

  if (preferences.length) {
    lines.push(`If possible, I would prefer ${labelledList(preferences, preferenceLabels)}.`);
  }

  if (comfort === "open") {
    lines.push("A clear first step would help.");
  } else if (comfort === "minimal") {
    lines.push("A simple next step would help.");
  }

  if (reply) lines.push(`My preferred contact is ${reply}.`);
  if (barriers.includes("cost")) {
    lines.push("Cost is a concern, so I would appreciate any funding information, including whether WINZ Disability Allowance may apply.");
  }
  if (barriers.includes("privacy")) {
    lines.push("Privacy matters to me, so please let me know what information is needed at this stage.");
  }

  lines.push("", "Thank you.");
  if (name) lines.push(name);

  return lines.join("\n");
}

function contactAvailabilityNote(target, provider) {
  if (!provider) {
    return "Choose a specific provider to show only the contact buttons we have confirmed for them.";
  }

  const availability = providerAvailabilityNote(provider, { compact: true });
  const referral = providerReferralNote(provider);
  const referralText = referral ? ` ${referral}` : "";

  if (target.isDirectory) {
    return `This is a directory or navigator, not a direct provider. Email and call buttons are hidden; open the website and choose a specific service. ${availability}`;
  }

  if (target.isGpReferral) {
    return `${referralText.trim()} Provider email and call buttons are hidden here because the next step is a GP referral conversation. You can still open the profile and copy the GP message. ${availability}`;
  }

  const missing = [];
  if (!target.email) missing.push("an email address");
  if (!target.phone && !target.text) missing.push("a phone or text number");
  if (!missing.length) return isUnavailableForFirstRecommendations(provider)
    ? `${availability}${referralText} Contact only if you want to check whether this has changed.`
    : `${availability}${referralText}`;

  const fallback = target.website
    ? " You can copy the message and use their website or contact form."
    : " Choose another provider if you need that contact method.";
  return `${availability}${referralText} This provider does not publish ${sentenceList(missing)} in our database.${fallback}`;
}

function setContactAction(element, href, label) {
  if (!href) {
    element.hidden = true;
    element.textContent = "";
    element.removeAttribute("href");
    element.removeAttribute("target");
    element.removeAttribute("rel");
    return;
  }

  element.hidden = false;
  element.href = href;
  element.textContent = label;

  if (/^https?:\/\//i.test(href)) {
    element.target = "_blank";
    element.rel = "noopener noreferrer";
  } else {
    element.removeAttribute("target");
    element.removeAttribute("rel");
  }
}

function contactMailtoHref(target, message) {
  const email = safeMailAddress(target.email);
  if (!email) return "";

  const subject = encodeURIComponent(target.subject || "Mental health support enquiry");
  const body = encodeURIComponent(message || "");
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function updateContactActions(target, message) {
  setContactAction(emailMessage, contactMailtoHref(target, message), `Email ${target.label}`);
  setContactAction(callTarget, target.phone ? `tel:${normalisePhone(target.phone)}` : "", `Call ${target.label}`);
  setContactAction(textTarget, target.text ? `sms:${normalisePhone(target.text)}` : "", `Text ${target.label}`);
  setContactAction(websiteTarget, target.website || "", target.websiteLabel || `Open ${target.label} website`);
}

function renderContact() {
  const location = matchedRegion || "";
  if (canterburyOnlyContact) {
    canterburyOnlyContact.hidden = !isChristchurchMensSupportRelevant(location);
  }

  if (!intakeStatus().complete) {
    contactMessage.value = "";
    selectedProvider.textContent = "Complete the guide questions first, then we will build a first message.";
    setContactAction(emailMessage, "", "");
    setContactAction(callTarget, "tel:1737", "Call 1737");
    setContactAction(textTarget, "", "");
    setContactAction(websiteTarget, "", "");
    contactAvailability.textContent = "";
    return;
  }

  const target = contactTarget();
  const message = buildContactMessage();
  contactMessage.value = message;
  updateContactActions(target, message);

  const provider = providers.find((item) => item.id === contactProviderId);
  selectedProvider.textContent = provider
    ? target.isDirectory
      ? `${provider.name} is a directory or navigator. Use the website to choose a specific provider; this tool will not email or call it as if it were a provider.`
      : target.isGpReferral
        ? `${providerDisplayLabel(provider)} appears to need a GP referral. The message below is written for your GP, and provider email/call buttons are hidden.`
      : `Using ${providerDisplayLabel(provider)}. You can still edit the message before sending.`
    : "Choose a provider above, or use the message with any service you find.";
  contactAvailability.textContent = contactAvailabilityNote(target, provider);
}

function scrollToSuggestedFirstStep() {
  if (carePathScrollScheduled) return;
  carePathScrollScheduled = true;

  requestAnimationFrame(() => {
    const target = resultList.querySelector(".recommendation-card--primary")
      || resultList.querySelector(".intake-gate")
      || document.querySelector(".results");
    pendingCarePathScroll = false;
    carePathScrollScheduled = false;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function render() {
  const status = intakeStatus();
  const becameComplete = status.complete && !wasIntakeComplete;
  wasIntakeComplete = status.complete;
  if (becameComplete) pendingCarePathScroll = true;
  renderProgress(status);
  syncAddressRequirement();
  providerFinder.hidden = !status.complete;
  contactLayout.hidden = !status.complete;

  if (!status.complete) {
    pendingCarePathScroll = false;
    profileLine.textContent = "Answer the guide questions to unlock a care path.";
    resultList.innerHTML = `
      <article class="intake-gate">
        <h3>We will show your care path after these are filled in.</h3>
        <p>Needed: ${sentenceList(status.missing)}.</p>
        <p>Nothing needs to be perfect. A rough answer is enough to suggest safer first-contact options.</p>
      </article>
    `;
    renderContact();
    return;
  }

  if (!providers.length) {
    profileLine.textContent = "Loading care options...";
    resultList.innerHTML = `
      <article class="intake-gate">
        <h3>Finding care options for your answers.</h3>
        <p>This should only take a moment.</p>
      </article>
    `;
    return;
  }

  const paths = buildPaths();
  const moves = recommendedMoves();
  const exactType = exactPreferenceType();
  if (exactType) {
    const selected = providers.find((provider) => provider.id === selectedProviderId);
    if (!selected || selected.type !== exactType) {
      selectedProviderId = recommendationCandidates(exactType)[0]?.id
        || recommendationCandidates(exactType, { includeUnavailable: true })[0]?.id
        || "";
      contactProviderId = "";
    }
  }
  const filterOptions = pathFilterOptions(paths)
    .map(
      (option) => `
        <button class="path-filter" type="button" data-provider-type="${escapeHtml(option.type || "")}" data-provider-search="${escapeHtml(option.search || "")}">
          ${escapeHtml(option.label)}
        </button>
      `
    )
    .join("");

  resultList.innerHTML = `
    ${moves.length ? `
      <div class="recommendation-grid" aria-label="Recommended first contact options">
        ${moves.map((move, index) => {
          const distanceLabel = providerDistanceLabel(move.provider);
          const unavailable = isUnavailableForFirstRecommendations(move.provider);
          const availabilityStatus = providerAvailabilityStatus(move.provider);
          const availabilityNote = providerAvailabilityNote(move.provider, { compact: true });
          const referralNote = providerReferralNote(move.provider);
          const gpReferral = providerRequiresGpReferral(move.provider);
          return `
        <article class="recommendation-card recommendation-card--availability-${safeClassToken(availabilityStatus)} ${index === 0 ? "recommendation-card--primary" : ""}">
          <div class="recommendation-rank">${index + 1}</div>
          <div>
            <div class="recommendation-card__header">
              <div>
                <p class="recommendation-kicker">${escapeHtml(move.title)}</p>
                ${providerNameMarkup(move.provider)}
                <p class="recommendation-meta">${escapeHtml(move.provider.region)}${move.provider.city ? ` | ${escapeHtml(move.provider.city)}` : ""}${distanceLabel ? ` | ${escapeHtml(distanceLabel)}` : ""}</p>
              </div>
              ${providerTypeBadge(move.provider)}
            </div>
            <p>${escapeHtml(move.provider.firstStep)}</p>
            ${referralNote ? `<p class="referral-note">${escapeHtml(referralNote)}</p>` : ""}
            <p class="availability-note availability-note--${safeClassToken(availabilityStatus)}">${escapeHtml(availabilityNote)}</p>
            <ul>
              ${move.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
            </ul>
            <div class="recommendation-actions">
              <button class="button button--primary use-path" type="button" data-provider-id="${escapeHtml(move.provider.id)}">
                ${unavailable ? "Check availability first" : gpReferral ? "Plan GP referral" : "Use this path"}
              </button>
              <button class="button button--quiet path-filter" type="button" data-provider-type="${escapeHtml(move.provider.type)}" data-provider-search="">
                ${escapeHtml(move.similarAction)}
              </button>
            </div>
          </div>
        </article>
        `;
        }).join("")}
      </div>
    ` : `
      <article class="intake-gate">
        <h3>No direct ${providerTypeLabel(exactType || "provider").toLowerCase()} contacts loaded for this area yet.</h3>
        <p>This tool will not substitute unrelated services when you choose a specific professional type. Try a nearby suburb, choose another contact type, or add verified provider data to the local database.</p>
      </article>
    `}
    <div class="path-filter-row" aria-label="Tune contact matches">
      ${filterOptions}
    </div>
    <details class="path-details">
      <summary>Why these paths?</summary>
      ${paths.map((path) => `
        <article class="path-card ${safeClassToken(path.tone || "")}">
          <h3>${escapeHtml(path.title)}</h3>
          <p>${escapeHtml(path.body)}</p>
          ${safeHref(path.href, { allowHash: true }) ? `<a href="${escapeHtml(safeHref(path.href, { allowHash: true }))}"${externalLinkAttrs(safeHref(path.href, { allowHash: true }))}>${escapeHtml(path.action)}</a>` : ""}
        </article>
      `).join("")}
    </details>
  `;
  renderProviders();
  renderContact();
  if (pendingCarePathScroll) {
    scrollToSuggestedFirstStep();
  }
}

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", (event) => {
  enforceExclusiveProviderGenderPreference(event.target);
  render();
});

function chooseProviderForContact(providerId) {
  selectedProviderId = providerId;
  const provider = providers.find((item) => item.id === selectedProviderId);
  if (provider) {
    contactProviderId = isDirectoryLike(provider) ? "" : provider.id;
    providerType.value = provider.type;
    providerSearch.value = "";
    providerVisibleCount = providerBatchSize;
  } else {
    contactProviderId = "";
  }
  renderProviders();
  renderContact();
  document.querySelector(".contact-layout").scrollIntoView({ behavior: "smooth", block: "start" });
}

resultList.addEventListener("click", (event) => {
  const usePath = event.target.closest(".use-path");
  if (usePath) {
    chooseProviderForContact(usePath.dataset.providerId);
    return;
  }

  const button = event.target.closest(".path-filter");
  if (!button) return;
  providerType.value = button.dataset.providerType || "all";
  providerSearch.value = button.dataset.providerSearch || "";
  contactProviderId = "";
  providerVisibleCount = providerBatchSize;
  renderProviders();
  renderContact();
  document.querySelector(".provider-finder").scrollIntoView({ behavior: "smooth", block: "start" });
});
contactName.addEventListener("input", renderContact);
contactReply.addEventListener("input", renderContact);
contactAsk.addEventListener("input", renderContact);
contactComfort.addEventListener("input", renderContact);
contactMessage.addEventListener("input", () => {
  if (!intakeStatus().complete) return;
  updateContactActions(contactTarget(), contactMessage.value);
});
contactPreference.addEventListener("input", () => {
  const preference = selectedContactType();
  const firstMatch = recommendationCandidates(preference)[0]
    || recommendationCandidates(preference, { includeUnavailable: true })[0]
    || (exactPreferenceType() ? null : filteredProviders()[0]);
  if (firstMatch) selectedProviderId = firstMatch.id;
  else selectedProviderId = "";
  contactProviderId = "";
  render();
});
addressInput.addEventListener("input", () => {
  const query = addressInput.value.trim();
  const token = ++addressLookupToken;

  userCoords = null;
  matchedRegion = "";

  if (query.length < 3) {
    addressSuggestionMatches = [];
    hideAddressSuggestions();
    addressStatus.textContent = "Start typing a New Zealand address or suburb.";
    render();
    return;
  }

  addressStatus.textContent = "Looking for New Zealand address matches...";
  updateAddressSuggestions(query, token);
  render();
});
addressInput.addEventListener("keydown", async (event) => {
  if (event.key === "ArrowDown" && addressSuggestionMatches.length) {
    event.preventDefault();
    setActiveAddressSuggestion(activeAddressSuggestionIndex + 1);
    return;
  }

  if (event.key === "ArrowUp" && addressSuggestionMatches.length) {
    event.preventDefault();
    setActiveAddressSuggestion(activeAddressSuggestionIndex - 1);
    return;
  }

  if (event.key === "Escape") {
    hideAddressSuggestions();
    return;
  }

  if (event.key !== "Enter") return;
  event.preventDefault();

  const activeMatch = addressSuggestionMatches[activeAddressSuggestionIndex];
  if (activeMatch) {
    await applyAddressMatch(activeMatch, "Using");
    return;
  }

  if (addressSuggestionMatches.length) {
    addressStatus.textContent = "Choose a suggested New Zealand address or suburb to use it.";
    return;
  }

  addressStatus.textContent = "Keep typing until New Zealand suggestions appear, then choose one.";
});
addressInput.addEventListener("change", () => {
  if (!matchedRegion && addressInput.value.trim().length >= 3 && addressSuggestionMatches.length) {
    addressStatus.textContent = "Choose a suggested New Zealand address or suburb to use it.";
  }
});
addressInput.addEventListener("blur", () => {
  setTimeout(() => {
    hideAddressSuggestions();
    if (!matchedRegion && addressInput.value.trim().length >= 3) {
      addressStatus.textContent = "Choose a suggested New Zealand address or suburb to use it.";
    }
  }, 120);
});
addressSuggestions.addEventListener("mousedown", (event) => {
  if (event.target.closest(".address-suggestion")) event.preventDefault();
});
addressSuggestions.addEventListener("click", async (event) => {
  const button = event.target.closest(".address-suggestion");
  if (!button) return;
  const match = addressSuggestionMatches[Number(button.dataset.addressIndex)];
  if (match) await applyAddressMatch(match, "Using");
});
function resetProviderList() {
  providerVisibleCount = providerBatchSize;
  contactProviderId = "";
  renderProviders();
  renderContact();
}

providerSearch.addEventListener("input", resetProviderList);
providerType.addEventListener("input", resetProviderList);
providerCost.addEventListener("input", resetProviderList);
showMoreProviders.addEventListener("click", () => {
  providerVisibleCount += providerBatchSize;
  renderProviders();
});
providerList.addEventListener("click", (event) => {
  const button = event.target.closest(".select-provider");
  if (!button) return;
  chooseProviderForContact(button.dataset.providerId);
});
copyMessage.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(contactMessage.value);
    copyStatus.textContent = "Message copied.";
  } catch {
    contactMessage.select();
    document.execCommand("copy");
    copyStatus.textContent = "Message selected and copied.";
  }
});
render();
loadProviders();
