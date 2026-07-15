"use strict";

const DATA_URL = "../data/provider-validation/control-room.json";
const PROVIDER_PAGE_SIZE = 100;
const state = { data: null, selectedId: "", filtered: [], visibleProviders: PROVIDER_PAGE_SIZE };

const elements = {
  generatedAt: document.querySelector("#generatedAt"),
  refreshData: document.querySelector("#refreshData"),
  runBanner: document.querySelector("#runBanner"),
  rolloutStage: document.querySelector("#rolloutStage"),
  metrics: document.querySelector("#metrics"),
  providerSearch: document.querySelector("#providerSearch"),
  stateFilter: document.querySelector("#stateFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  regionFilter: document.querySelector("#regionFilter"),
  fetchFilter: document.querySelector("#fetchFilter"),
  providerCount: document.querySelector("#providerCount"),
  providerList: document.querySelector("#providerList"),
  providerShowing: document.querySelector("#providerShowing"),
  loadMoreProviders: document.querySelector("#loadMoreProviders"),
  providerDetail: document.querySelector("#providerDetail"),
  regionalCoverage: document.querySelector("#regionalCoverage"),
  sourceFailures: document.querySelector("#sourceFailures"),
  searchSources: document.querySelector("#searchSources"),
  automaticChanges: document.querySelector("#automaticChanges"),
  runHistory: document.querySelector("#runHistory")
};

function text(value, fallback = "Not recorded") {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
  return String(value);
}

function dateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" });
}

function create(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = String(content);
  return node;
}

function safeExternalLink(url, label) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const link = create("a", "source-link", label || parsed.hostname);
    link.href = parsed.toString();
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch {
    return null;
  }
}

function sourceLabel(url) {
  try { return new URL(url).hostname; } catch { return "Open source"; }
}

function metric(label, value, tone = "") {
  const item = create("div", `metric ${tone}`.trim());
  item.append(create("span", "metric-label", label), create("strong", "metric-value", value));
  return item;
}

function populateSelect(select, values) {
  const current = select.value;
  const placeholder = select.querySelector('option[value=""]');
  select.replaceChildren(placeholder || new Option("All", ""));
  for (const value of [...new Set(values.filter(Boolean))].sort()) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.replaceAll("_", " ");
    select.append(option);
  }
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function renderOverview() {
  const { latestRun, metrics, rollout } = state.data;
  elements.generatedAt.textContent = `Generated ${dateTime(state.data.generatedAt)}`;
  elements.rolloutStage.textContent = `${rollout.stage.replaceAll("_", " ")} · ${rollout.cleanRunsAtStage}/3 clean`;
  elements.rolloutStage.className = `status-badge status-${rollout.readyToPublish ? "verified" : "monitoring"}`;
  elements.runBanner.className = `run-banner ${latestRun.clean ? "run-good" : "run-blocked"}`;
  elements.runBanner.replaceChildren(
    create("strong", "", latestRun.clean ? "Latest validation run passed" : "Publishing remains blocked"),
    create("span", "", latestRun.publishGate?.failures?.length
      ? latestRun.publishGate.failures.join(" · ").replaceAll("-", " ")
      : "All configured publish gates passed.")
  );
  elements.metrics.replaceChildren(
    metric("Providers", metrics.providers),
    metric("Verified", metrics.states.verified || 0, "good"),
    metric("Limited", metrics.states.limited || 0, "attention"),
    metric("Monitoring", metrics.states.monitoring || 0),
    metric("Suppressed", metrics.states.suppressed || 0, "danger"),
    metric("Stale claims", metrics.staleClaims || 0, metrics.staleClaims ? "attention" : "good"),
    metric("Blocked sources", metrics.blockedSources || 0, metrics.blockedSources ? "attention" : "good"),
    metric("Checked this run", `${latestRun.providersChecked || 0}/${latestRun.requiredProvidersForCleanStage || latestRun.providersSelected || 0}`),
    metric("Pages fetched", latestRun.pagesFetched || 0),
    metric("Model calls", latestRun.modelCalls || 0),
    metric("Injection flags", latestRun.promptInjectionPages || 0, latestRun.promptInjectionPages ? "danger" : "good"),
    metric("Proposed changes", (metrics.materialChangesProposed || 0) + (metrics.suppressionsProposed || 0))
  );
}

function applyFilters() {
  const query = elements.providerSearch.value.trim().toLowerCase();
  state.filtered = state.data.providers.filter((provider) => {
    const haystack = [provider.name, provider.clinicianName, provider.practiceName, provider.city, provider.region, provider.providerId].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (!elements.stateFilter.value || provider.status === elements.stateFilter.value)
      && (!elements.typeFilter.value || provider.type === elements.typeFilter.value)
      && (!elements.regionFilter.value || provider.region === elements.regionFilter.value)
      && (!elements.fetchFilter.value || provider.fetchOutcome === elements.fetchFilter.value);
  });
  state.visibleProviders = PROVIDER_PAGE_SIZE;
  renderProviderList();
}

