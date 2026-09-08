# Care Finder Aotearoa

A low-barrier mental health care finder for people in Aotearoa New Zealand.

Development site: [johnfinnerty-nz.github.io/healthcare-finder-nz](https://johnfinnerty-nz.github.io/healthcare-finder-nz/)

Source repository: [johnfinnerty-nz/healthcare-finder-nz](https://github.com/johnfinnerty-nz/healthcare-finder-nz)

Historical source archive: [finnerty.me source archive](https://finnerty.me/git/healthcare-finder-nz.html)

Project case study: [Care Finder Aotearoa Case Study](https://www.johnfinnerty.co.nz/projects/care-finder-aotearoa.html)

John Finnerty profile hub: [finnerty.me](https://finnerty.me/)

## Development Status

Care Finder Aotearoa is currently in development. Provider details can change,
and users should confirm cost, eligibility, availability, and contact details
directly with the service before relying on them.

Report incorrect phone, website, address, eligibility, cost, or availability
information by emailing
[john@johnfinnerty.co.nz](mailto:john@johnfinnerty.co.nz?subject=Care%20Finder%20provider%20correction).

Care Finder Aotearoa helps someone take a first step when they need support but
do not know who to contact or what to say. It combines a guided intake flow,
local provider search, funding guidance, and a concise first-contact message
builder.

This project was built by [John Finnerty](https://johnfinnerty.co.nz), a
software developer based in Christchurch, New Zealand.

## Safety

This is not an emergency service or a replacement for clinical care.

If someone is unsafe right now, call **111**. If they can stay safe but need to
talk now, free call or text **1737** any time, 24/7.

The public trust pages are:

- [Privacy](privacy.html)
- [Terms and disclaimer](terms.html)
- [Data sources and corrections](data-sources.html)
- [Crisis guidance](crisis.html)

## What It Does

- Guides people through age, street address or suburb, gender, support preferences, concerns, and
  barriers to care.
- Includes NZ-only address autocomplete with a local fallback for common towns
  and suburbs.
- Uses the street address or suburb to weight nearby providers.
- Shows a care path only after the guide questions are complete.
- Recommends three first-contact options based on nearby providers, need, support
  preference, barriers, and provider fit.
- Helps users find providers by address/suburb match, support need, cost barrier, and contact
  type.
- Prioritises direct-contact providers over directory-only results.
- Generates a short, editable first-contact message.
- Provides working `mailto:` and `tel:` actions where provider contact details
  are available.
- Includes NZ funding pathways such as WINZ counselling support, Access and
  Choice, and ACC Sensitive Claims.
- Keeps user answers in the browser instead of requiring an account.

## Why This Exists

Finding mental health support can be hard when someone is overwhelmed, worried
about cost, unsure what kind of provider fits, or unable to explain what is
happening. This project tries to make the first contact smaller, clearer, and
less intimidating.

It is a navigation aid, not a diagnosis, emergency service, or replacement for
professional care.

## Project Structure

```text
index.html             Static app shell and content
styles.css             Visual design and responsive layout
script.js              Guided flow, provider matching, and message builder
providers.json         Local provider and directory data
data/provider-validation/provider-canonical.json
                       Internal provider, practice, clinician, and validation state
data/provider-validation/control-room.json
                       Read-only operational projection for the validation console
provider-sources.json  Refresh source manifest
PROVIDER_SOURCE_FIT_AUDIT.md
                       Latest audit of provider tags against source evidence
AVAILABILITY_RECHECK_REPORT.md
                       Latest provider availability freshness audit
data/imports/          Approved source exports, not usually committed
data/monitors/         Watchlists for promising providers not currently available
data/registers/        Backend-only professional register outputs
data/reports/          Refresh and audit reports
PROVIDER_DATABASE.md   Data rules, fields, and import notes
tools/                 Data import and quality utilities
```

## Local Development

This is a static site. From the project folder, run:

```sh
python -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

## Website Deployment

The `Deploy Care Finder website` workflow validates and publishes pushes to
`main` using GitHub Pages. Repository Settings > Pages must use GitHub Actions
as the publishing source. No custom domain or paid hosting is required.

`npm run build` prepares the public HTML, CSS, JavaScript, provider listing,
and assets in `outputs/github-pages/`. The admin console, internal evidence,
review queues, reports, and local tools are not part of the website artifact;
they remain available in the source repository and local checkout.

The source archive and case study on `finnerty.me` are separate from this
GitHub Pages deployment. Website deployment does not refresh provider data
or enable autonomous provider publication.

## Autonomous Provider Validation

Provider verification is shadow-first and evidence-driven. The autonomous
engine crawls relevant public professional pages within robots, rate, redirect,
content, and private-address limits; extracts field-level claims; independently
verifies exact source excerpts; and produces a reversible public projection.

Run an incremental shadow pass:

```sh
npm run verify:providers:shadow
```

Regenerate the read-only control-room report from current state:

```sh
npm run verify:providers:report
```

Serve the repository and open
`http://127.0.0.1:4173/admin/index.html` to inspect run health, evidence,
blocked sources, suppressions, regional gaps, and rollback history. The browser
has no write path.

`npm run verify:providers:publish` is deliberately difficult to satisfy. It
requires API-backed model verification, three clean runs at the current
rollout stage, at least 99.5% precision on the versioned claim fixture, no
unexplained conflicts or regional dead ends, no page-fanout violation, no more
than 2% material provider changes, and successful post-publish checks. A
credential-less run can never publish.

Once a provider leaves legacy monitoring, the public projection retains only
evidence-approved contact, location, scope, specialty, patient-group, age,
gender, telehealth, availability, cost, and support-preference fields. Old
descriptive or ranking-sensitive values are replaced with neutral contact
guidance rather than surviving by default. A direct record without a complete
identity, professional role, location, and safe contact path is omitted.

Full discovery can also consume
`data/discovery/google-places-provider-candidates.json`. A Places match supplies
only a candidate practice website to crawl; Places text never proves clinical
scope, availability, referrals, or cultural support.

See [AUTONOMOUS_PROVIDER_VALIDATION.md](AUTONOMOUS_PROVIDER_VALIDATION.md) for
the complete architecture, claim rules, source trust model, rollout, automation,
and rollback procedure.

## Provider Data

Canonical provider records live in
`data/provider-validation/provider-canonical.json`. `providers.json` remains
the static public projection consumed by the finder. Until a record completes
autonomous validation, its legacy safeguards remain active; a shadow run never
changes the public projection.

`npm run canonical:providers` safely refreshes this internal dataset without
replacing retained claims or reintroducing previously suppressed records. A
destructive rebuild requires the explicit migration-only `--force-rebuild`
flag; do not use it in scheduled validation.

### Local Codex validation without API credit

When no unattended API credential is available, Codex can process conservative
review batches directly in the local repository. Run `npm run codex:batch` to
lease the next three non-GP providers, record exact source evidence in
`data/provider-validation/codex-review-decisions.json`, and run
`npm run codex:verify-evidence` before the controlled dry-run/apply workflow.
Use `npm run codex:progress` after each outcome.

This no-key lane can correct explicit public contact/location data, remove
unsupported positive claims, strengthen referral restrictions, move explicitly
unavailable providers to the watchlist, or defer uncertainty. Code-level guards
prohibit new providers, accepting status, psychiatry self-referral, new cultural
or telehealth tags, new condition scope, new advertised specialties, and direct
publication metadata. Full operating instructions are in
`CODEX_AUTONOMOUS_VALIDATION.md`.

The database is intended to contain current, public, professional contact
details only. Direct care records should include at least one usable contact
method such as phone, email, text, or an official website/contact page.
Provider coordinates can be stored as `lat` and `lon` for distance ranking.
Each provider should also have `confidence`, `sourceQuality`, `lastVerified`,
`needsManualVerification`, `needScope`, `availabilityStatus`,
`availabilityCheckedAt`, `availabilitySource`, and
`availabilityNeedsManualReview` so launch risk, narrow-service scope, and
availability freshness are visible. Psychiatry records also carry
`requiresReferral`, `referralType`, `referralSourceUrl`,
`referralSourceExcerpt`, `referralConfidence`, `referralLastChecked`, and
`referralNeedsManualReview` so GP-referral pathways are not presented as simple
direct-contact steps.

Address lookup for users is done in the browser and is only used to rank nearby
providers. If a user chooses address lookup, the address text is sent to the
OpenStreetMap Nominatim geocoding service.

See `PROVIDER_DATABASE.md` for field definitions, source guidance, and import
rules.
See `DATA_QUALITY.md` for the verification checklist and public-data safety
rules.
Legacy manual review packs remain available as diagnostic exports, but they are
not the primary production path. Blocked or private sources fail closed rather
than being bypassed.

## Data Quality Tools

Refresh the database from approved exports and live opt-in sources:

```sh
node tools/refresh-provider-database.mjs
```

The refresh pipeline reads `provider-sources.json`, imports any approved GP,
FHIR, direct-care, MCNZ, Psychologists Board, and NZCCP source files that are
present, refreshes opt-in RANZCP psychiatrists, geocodes public provider
addresses, imports the curated gap-verified provider set, and writes a report to
`data/reports/provider-refresh-report.json`.
The GitHub Actions workflow `.github/workflows/provider-data-audit.yml` runs the
deterministic checks on pull requests, then runs the live refresh/recheck steps
weekly or by manual dispatch. It refreshes DoctorPricer GP clinic listings at a
conservative rate and can use `HEALTHPOINT_API_URL` / `HEALTHPOINT_API_TOKEN`
repository secrets if approved API access is granted.

Refresh the GP clinic database from DoctorPricer directly:

```sh
node tools/import-doctorpricer-gps.mjs providers.json --rate-limit-ms 5000
```

That importer queries regional seed points, dedupes clinics, filters obvious
urgent-care / student-only / non-GP records, and stores actual GP practices with
phone, website, address, and coordinates where available. Healthpoint-approved
FHIR or HPI access should still be treated as the preferred official long-term
source when it becomes available.

Export a focused queue for GP records that still depend on third-party or
DoctorPricer discovery and need stronger practice-owned or official
corroboration:

```sh
npm run export:gp-corroboration
```

This writes `data/gp-source-corroboration-queue.json`,
`data/gp-source-corroboration-queue.csv`, and
`GP_SOURCE_CORROBORATION_QUEUE.md`. The queue is review-only: it suggests
practice/Healthpoint/PHO/HPI/FHIR checks, rejects search snippets or
DoctorPricer alone as evidence, and does not update `providers.json`.

After Google Places or source-enrichment runs, export a ranked GP review pack:

```sh
npm run export:gp-review-pack
```

To let the pack fetch a small number of public Healthpoint/practice pages and
prefill short reviewer excerpts, run a bounded source-capture batch:

```sh
npm run export:gp-review-pack -- --fetch-sources --max-source-fetches 10 --rate-limit-ms 1000
```

This writes `data/gp-corroboration-review-pack.json`,
`data/gp-corroboration-review-pack.csv`, and
`GP_CORROBORATION_REVIEW_PACK.md`. It matches GP source-corroboration tasks to
Places/Healthpoint/practice-site leads, separates ready source-capture items
from conflicts and source-lookup gaps, and pre-fills draft contact fields for
the auditor. It is still review-only: a human must open the source, capture a
short excerpt or confirm the prefilled excerpt, and apply changes through
reviewed decision JSON. Automated source snippets are review aids only; they do
not prove availability, enrolment, mental-health scope, cultural support,
funding, or accepting-new-patients status.

After a human checks captured GP review-pack rows, draft controlled contact-only
decisions:

```sh
npm run draft:gp-corroboration -- --confirmed-human-review --reviewer "Your name" --notes "Checked source; public contact/source fields match."
```

This writes `data/gp-corroboration-decision-draft.json` and
`GP_CORROBORATION_DECISION_DRAFT.md`. It can only draft public contact/source
updates such as `website`, `source`, and `sourceQuality`; it cannot approve
availability, enrolment status, mental-health scope, cultural support, funding,
or referral claims.

For address and distance-ranking work, export the location/distance review
pack:

```sh
npm run export:location-review-pack
```

This writes `data/location-distance-review-pack.json`,
`data/location-distance-review-pack.csv`, and
`LOCATION_DISTANCE_REVIEW_PACK.md`. It compresses missing-address,
missing-coordinate, and Google Places coordinate-gap tasks into provider-level
batches. It pre-fills only location metadata such as `address`, `lat`, `lon`,
`coordinateSource`, `coordinatePrecision`, `coordinateConfidence`, and
`geocodeNeedsManualReview`; it does not approve provider type, clinical scope,
availability, referral pathway, cost, telehealth, or support-preference tags.

After a reviewer confirms the same public provider or clinic location, draft
controlled location-only decisions:

```sh
npm run draft:location-distance -- --batch-key "location-review:coordinate_gap_candidate:ready_for_location_review:strong_match:psychologist" --confirmed-human-review --reviewer "Your name" --notes "Checked Maps and provider source; location fields match."
```

This writes `data/location-distance-decision-draft.json` and
`LOCATION_DISTANCE_DECISION_DRAFT.md`. Use `--decision needs_more_info` for
unclear buildings, old addresses, similarly named services, or anything that
needs browser/phone review before distance ranking changes.

Export source-fit evidence capture for unsupported tag, support-preference, or
telehealth findings:

```sh
npm run export:source-fit-capture -- --limit 30 --rate-limit-ms 1000
```

For repeated bounded passes, skip rows already captured and keep the earlier
review items in the output:

```sh
npm run export:source-fit-capture -- --limit 30 --skip-existing --merge-existing --rate-limit-ms 1000
```

This writes `data/provider-source-fit-evidence-capture.json`,
`data/provider-source-fit-evidence-capture.csv`, and
`PROVIDER_SOURCE_FIT_EVIDENCE_CAPTURE.md`. It fetches a bounded set of public
source pages, captures short excerpts when a flagged claim is supported, and
creates review-gated safe-removal candidates when a reachable source does not
support a broad/sensitive tag or telehealth flag. It never updates live provider
data; the auditor must confirm excerpts or corrections before `apply:review`.
`--skip-existing` prevents re-fetching the same provider/rule/target row, while
`--merge-existing` preserves previous excerpts and appends the new batch.
For Māori, Pasifika, Asian, and Rainbow support-preference rows, public identity
cues push the item to human browser review instead of a safe-removal candidate
when automated capture cannot find explicit wording.
Each capture item also has a batch key in the form
`source-fit:<status>:<rule>:<target>`, so auditors can filter repeated issues
such as safe-removal candidates for unsupported depression tags without mixing
them with unrelated claims.
The report also shows eligible capture coverage so reviewers can see how many
source-fit findings this capture tool can handle and how many remain unchecked.

Export regional review priorities:

```sh
npm run export:regional-quality
```

This writes `data/regional-data-quality-report.json` and
`REGIONAL_DATA_QUALITY_REPORT.md`. It combines local provider coverage, weak GP
source tasks, source-fit findings, availability/referral/watchlist signals, and
address or coordinate gaps into region-by-region actions. The report is
triage-only and never updates live provider data.

Discover likely provider/business candidates from Google Places:

```sh
npm run discover:places -- --no-network
```

With an approved local API key, run a small bounded batch:

```sh
npm run discover:places -- --api-key-file "path/to/google-places-api-key.txt" --region Northland --type psychologist --limit-queries 2 --max-results-per-query 5
```

This writes `data/discovery/google-places-provider-candidates.json`,
`data/discovery/google-places-provider-candidates.csv`, and
`GOOGLE_PLACES_PROVIDER_CANDIDATES.md`. The API key is read locally and is not
stored in outputs. Google Places is used only as discovery/corroboration: it can
suggest likely practices, phone numbers, websites, and addresses, but it is not
enough by itself to publish clinical scope, availability, referral pathway,
telehealth, cost, or cultural/support-preference claims. Candidates feed the
auditor queue and still require stronger source evidence before live data
changes.

For repeat targeted runs, add `--merge-existing` so new Places leads are merged
into the current candidate file instead of replacing earlier candidates.

To use Places as a review-gated helper for weak GP source records, run a small
batch from the GP corroboration queue:

```sh
npm run discover:places -- --gp-corroboration-queue data/gp-source-corroboration-queue.json --region Northland --limit-queries 5 --max-results-per-query 3 --merge-existing
```

This creates exact-practice Places candidates tied back to the queued GP
provider IDs. They still need practice-owned, Healthpoint, PHO/HPI/FHIR, or
other stronger evidence before any provider row is updated.

To use Places as a review-gated helper for known providers with public addresses
but missing coordinates:

```sh
npm run discover:places -- --coordinate-gap-providers --limit-queries 24 --max-results-per-query 3 --merge-existing
```

This mode skips vague locality-only addresses by default and ties candidates
back to the target provider ID for auditor review. It must not be used to write
coordinates directly into `providers.json` without a reviewed decision.

Places candidates are also included in `npm run discover:seeds`, so the normal
evidence pipeline can use their provider-owned websites as review-gated
corroboration leads. To fetch only known seed websites, without search-engine
API calls, use a small bounded run:

```sh
npm run discover:enrich -- --fetch-seed-sources --max-seed-sources 10 --limit 10
```

This skips Google Maps/search/social URLs, respects source blocks, and still
only writes candidates and evidence for review.

Import backend-only doctor register data after approved MCNZ access:

```sh
node tools/import-mcnz-register.mjs data/imports/mcnz-register.csv
```

Import backend-only Psychologists Board verification data:

```sh
node tools/import-psychologists-board-register.mjs data/imports/psychologists-board-register.csv
```

Check provider contact quality:

```sh
npm run validate:data
npm run audit:source-fit
npm run audit:availability
npm run audit:referrals
npm run audit:quality
node tools/audit-support-preferences.mjs
node tools/audit-address-coverage.mjs
```

`tools/audit-provider-source-fit.mjs` compares each record's tags, type,
need scope, telehealth flags, cultural-support tags, and direct-contact status
against the public source fields stored in the record. It writes
`data/provider-source-fit-audit.json` and `PROVIDER_SOURCE_FIT_AUDIT.md`.
Unallowlisted high-severity findings fail CI. Temporary exceptions must be
documented in `data/provider-source-fit-allowlist.json` with a reason,
reviewer, review date, and expiry date.

Run the automated data and simulated workflow tests:

```sh
npm test
```

Audit and cautiously recheck provider availability:

```sh
node tools/find-unavailable-providers.mjs
node tools/audit-availability-watchlist.mjs
node tools/audit-provider-availability.mjs
node tools/recheck-provider-availability.mjs
npm run export:monitor
```

The watchlist lives at `data/monitors/provider-availability-watchlist.json`.
These records are not shown as live first-contact options until their page stops
matching unavailable wording and is manually reviewed. The availability audit
writes `data/provider-availability-audit.json` and
`AVAILABILITY_RECHECK_REPORT.md`. The cautious live recheck writes
`data/provider-availability-recheck-results.json`; it does not overwrite
provider records. `npm run export:monitor` turns those automated findings into
`data/provider-monitor-queue.json`, `data/provider-monitor-queue.csv`, and
`PROVIDER_MONITOR_QUEUE.md` so an auditor can review changes in the same console.

Availability statuses are intentionally conservative:

- `accepting` needs explicit source evidence and gets only a small ranking boost.
- `unknown` and `not_published` stay eligible but show confirm-availability wording.
- `waitlist` is ranked lower.
- `not_accepting` and `referrals_paused` are kept out of the first three care
  cards unless there are no alternatives, and are labelled clearly.

Audit psychiatrist referral pathways:

```sh
npm run audit:referrals
```

Private psychiatrist records should not be treated as simple direct-contact
steps when the source says a referral is needed. RANZCP Your Health in Mind
records are marked GP-referral-first. Unknown referral status stays visible, but
the UI tells users to check with the GP/provider before investing energy in a
direct enquiry.

Geocode public provider addresses for distance ranking:

```sh
node tools/geocode-provider-addresses.mjs
```

Provider importers geocode newly added or updated records automatically when a
public physical address is present and `lat` / `lon` are missing. Add
`--no-geocode` to an import command when running offline or when an import source
must not be sent to OpenStreetMap Nominatim.
Nominatim geocodes are now accepted only when the returned coordinates sit
inside a broad New Zealand coordinate range. Accepted geocodes are marked with
`coordinateSource`, `coordinatePrecision`, `coordinateConfidence`, and
`geocodeNeedsManualReview: true` so distance ranking can use them without
pretending the address has been manually verified.
The geocoder tries conservative fallback queries for specific public addresses,
but skips vague locality-only entries such as `Timaru`, `Blenheim`, or
`Various venues` so city-centre coordinates are not mistaken for a real clinic
point.

Backfill coordinate metadata for older records that already have coordinates:

```sh
npm run backfill:coordinate-metadata
```

This does not verify addresses. It records the known coordinate source where it
can be inferred, marks weak/unknown coordinate sources honestly, and keeps
manual review required.
When a user has entered a resolved address/suburb, normal in-person GP,
counsellor, psychologist, psychiatrist, and men's-centre matches are capped at
30 km. Confirmed telehealth, national services, helplines, directories, and
public regional pathways can still appear with clear wording.

Import approved counsellor, psychologist, or psychiatrist contacts from CSV:

```sh
node tools/import-care-providers.mjs path/to/care-providers.csv
```

Import opt-in psychiatrist listings from RANZCP Your Health in Mind:

```sh
node tools/import-ranzcp-psychiatrists.mjs
```

Refresh TalkingPoint public psychology practice listings:

```sh
node tools/import-talkingpoint.mjs
```

Refresh Mindwell online psychologist profiles:

```sh
node tools/import-mindwell-psychologists.mjs
```

Refresh the curated Google/Bing/Chrome gap-fill records and availability
watchlist:

```sh
node tools/import-gap-verified-providers.mjs
```

Build a repeatable provider-discovery queue from the Wikipedia populated-places
table. The default run writes every populated place plus Google/Bing search URLs
for GP/doctors, psychologists, psychiatrists, and counsellor/therapist searches
across the first 3 result pages:

```sh
npm run discover:providers
```

Narrow a manual pass to one place:

```sh
node tools/build-provider-discovery-queue.mjs --place Whangarei
```

The script generates search queues by default rather than scraping search-result
HTML, which is unreliable and often blocked. To collect search results through
approved APIs, set `GOOGLE_API_KEY` plus `GOOGLE_CSE_ID` and/or
`BING_WEB_SEARCH_KEY`, then run:

```sh
node tools/build-provider-discovery-queue.mjs --run-searches --limit-searches 100
```

Prepare a psychologist verification and public-contact research queue from an
exported New Zealand Psychologists Board register search:

```sh
node tools/prepare-psychologists-board-research.mjs path/to/psychologists-board-register.csv
```

Import approved FHIR provider bundles:

```sh
node tools/import-provider-fhir.mjs path/to/provider-bundle.json
node tools/import-practitioner-roles-fhir.mjs path/to/provider-bundle.json
```

Fetch an approved Healthpoint FHIR API/export endpoint, then import it:

```sh
HEALTHPOINT_API_URL="<approved-healthpoint-fhir-endpoint>" \
HEALTHPOINT_API_TOKEN="token-if-issued" \
node tools/fetch-healthpoint-fhir.mjs healthpoint-provider-bundle.json

node tools/import-provider-fhir.mjs healthpoint-provider-bundle.json
```

Check outbound links:

```sh
node tools/check-links.mjs
```

Some health and government sites may block automated link checks with `403`.
Those should be reviewed separately from genuinely broken links.
By default the checker samples generated DoctorPricer GP links so CI does not
hammer hundreds of practice websites. It checks provider websites that users can
open from the app; add `CHECK_PROVIDER_SOURCES=true` when you also want to test
backend verification source URLs. Run this for a full provider website audit:

```sh
CHECK_PROVIDER_LINKS=full node tools/check-links.mjs
```

Set `PROVIDER_LINK_LIMIT=300` to widen the sample.
Set `LINK_CHECK_USER_AGENT`, `LINK_CHECK_RETRIES`, or
`LINK_CHECK_CONCURRENCY` when a manual audit needs a slower or site-specific
check. The default user agent is intentionally browser-like and does not
identify itself as a link checker, because some healthcare directories block
that wording before returning a useful status.

## Provider Discovery And Enrichment

Discovery tooling is deliberately separate from the live finder. It can find,
enrich, and suggest provider records, but weak or risky data still goes through
the auditor queue before it can affect public recommendations.

Run the repeatable discovery flow:

```sh
npm run discover:seeds
node tools/enrich-provider-candidates.mjs --no-network --limit 20
npm run discover:suggest
npm run export:review
```

`discover:seeds` combines existing provider records, audit findings, review
queue items, thin-region discovery queues, Google Places candidates, and
optional manual seeds into `data/discovery/provider-discovery-seeds.json`.

`discover:enrich` supports iterative "snowball" enrichment. Round 1 builds
searches from city/type/provider names. Later rounds use discovered clinician
names, practice names, public clinic websites, addresses, phone numbers, email
domains, Healthpoint/NZCCP/RANZCP/Psychology Today titles, and public LinkedIn
role signals to generate follow-up searches. Search engines are used only via
official Google Custom Search or Bing Web Search APIs when keys are configured:

```sh
GOOGLE_API_KEY=... GOOGLE_CSE_ID=... npm run discover:enrich -- --use-google-api
BING_WEB_SEARCH_KEY=... npm run discover:enrich -- --use-bing-api
```

Without API keys, or with `--no-network`, the tool writes queues and candidate
evidence from existing seeds instead of scraping search result HTML. It does not
bypass blocked sites, login-only pages, CAPTCHA pages, LinkedIn restrictions, or
source-site embedding restrictions.

For already-known source URLs, such as provider websites found by Google Places,
`discover:enrich` can fetch a capped number of seed websites without using a
search API:

```sh
npm run discover:enrich -- --fetch-seed-sources --max-seed-sources 10 --limit 10
```

Seed-source fetching skips Google Maps, search engines, social networks, and
unsupported file types. It is only used to capture reviewable excerpts and field
evidence; it never writes directly to `providers.json`.

`discover:places` is a separate Google Places discovery aid. It reads regional
priority gaps, uses the official Places Text Search API when a local key is
provided, dedupes likely businesses against existing providers, and writes
review-gated candidates. Places results are useful for finding possible clinic
names, phone numbers, websites, addresses, and coordinates; they are not enough
to publish clinical scope, availability, referral, cost, telehealth, or
support-preference claims.

Places records keep `queryType` separate from confirmed provider `type`. A
psychiatrist search can discover useful leads, but the tool should only label a
lead as a psychiatrist when the result itself, an existing provider match, or a
stronger source supports that type. Ambiguous psychology, counselling, or generic
health results remain `unknown` for auditor review.

Outputs:

- `data/discovery/provider-candidates.json`
- `data/discovery/provider-evidence-graph.json`
- `data/discovery/provider-discovery-report.md`
- `PROVIDER_DISCOVERY_REPORT.md`
- `data/discovery/provider-suggestions.json`
- `data/discovery/provider-suggestions.csv`
- `PROVIDER_DISCOVERY_SUGGESTIONS.md`
- `data/discovery/google-places-provider-candidates.json`
- `data/discovery/google-places-provider-candidates.csv`
- `GOOGLE_PLACES_PROVIDER_CANDIDATES.md`

LinkedIn is treated as corroboration only. A public LinkedIn snippet may help
identify a clinician's current role, clinic name, city, or clinic website to
search next. It must not be the sole source for specialty, availability,
referral pathway, cultural support, or public contact claims.

Provider-owned or clinic-owned pages, Healthpoint, official registers,
professional directories, PHO/NGO pages, and public clinic websites carry more
weight. Every extracted claim keeps `sourceUrl`, `sourceType`, `excerpt`,
`confidence`, `capturedAt`, and `needsManualReview`.

Suggestions are review-gated:

- search-result snippets alone cannot create live providers
- LinkedIn-only candidates stay manual research
- conflicting addresses or contact values stay manual research
- `accepting` availability requires explicit source wording
- psychiatrist `self` referral requires explicit source wording
- cultural, telehealth, and broad need/specialty tags require evidence or
  reviewer approval

## Provider Review Workflow

Provider data changes should go through a review queue rather than direct edits
where practical:

```sh
npm run export:review
```

For field-level claim review and queue compression, run:

```sh
npm run evidence:graph
npm run evidence:score
npm run evidence:conflicts
npm run export:claims
npm run export:gp-corroboration
npm run export:location-review-pack
npm run export:source-fit-capture -- --limit 30 --skip-existing --merge-existing
npm run export:auto-resolution
npm run draft:claim-batch -- --batch-key "<batch key>" --decision needs_more_info
npm run draft:source-fit-capture -- --confirmed-human-review --reviewer "Your name" --notes "Checked source; unsupported claims should be removed."
npm run draft:gp-corroboration -- --confirmed-human-review --reviewer "Your name" --notes "Checked source; public contact/source fields match."
npm run draft:location-distance -- --decision needs_more_info --issue-type missing_address --reviewer "Your name" --notes "Needs a public professional address source."
```

This writes:

- `data/provider-evidence-graph.json`
- `data/provider-claims.json`
- `data/provider-claim-scores.json`
- `data/provider-conflicts.json`
- `data/provider-claim-review-queue.json`
- `data/provider-claim-review-queue.csv`
- `data/gp-source-corroboration-queue.json`
- `data/gp-source-corroboration-queue.csv`
- `data/location-distance-review-pack.json`
- `data/location-distance-review-pack.csv`
- `data/provider-auto-resolution-proposals.json`
- `data/provider-auto-resolution-proposals.csv`
- `PROVIDER_EVIDENCE_GRAPH.md`
- `PROVIDER_CLAIM_REVIEW_QUEUE.md`
- `GP_SOURCE_CORROBORATION_QUEUE.md`
- `LOCATION_DISTANCE_REVIEW_PACK.md`
- `PROVIDER_CONFLICTS.md`
- `PROVIDER_AUTO_RESOLUTION_PROPOSALS.md`

The claim tools are advisory only. They split provider rows into small claims
such as public phone, website, address, availability, referral pathway, support
tags, and telehealth. Low-risk public contact/identity/location claims can be
marked `auto_accept` in the graph, but the tooling does not mutate
`providers.json`. High-risk claims stay review-gated.
`export:auto-resolution` turns the graph and claim queue into explicit
auto-deprioritization proposals for low-risk claim-review noise, plus manual
batch tasks for everything still needing judgement. It does not approve or
apply provider data changes.

The local auditor console can load `data/provider-auto-resolution-proposals.json`
from the queue selector as **Auto-resolution proposals**. This is a reviewer
planning view only: it helps hide/collapse low-risk checks and keep high-risk
claim batches visible, but provider data still changes only through exported
review decisions and the controlled apply script.

The same console can load `data/gp-source-corroboration-queue.json` as
**GP source corroboration**. Use it to confirm weak third-party GP records
against practice-owned, Healthpoint, PHO, HPI/FHIR, or official sources. It is a
review surface only and must not be used to infer availability, enrolment,
specialty, cultural support, or funding eligibility.

The console can also load `data/gp-corroboration-review-pack.json` as
**GP corroboration review pack**. This is a narrower review surface for the GP
records most likely to have a usable Healthpoint or practice-site lead. It
pre-fills only draft public contact/source fields. If the pack was exported
with `--fetch-sources`, it may also pre-fill a short source excerpt for the
auditor to check. It still requires human confirmation before any adjustment is
exported. Use the **Source capture** filter in the auditor to separate captured
snippets from blocked, failed, skipped, or not-yet-fetched source checks.

The console can load `data/location-distance-review-pack.json` as
**Location/distance review pack**. This is the focused queue for
missing-address, missing-coordinate, and coordinate-gap work. It groups rows by
`location-review:<issue>:<priority>:<match-strength>:<type>` and pre-fills only
location metadata. A reviewer must confirm the same provider or public clinic
location before exporting `draft:location-distance` decisions.

For triage, the console has a conservative filtered-batch helper. After a queue
is narrowed by batch, rule, category, search, region, type, severity,
availability, or referral status, it can save `needs_more_info` decisions for
unsaved filtered items only. It does not overwrite existing decisions and it is
not a bulk approve or bulk adjust path.

`draft:claim-batch` is a draft helper for a reviewed batch. It reads the claim
queue and writes `data/provider-claim-batch-decision-draft.json` plus
`PROVIDER_CLAIM_BATCH_DECISION_DRAFT.md`. It never edits `providers.json`.
Adjustment drafts for high-risk batches require `--confirmed-human-review`, a
reviewer, and source excerpt or notes, and currently only support removing
values from array fields such as `tags`, `needScope`, and `specialties`.

`draft:source-fit-capture` is the matching helper for
`data/provider-source-fit-evidence-capture.json`. Use it only after checking the
captured source-fit rows. It groups safe-removal candidates by provider before
drafting `adjust` decisions, so removing several unsupported tags from one
provider cannot accidentally re-add another removed tag. The helper only
removes array values or turns unsupported telehealth booleans off; it cannot add
provider capabilities.

`draft:gp-corroboration` is the matching helper for
`data/gp-corroboration-review-pack.json`. Use it only after checking captured GP
source snippets. Adjustment drafts require `--confirmed-human-review` and a
reviewer, and only update public contact/source fields. Use
`--decision needs_more_info --status failed` for failed source captures that
need browser review without changing provider data.

`draft:location-distance` is the matching helper for
`data/location-distance-review-pack.json`. Use it only after confirming a public
provider address or coordinate source. Adjustment drafts require
`--confirmed-human-review` and a reviewer, and only update address/coordinate
metadata. Use `--decision needs_more_info` for unclear buildings, stale
addresses, shared facilities, or vague locality-only records.

This writes:

- `data/provider-review-queue.json`
- `data/provider-review-queue.csv`
- `PROVIDER_REVIEW_QUEUE.md`

The export merges `providers.json`, source-fit findings, availability findings,
psychiatrist referral findings, address/geocode checks, the availability
watchlist, optional identity/link reports, and discovery suggestions. By default
it is a focused queue and does not include every low-risk GP record. Use
`node tools/export-provider-review-queue.mjs --include-all` for a full dump.

The queue exporters remain useful for diagnostics and migration, but the
primary `admin/index.html` is now a read-only Provider Validation Control Room.
It loads `data/provider-validation/control-room.json` and shows automated run
health, evidence timelines, conflicts, blocked sources, suppressions, rollback
history, and regional gaps. It contains no decision form or write capability.

For future checks after the initial audit, run:

```sh
npm run monitor:providers
```

That legacy command cautiously fetches provider/watchlist source pages, reruns
the availability audit, and exports a monitor queue. The autonomous validation
engine supersedes it for production decisions and requires exact evidence,
independent model verification, deterministic policy, rollout gates, and a
pull request before public data changes.

### Legacy Review Drafts

`npm run review:ai` and the manual decision-application scripts are retained for
historical audit packs and debugging. They are not the production validation
path and cannot satisfy the autonomous publish gates. New validation work should
use `npm run verify:providers:shadow`; see
`AUTONOMOUS_PROVIDER_VALIDATION.md`.

Place an exported decision file at `data/provider-review-decisions.json`, then
apply it through the controlled script:

```sh
npm run apply:review
```

Decisions are:

- `approve`
- `adjust`
- `reject`
- `move_to_watchlist`
- `duplicate`
- `needs_more_info`

`correctedFields` only accepts an allowlisted set of provider fields. The apply
script rejects unsafe fields and enforces safety rules such as no `accepting`
availability without explicit evidence, no psychiatrist `self` referral without
source evidence, and no directory-to-direct-provider conversion without a direct
provider contact source. Every applied decision appends an event to
`data/provider-review-log.jsonl`.

Reviewed discovery suggestions can add a new provider only through the same
controlled script. The decision must use `approve`, set `newProviderCandidate:
true`, include allowlisted provider fields in `correctedFields`, and include a
human-captured `sourceExcerpt` from a provider-owned, Healthpoint, official, or
professional source. Google Places seed text, search snippets, LinkedIn-only
signals, blocked pages, or silence are not enough to import a provider.

Reviewed GP corroboration rows can be drafted by exact auditor batch key:

```sh
npm run draft:gp-corroboration -- --batch-key "gp-review:ready_for_source_capture:captured:healthpoint_gp_listing" --confirmed-human-review --reviewer "Your name" --notes "Checked captured Healthpoint GP rows; public contact/source fields match."
```

These drafts are contact/source-only. They must not be used to approve
enrolment, availability, mental-health scope, cultural support, funding, or
referral claims.

Reviewed source-fit capture removals should also go through `apply:review`.
Those drafts are conservative downgrades only: removing unsupported tags,
`needScope` values, advertised specialties, or telehealth flags. Do not use them
to approve sensitive tags, advertised specialties, telehealth, availability, or
referral pathways.

When working from the auditor **Batch** filter, pass the same source-fit batch
key to keep the draft narrow:

```sh
npm run draft:source-fit-capture -- --batch-key "source-fit:safe_removal_candidate:broad-tag-without-source-support:depression" --confirmed-human-review --reviewer "Your name" --notes "Checked this batch; unsupported claims should be removed."
```

The helper can also draft `needs_more_info` decisions for non-removal batches
such as `source_support_found`, blocked, skipped, or failed rows. It will not
bulk-approve captured excerpts or add new capability claims.

Resumable source-fit capture runs drop stale merged rows by default when the
underlying audit finding has been fixed. Use `--keep-stale-existing` only for
investigating old capture rows outside the active auditor queue.

After applying decisions, run:

```sh
npm run validate:data
npm run audit:source-fit
npm run audit:availability
npm run audit:referrals
npm run audit:addresses
npm test
```

Source pages should be opened in a new tab from the auditor UI. Iframe previews
are optional and sandboxed because many healthcare sites block embedding. Do not
proxy source websites to bypass their restrictions.

## Provider Source Principles

- Prefer official provider pages, professional body directories, Health NZ,
  Healthpoint-approved data access, NZCCP, NZ Psychological Society, RANZCP, or
  provider-owned exports.
- Do not scrape public directories where terms prohibit automated extraction.
- Do not treat directories as direct first-contact providers.
- Keep MCNZ and Psychologists Board data backend-only unless separate public
  clinic or practice contact details have been verified.
- Do not publish private emails or personal phone numbers unless they are public
  professional contact details.
- Re-verify direct-care listings regularly.

## Disclaimer

This project provides navigation and first-contact support information. It does
not diagnose, triage clinical risk, or guarantee service availability, cost,
eligibility, or suitability.
