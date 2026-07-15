import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultPaths = {
  providers: "providers.json",
  allowlist: "data/provider-source-fit-allowlist.json",
  json: "data/provider-source-fit-audit.json",
  markdown: "PROVIDER_SOURCE_FIT_AUDIT.md"
};

const broadNeedTerms = {
  depression: /\b(depression|depressive|low mood|mood disorder|mood disorders)\b/i,
  anxiety: /\b(anxiety|panic|overwhelm|ocd|obsessive-compulsive|worry)\b/i,
  trauma: /\b(trauma|ptsd|post-traumatic|sexual harm|sexual abuse|sensitive claims|emdr)\b/i,
  addiction: /\b(addiction|alcohol|drug|gambling|aod|substance)\b/i,
  work: /\b(work|workplace|employment|study|money|housing|burnout|return to work|vocational)\b/i
};

const supportEvidence = {
  maori: /\b(whanau|whanau|marae|iwi|maori|maori|kaupapa|ngati|ngati|rongoa|rongoa)\b/i,
  pasifika: /\b(pasifika|pacific|samoan|tongan|cook islands|vaka|fono|etu pasifika|etu pasifika)\b/i,
  asian: /\b(asian|chinese|korean|indian|mandarin|cantonese|hong kong|vietnamese|japanese|filipino|thai|hindi|punjabi|gujarati|urdu|tamil|telugu)\b/i,
  rainbow: /\b(rainbow|lgbt|lgbtq|lgbtqia|takatapui|takatapui|sexuality|gender diverse|transgender|gay|lesbian|bisexual|intersex)\b/i
};

const telehealthEvidence = /\b(telehealth|telepsychiatr(?:y|ic)|online|video|zoom|remote|phone appointment|phone counselling|virtual)\b/i;
const rehabEvidence = /\b(acc|rehab|rehabilitation|concussion|pain|injury|injuries|workplace|eap|return to work|vocational)\b/i;
const sexualHarmEvidence = /\b(sexual harm|sexual abuse|rape|sensitive claims|survivors of sexual)\b/i;
const addictionOnlyEvidence = /\b(addiction|alcohol|drug|gambling|aod|substance)\b/i;
const directoryEvidence = /\b(directory|find a|search|register|listing|listings|navigator)\b/i;
const registerEvidence = /\b(register|directory|nzccp|ranzcp|your health in mind|psychologists board|psychologistsboard)\b/i;
const generalMentalHealthEvidence = /\b(mental health|mental illness|mental unwellness|wellbeing|counselling|counseling|therapy|psychotherapy|psychiatry|psychiatric|depression|anxiety|mood|trauma|stress|emotional distress|peer support)\b/i;
const broadRehabCareEvidence = /\b(clinical psychology|clinical psychologist|counselling|counseling|therapy|psychotherapy|mental health|wellbeing|emotional distress|adjustment|depression|anxiety|stress)\b/i;
const sexualHarmOnlyEvidence = /\b(rape and sexual abuse counselling|sexual harm counselling|sensitive claims counselling|victims and survivors of sexual harm|victims and survivors of sexual abuse)\b/i;
const broadNonSexualClinicalEvidence = /\b(mental health|mental illness|wellbeing|psychotherapy|psychiatry|psychiatric|depression|anxiety|mood|stress|emotional distress|general counselling|general counseling|general therapy)\b/i;