function providerButton(provider) {
  const item = create("li");
  const button = create("button", `provider-row ${provider.providerId === state.selectedId ? "selected" : ""}`.trim());
  button.type = "button";
  button.dataset.providerId = provider.providerId;
  const heading = create("span", "provider-row-heading");
  heading.append(create("strong", "", provider.clinicianName || provider.name));
  heading.append(create("span", `status-badge status-${provider.status}`, provider.status));
  button.append(
    heading,
    create("span", "provider-row-subtitle", provider.clinicianName && provider.practiceName ? provider.practiceName : `${provider.type} · ${provider.city || provider.region || "Location not recorded"}`),
    create("span", "provider-row-meta", `${provider.fetchOutcome.replaceAll("_", " ")} · ${provider.approvedClaims} accepted · ${provider.rejectedClaims} rejected`)
  );
  button.addEventListener("click", () => selectProvider(provider.providerId));
  item.append(button);
  return item;
}

function renderProviderList() {
  elements.providerCount.textContent = `${state.filtered.length} of ${state.data.providers.length}`;
  const visible = state.filtered.slice(0, state.visibleProviders);
  elements.providerList.replaceChildren(...visible.map(providerButton));
  if (!state.filtered.length) elements.providerList.append(create("li", "list-empty", "No providers match these filters."));
  elements.providerShowing.textContent = state.filtered.length
    ? `Showing ${visible.length} of ${state.filtered.length} matches`
    : "No matching providers";
  elements.loadMoreProviders.hidden = visible.length >= state.filtered.length;
}

function detailSection(title, values) {
  const section = create("section", "detail-section");
  section.append(create("h3", "", title));
  const list = create("dl", "field-list");
  for (const [label, value] of values) {
    list.append(create("dt", "", label), create("dd", "", text(value)));
  }
  section.append(list);
  return section;
}

function renderTimeline(provider) {
  const section = create("section", "detail-section wide");
  section.append(create("h3", "", "Source timeline"));
  const links = create("div", "source-links");
  for (const url of provider.sourceUrls || []) {
    const link = safeExternalLink(url, sourceLabel(url));
    if (link) links.append(link);
  }
  if (!links.children.length) links.append(create("span", "muted", "No retained public source URL."));
  section.append(links);
  const timeline = create("ol", "timeline");
  for (const event of provider.timeline || []) {
    const item = create("li");
    const top = create("div", "timeline-heading");
    top.append(create("strong", "", event.event.replaceAll("_", " ")), create("time", "", dateTime(event.at)));
    item.append(top, create("p", "", event.detail));
    const link = safeExternalLink(event.sourceUrl, "Open source");
    if (link) item.append(link);
    timeline.append(item);
  }
  if (!timeline.children.length) timeline.append(create("li", "list-empty", "No evidence has been captured yet."));
  section.append(timeline);
  return section;
}

function selectProvider(providerId) {
  const provider = state.data.providers.find((item) => item.providerId === providerId);
  if (!provider) return;
  state.selectedId = providerId;
  renderProviderList();
  const header = create("header", "detail-title");
  const titleGroup = create("div");
  titleGroup.append(create("p", "eyebrow", `${provider.type} · ${provider.region || "Region not recorded"}`), create("h2", "", provider.clinicianName || provider.name));
  if (provider.clinicianName && provider.practiceName) titleGroup.append(create("p", "practice-name", provider.practiceName));
  header.append(titleGroup, create("span", `status-badge status-${provider.status}`, provider.status));

  const reasonList = create("ul", "reason-list");
  for (const reason of provider.reasons || []) reasonList.append(create("li", "", reason));
  if (!reasonList.children.length) reasonList.append(create("li", "", "No state reason was recorded."));
  const reasonSection = create("section", "detail-section wide");
  reasonSection.append(create("h3", "", "Automated decision"), reasonList);

  const conflictSection = create("section", "detail-section wide");
  conflictSection.append(create("h3", "", "Conflicts"));
  if (provider.conflicts?.length) {
    const list = create("ul", "reason-list danger-text");
    for (const conflict of provider.conflicts) list.append(create("li", "", `${conflict.field}: ${text(conflict.values)}`));
    conflictSection.append(list);
  } else conflictSection.append(create("p", "muted", "No unresolved field conflicts."));

  const grid = create("div", "detail-grid");
  grid.append(
    detailSection("Validation", [["State", provider.status], ["Fetch outcome", provider.fetchOutcome], ["Last checked", dateTime(provider.lastCheckedAt)]]),
    detailSection("Evidence", [["Accepted claims", provider.approvedClaims], ["Rejected claims", provider.rejectedClaims], ["Stale claims", provider.staleClaims]]),
    detailSection("Provider", [["Record ID", provider.providerId], ["Name", provider.name], ["Clinician", provider.clinicianName], ["Practice", provider.practiceName]]),
    detailSection("Location", [["City", provider.city], ["Region", provider.region]])
  );
  elements.providerDetail.replaceChildren(header, reasonSection, grid, conflictSection, renderTimeline(provider));
}