function readJsonIfExists(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readRequiredJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Required JSON file not found: ${filePath || "(missing path)"}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tags(provider) {
  return Array.isArray(provider.tags) ? provider.tags : [];
}

function hasTag(provider, tag) {
  return tags(provider).includes(tag);
}

function hasAnyTag(provider, values) {
  return values.some((tag) => hasTag(provider, tag));
}

function sourceText(provider, { includeTags = false, includeAdvertisedSpecialties = false } = {}) {
  return [
    provider.name,
    provider.clinicianName,
    provider.practiceName,
    provider.type,
    provider.region,
    provider.city,
    provider.source,
    provider.website,
    provider.sourceQuality,
    provider.cost,
    provider.fit,
    provider.firstStep,
    provider.hours,
    ...(provider.specialties || []),
    ...(includeAdvertisedSpecialties ? (provider.advertisedSpecialties || []) : []),
    ...(provider.patientGroups || []),
    ...(provider.ageGroups || []),
    ...(provider.services || []),
    ...(provider.languages || []),
    ...(includeTags ? tags(provider) : [])
  ].join(" ").toLowerCase();
}

function specialtySupportedBySource(specialty, text) {
  const value = normaliseText(specialty).toLowerCase();
  if (!value) return true;
  if (text.includes(value)) return true;

  const meaningfulWords = value
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 4 && !["disorder", "disorders", "support", "therapy", "assessment"].includes(word));
  return meaningfulWords.length > 0 && meaningfulWords.some((word) => text.includes(word));
}

function isDirectoryLike(provider) {
  return provider.type === "directory" || hasTag(provider, "directory");
}

function isTelehealthProvider(provider) {
  if (hasAnyTag(provider, ["telehealth", "online"])) return true;
  if (provider.onlineAvailable === true || provider.phoneSupport === true) return true;
  if (provider.type === "helpline") return true;
  return provider.region === "National"
    && ["addiction", "youth"].includes(provider.type)
    && Boolean(provider.phone || provider.text || hasTag(provider, "online"));
}

function hasDirectContact(provider) {
  return Boolean(provider.phone || provider.text || provider.email || provider.website || provider.bookingUrl);
}