function renderCoverage() {
  const rows = (state.data.regionalCoverage || []).map((region) => {
    const row = document.createElement("tr");
    row.append(
      create("th", "", region.region),
      create("td", "", region.localDirectProviders),
      create("td", "", text(region.localTypes)),
      create("td", "", `${region.directoryFallbacks} directory · ${region.nationalFallbacks} national`),
      create("td", region.deadEnd ? "danger-text" : "good-text", region.deadEnd ? "Dead end" : "Covered")
    );
    return row;
  });
  elements.regionalCoverage.replaceChildren(...rows);
}

function eventItem(title, detail, meta, url = "") {
  const item = create("article", "event-item");
  item.append(create("strong", "", title), create("p", "", detail), create("span", "event-meta", meta));
  const link = safeExternalLink(url, "Open source");
  if (link) item.append(link);
  return item;
}

function renderEvents() {
  const failures = [...(state.data.blockedSources || []), ...(state.data.fetchErrors || [])];
  elements.sourceFailures.replaceChildren(...failures.slice(0, 40).map((item) => eventItem(
    item.domain || "Source",
    item.reason || item.error || "Fetch failed",
    item.status ? `HTTP ${item.status}` : "No response",
    item.url
  )));
  if (!failures.length) elements.sourceFailures.append(create("p", "empty-inline", "No blocked or failed sources in the latest run."));

  const discovered = state.data.searchSources || [];
  elements.searchSources.replaceChildren(...discovered.slice(0, 60).map((item) => eventItem(
    item.title || sourceLabel(item.url),
    "Discovery lead only; the fetched page must independently pass identity and field evidence rules.",
    `${item.sourceType || "search result"} · ${item.providerId || "provider not recorded"}`,
    item.url
  )));
  if (!discovered.length) elements.searchSources.append(create("p", "empty-inline", "No search discovery was requested in the latest run."));

  const changes = [...(state.data.suppressions || []).map((item) => ({ ...item, kind: "Suppression" })), ...(state.data.automaticChanges || []).map((item) => ({ ...item, kind: "Update" }))];
  elements.automaticChanges.replaceChildren(...changes.slice(0, 40).map((item) => eventItem(item.providerName, item.reason || "Automated field update", `${item.kind} · ${item.providerId}`)));
  if (!changes.length) elements.automaticChanges.append(create("p", "empty-inline", "No automatic data changes in the latest shadow projection."));

  const history = [...(state.data.rollbackHistory || []), ...(state.data.runHistory || [])]
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, 40);
  elements.runHistory.replaceChildren(...history.map((item) => eventItem(
    item.action === "rollback" ? `Rollback · ${item.providerName}` : `${item.mode || "run"} · ${item.runId}`,
    item.reason || (item.clean ? "Clean run" : "Run did not pass every gate"),
    dateTime(item.generatedAt)
  )));
  if (!history.length) elements.runHistory.append(create("p", "empty-inline", "No run history recorded yet."));
}

async function loadData() {
  elements.refreshData.disabled = true;
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    populateSelect(elements.stateFilter, state.data.providers.map((provider) => provider.status));
    populateSelect(elements.typeFilter, state.data.providers.map((provider) => provider.type));
    populateSelect(elements.regionFilter, state.data.providers.map((provider) => provider.region));
    populateSelect(elements.fetchFilter, state.data.providers.map((provider) => provider.fetchOutcome));
    renderOverview();
    applyFilters();
    renderCoverage();
    renderEvents();
    if (state.selectedId) selectProvider(state.selectedId);
  } catch (error) {
    elements.runBanner.className = "run-banner run-blocked";
    elements.runBanner.replaceChildren(create("strong", "", "Validation data could not be loaded"), create("span", "", `${error.message}. Run npm run verify:providers:report and serve the repository root.`));
  } finally {
    elements.refreshData.disabled = false;
  }
}

for (const input of [elements.providerSearch, elements.stateFilter, elements.typeFilter, elements.regionFilter, elements.fetchFilter]) {
  input.addEventListener(input.tagName === "INPUT" ? "input" : "change", applyFilters);
}
elements.refreshData.addEventListener("click", loadData);
elements.loadMoreProviders.addEventListener("click", () => {
  state.visibleProviders += PROVIDER_PAGE_SIZE;
  renderProviderList();
});
loadData();