function sourceHost(value) {
  try {
    return new URL(value || "").hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSameSourceAndWebsite(provider) {
  return sourceHost(provider.source) && sourceHost(provider.source) === sourceHost(provider.website);
}

function isRegisterOnlyProfessional(provider) {
  if (!["psychologist", "psychiatrist"].includes(provider.type)) return false;
  const text = sourceText(provider, { includeAdvertisedSpecialties: false });
  const sourceQuality = String(provider.sourceQuality || "").toLowerCase();
  return registerEvidence.test(text)
    && /register|directory|professional/.test(sourceQuality)
    && !provider.phone
    && !provider.email
    && !provider.bookingUrl
    && isSameSourceAndWebsite(provider);
}

function addFinding(findings, provider, rule, severity, issue, suggestedFix) {
  findings.push({
    providerId: provider.id || "",
    providerName: provider.name || "",
    region: provider.region || "",
    city: provider.city || "",
    type: provider.type || "",
    tags: tags(provider),
    needScope: Array.isArray(provider.needScope) ? provider.needScope : null,
    source: provider.source || provider.website || "",
    rule,
    severity,
    issue,
    suggestedFix
  });
}

function evaluateProvider(provider) {
  const findings = [];
  const text = sourceText(provider);
  const textWithTags = sourceText(provider, { includeTags: true });
  const providerTags = tags(provider);
  const broadTags = Object.keys(broadNeedTerms).filter((tag) => providerTags.includes(tag));
  const hasNeedScope = Array.isArray(provider.needScope);
  const scope = hasNeedScope ? provider.needScope : [];

  const narrowRehab = ["psychologist", "counsellor"].includes(provider.type)
    && hasAnyTag(provider, ["rehabilitation", "acc", "pain", "concussion", "workplace", "eap", "injury", "return-to-work", "vocational"])
    && rehabEvidence.test(textWithTags)
    && !broadRehabCareEvidence.test(text)
    && !broadTags.some((tag) => ["depression", "anxiety", "trauma", "addiction", "relationships", "grief"].includes(tag) && broadNeedTerms[tag]?.test(text));

  if (narrowRehab && broadTags.some((tag) => ["depression", "anxiety", "trauma", "addiction"].includes(tag)) && !scope.includes("work")) {
    addFinding(
      findings,
      provider,
      "narrow-rehab-overbroad-tags",
      "high",
      "Provider appears ACC/rehab/pain/concussion/workplace focused but has broad mental-health tags without work/rehab needScope.",
      "Remove unsupported broad need tags, add needScope [\"work\"], or verify the source explicitly supports general mental-health care."
    );
  } else if (narrowRehab && !scope.includes("work")) {
    addFinding(
      findings,
      provider,
      "narrow-rehab-missing-scope",
      "medium",
      "Provider appears rehab/work/injury focused and may need work needScope to avoid broad ranking.",
      "Add needScope [\"work\"] unless a source confirms general mental-health care."
    );
  }

  const sexualHarmOnly = (hasAnyTag(provider, ["sexual-harm", "sensitive-claims"]) || sexualHarmEvidence.test(textWithTags))
    && sexualHarmOnlyEvidence.test(text)
    && !broadNonSexualClinicalEvidence.test(text)
    && !["depression", "anxiety", "addiction", "work"].some((tag) => providerTags.includes(tag) && broadNeedTerms[tag].test(text));
  if (sexualHarmOnly && (!scope.includes("trauma") || broadTags.some((tag) => ["depression", "anxiety", "addiction", "work"].includes(tag)))) {
    addFinding(
      findings,
      provider,
      "sexual-harm-overbroad",
      "high",
      "Source appears sexual-harm/sensitive-claims focused but the record can rank outside that scope.",
      "Use needScope [\"trauma\"] and remove unsupported depression, anxiety, addiction, or work tags unless the source explicitly supports them."
    );
  }

  const addictionOnly = (provider.type === "addiction" || (provider.type === "helpline" && hasTag(provider, "addiction")) || hasAnyTag(provider, ["gambling", "alcohol", "drug"]))
    && addictionOnlyEvidence.test(textWithTags)
    && !generalMentalHealthEvidence.test(text)
    && !["depression", "anxiety", "trauma", "work"].some((tag) => providerTags.includes(tag) && broadNeedTerms[tag].test(text));
  if (addictionOnly && broadTags.some((tag) => ["depression", "anxiety", "trauma", "work"].includes(tag)) && !scope.includes("addiction")) {
    addFinding(
      findings,
      provider,
      "addiction-overbroad",
      "high",
      "Provider appears addiction-specific but has broad mental-health tags without addiction needScope.",
      "Add needScope [\"addiction\"] and remove unsupported broad mental-health tags."
    );
  }

  if ((provider.crisisOnly === true || hasTag(provider, "crisis")) && ["counsellor", "psychologist", "psychiatrist", "gp"].includes(provider.type)) {
    addFinding(
      findings,
      provider,
      "crisis-routine-type",
      "high",
      "Crisis-only or emergency support is typed as a routine first-contact provider.",
      "Use type public-service, helpline, or directory; keep crisis tagged records out of routine recommendations."
    );
  }

  if (provider.crisisOnly === true && broadTags.length && !hasTag(provider, "crisis")) {
    addFinding(
      findings,
      provider,
      "crisis-missing-crisis-tag",
      "high",
      "crisisOnly is true but the provider is missing the crisis tag.",
      "Add crisis tag or remove crisisOnly if this is a routine service."
    );
  }

  if (provider.type === "directory" && (hasTag(provider, "direct-contact") || provider.phone || provider.email || provider.text)) {
    addFinding(
      findings,
      provider,
      "directory-treated-direct",
      "high",
      "Directory record has direct-contact signals and may be treated like a provider.",
      "Remove direct-contact signals from directories and only expose website navigation."
    );
  } else if (provider.type !== "directory" && hasTag(provider, "directory") && hasTag(provider, "direct-contact")) {
    addFinding(
      findings,
      provider,
      "direct-provider-tagged-directory",
      "high",
      "Direct provider is also tagged as a directory.",
      "Choose one role: type directory with website only, or remove the directory tag if this is a direct provider."
    );
  } else if (provider.type !== "directory" && hasTag(provider, "directory")) {
    addFinding(
      findings,
      provider,
      "direct-provider-directory-tag-review",
      "medium",
      "Provider is not typed as a directory but carries a directory tag.",
      "Confirm whether this is a navigator/directory or a direct service; adjust type/tags accordingly."
    );
  }

  if (provider.region === "National"
    && ["counsellor", "psychologist", "psychiatrist"].includes(provider.type)
    && !isTelehealthProvider(provider)) {
    addFinding(
      findings,
      provider,
      "national-clinician-no-telehealth",
      "high",
      "Individual clinician is marked National without confirmed telehealth or national reach.",
      "Set the real local region, or add telehealth evidence only if the source confirms it."
    );
  }

  for (const [tag, pattern] of Object.entries(supportEvidence)) {
    if (hasTag(provider, tag) && !pattern.test(text)) {
      addFinding(
        findings,
        provider,
        `weak-${tag}-evidence`,
        "medium",
        `${tag} support tag is present but source fields do not clearly support it.`,
        "Remove the tag or add a stronger public source/structured patientGroups/languages evidence."
      );
    }
  }

  if ((hasAnyTag(provider, ["telehealth", "online"]) || provider.onlineAvailable === true || provider.phoneSupport === true)
    && provider.type !== "helpline"
    && !telehealthEvidence.test(text)) {
    addFinding(
      findings,
      provider,
      "weak-telehealth-evidence",
      "medium",
      "Telehealth or online availability is set but source fields do not clearly support remote care.",
      "Remove telehealth/online flags or add a provider-owned source that confirms phone/video/online appointments."
    );
  }

  if (isRegisterOnlyProfessional(provider)) {
    addFinding(
      findings,
      provider,
      "register-only-public-contact",
      "medium",
      "Professional appears to come from a register/directory only and lacks a separate public practice contact route.",
      "Keep as a research lead or add a provider-owned/practice contact source before treating as direct first contact."
    );
  }

  if (provider.type === "gp"
    && /third-party|doctorpricer/i.test(`${provider.sourceQuality || ""} ${provider.importSource || ""} ${provider.source || ""}`)
    && (!provider.phone || !provider.website)) {
    addFinding(
      findings,
      provider,
      "weak-gp-source",
      "low",
      "GP record uses a third-party or generic source and is missing either phone or website.",
      "Verify against a practice-owned page, Healthpoint, HPI/FHIR export, or PHO data when available."
    );
  }

  if (["counsellor", "psychologist", "psychiatrist"].includes(provider.type)) {
    const sourceBackedText = sourceText(provider, {
      includeTags: false,
      includeAdvertisedSpecialties: false
    });
    const unsupportedAdvertised = (provider.advertisedSpecialties || [])
      .filter((specialty) => !specialtySupportedBySource(specialty, sourceBackedText));
    if (unsupportedAdvertised.length) {
      addFinding(
        findings,
        provider,
        "advertised-specialty-without-source-support",
        "high",
        `Advertised specialties are present without clear source support: ${unsupportedAdvertised.slice(0, 5).join(", ")}.`,
        "Keep baselineScope separate from advertisedSpecialties, or add provider/profile source evidence for these advertised interests."
      );
    }

    for (const tag of broadTags) {
      if (!broadNeedTerms[tag]?.test(text)) {
        addFinding(
          findings,
          provider,
          "broad-tag-without-source-support",
          "medium",
          `Broad tag "${tag}" is present but source fields do not clearly support it.`,
          `Remove "${tag}" or add source-backed specialties/services evidence.`
        );
      }
    }
  }

  if (!hasNeedScope) {
    addFinding(
      findings,
      provider,
      "missing-need-scope",
      "low",
      "Provider is missing explicit needScope metadata.",
      "Add needScope [] for broad services or a narrow list such as [\"trauma\"], [\"addiction\"], or [\"work\"] for scoped services."
    );
  }

  if (!hasDirectContact(provider)) {
    addFinding(
      findings,
      provider,
      "missing-contact-route",
      provider.type === "directory" ? "medium" : "high",
      "Provider has no public contact route.",
      "Add a website, booking URL, phone, text, or email, or remove the record from live results."
    );
  }

  return findings;
}

function normaliseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function isExpired(value, today = new Date()) {
  const date = normaliseDate(value);
  if (!date) return true;
  return new Date(`${date}T23:59:59Z`) < today;
}

function allowlistKey(providerId, rule = "") {
  return `${providerId}::${rule || "*"}`;
}

function buildAllowlistMap(entries, today = new Date()) {
  const map = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    if (!item?.id || !item.reason || !item.reviewedBy || !item.reviewedDate || !item.expiryDate) continue;
    if (isExpired(item.expiryDate, today)) continue;
    map.set(allowlistKey(item.id, item.rule), item);
  }
  return map;
}

function applyAllowlist(findings, allowlistEntries, today = new Date()) {
  const allowlist = buildAllowlistMap(allowlistEntries, today);
  return findings.map((finding) => {
    const specific = allowlist.get(allowlistKey(finding.providerId, finding.rule));
    const broad = allowlist.get(allowlistKey(finding.providerId));
    const item = specific || broad || null;
    return item ? { ...finding, allowlisted: true, allowlist: item } : { ...finding, allowlisted: false };
  });
}

export function auditProviders(providers, allowlistEntries = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const findings = providers
    .flatMap(evaluateProvider)
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity]
        || a.providerId.localeCompare(b.providerId)
        || a.rule.localeCompare(b.rule);
    });
  const findingsWithAllowlist = applyAllowlist(findings, allowlistEntries, new Date(generatedAt));
  const highFindings = findingsWithAllowlist.filter((finding) => finding.severity === "high");
  const highUnallowlisted = highFindings.filter((finding) => !finding.allowlisted);

  return {
    generatedAt,
    providersScanned: providers.length,
    findings: findingsWithAllowlist,
    summary: {
      total: findingsWithAllowlist.length,
      high: highFindings.length,
      medium: findingsWithAllowlist.filter((finding) => finding.severity === "medium").length,
      low: findingsWithAllowlist.filter((finding) => finding.severity === "low").length,
      highUnallowlisted: highUnallowlisted.length,
      allowlisted: findingsWithAllowlist.filter((finding) => finding.allowlisted).length
    }
  };
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function markdownReport(report) {
  const lines = [
    "# Provider Source-Fit Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Providers scanned: ${report.providersScanned}`,
    "",
    `Findings: ${report.summary.total} total, ${report.summary.high} high (${report.summary.highUnallowlisted} unallowlisted), ${report.summary.medium} medium, ${report.summary.low} low.`,
    "",
    "High severity findings block CI unless allowlisted in `data/provider-source-fit-allowlist.json`.",
    ""
  ];

  if (!report.findings.length) {
    lines.push("No source-fit issues found.", "");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Severity | Provider | Region / city | Type | Issue | Suggested safer fix | Source | Allowlisted |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const finding of report.findings) {
    lines.push([
      finding.severity,
      `${finding.providerId} - ${finding.providerName}`,
      `${finding.region} / ${finding.city}`,
      finding.type,
      finding.issue,
      finding.suggestedFix,
      finding.source,
      finding.allowlisted ? `yes: ${finding.allowlist.reason}` : "no"
    ].map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const config = { ...defaultPaths };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allowlist") config.allowlist = argv[++index];
    else if (arg === "--json-out") config.json = argv[++index];
    else if (arg === "--md-out") config.markdown = argv[++index];
    else if (arg === "--no-write") config.noWrite = true;
    else if (!arg.startsWith("--")) config.providers = arg;
  }
  return config;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function runCli(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const providers = readRequiredJson(config.providers);
  const allowlist = readJsonIfExists(config.allowlist, []);
  const report = auditProviders(providers, allowlist);

  if (!config.noWrite) {
    ensureParent(config.json);
    fs.writeFileSync(config.json, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(config.markdown, markdownReport(report));
  }

  console.log(`Provider source-fit audit: ${report.summary.total} findings; ${report.summary.highUnallowlisted} unallowlisted high severity.`);
  if (!config.noWrite) {
    console.log(`Wrote ${path.resolve(config.json)} and ${path.resolve(config.markdown)}.`);
  }
  process.exitCode = report.summary.highUnallowlisted ? 1 : 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
