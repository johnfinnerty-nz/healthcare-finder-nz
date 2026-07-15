# Data Quality

This project uses `data/provider-validation/provider-canonical.json` as its
internal provider dataset and generates `providers.json` as the static public
first-contact projection for mental health, addiction, youth, GP, psychologist,
psychiatrist, and support services in Aotearoa New Zealand.

The data standard is simple: do not invent services, contacts, eligibility, or
availability. A stressed user should be able to trust that each live result has a
real public contact route and a clear next step.

## Required Fields

Every provider record must include:

- `id`
- `name`
- `type`
- `region`
- `city`
- `cost`
- `tags`
- `specialties`
- `patientGroups`
- `ageGroups`
- `fit`
- `firstStep`
- `source`
- `verified`
- `lastVerified`
- `confidence`
- `sourceQuality`
- `needsManualVerification`
- `needScope`
- `availabilityStatus`
- `availabilityCheckedAt`
- `availabilitySource`
- `availabilityNeedsManualReview`

Psychiatry records must also include:

- `baselineScope`
- `baselineScopeSource`
- `baselineScopeNote`
- `advertisedSpecialties`
- `advertisedSpecialtyEvidence`
- `specialtyTagsSource`
- `requiresReferral`
- `referralType`
- `referralSourceUrl`
- `referralSourceExcerpt`
- `referralConfidence`
- `referralLastChecked`
- `referralNeedsManualReview`

Recommended fields:

- `address`
- `lat` and `lon`
- `phone`
- `text`
- `email`
- `website`
- `bookingUrl`
- `hours`
- `eligibility`
- `crisisOnly`
- `onlineAvailable`
- `phoneSupport`
- `inPerson`

Current schema aliases:

- `source` is the source URL.
- `verified` is the last verified month in `YYYY-MM` format.
- `lastVerified` mirrors the latest known verification/import month and is used
  for launch-readiness checks.
- `sourceQuality` describes the kind of source, such as provider-owned page,
  trusted health directory, official agency page, professional directory, or
  third-party GP listing.
- `coordinateSource` records where stored `lat` / `lon` values came from, such
  as DoctorPricer, Google Places, OpenStreetMap Nominatim, a professional
  directory, or an official provider export. Use `not recorded - needs manual
  review` only when historical coordinates exist but the original coordinate
  source is unknown.
- `coordinatePrecision` should describe how exact the coordinates are, for
  example `business listing`, `address geocode`, `street/locality geocode`,
  `locality geocode`, `professional directory listing`, or `official provider
  export`.
- `coordinateConfidence` is field-level confidence for distance ranking. Use
  `medium` for a public business listing, official export, professional
  directory coordinate, or address-level geocode; use `low` for locality-level
  or unrecorded coordinate sources.
- `geocodeNeedsManualReview` should stay `true` for automated or historical
  coordinates until a reviewer confirms the professional address and coordinate
  source. Do not use geocoding metadata as proof that the provider is available
  or suitable.
- `needsManualVerification` remains a legacy/public caution flag. Autonomous
  production decisions use claim evidence and `verificationStatus`; a record is
  not made trustworthy merely by changing this boolean.
- `needScope` is always present. Use `[]` for broad services, or a narrow list
  such as `["trauma"]`, `["addiction"]`, or `["work"]` when the source only
  supports a limited pathway. This prevents sexual-harm-only, addiction-only,
  and work/rehab-only providers from ranking for unrelated concerns.
- `patientGroups`, `ageGroups`, `specialties`, `services`, and `languages` are
  optional structured source fields. Use them when a directory explicitly
  publishes them, especially for support-preference evidence.
- `tags` currently carry support flags such as `maori`, `pasifika`, `asian`,
  `rainbow`, `trauma-informed`, `telehealth`, `female`, `male`, `cost`,
  `crisis`, `addiction`, `psychiatry-service`, and `direct-contact`.
- `availabilityStatus` must be one of `accepting`, `waitlist`,
  `not_accepting`, `referrals_paused`, `unknown`, or `not_published`.
- `availabilityCheckedAt` is the date or month when availability was last
  checked, in `YYYY-MM-DD` or `YYYY-MM` format.
- `availabilitySource` is the source URL used for the status. This may be the
  same as `source` or `website`.
- `availabilityEvidence` stores the short public phrase that supports an
  explicit status. Do not invent this text.
- `availabilityNeedsManualReview` is `true` when the status is uncertain,
  restrictive, stale, or based on indirect wording.
- `referralType` must be `gp`, `self`, `specialist`, or `unknown` for
  psychiatrist and psychiatry-service records. Use `unknown` when the source is
  unclear; do not infer self-referral from silence.
- `requiresReferral` means the stored source indicates referral is required or
  usually needed. It does not mean every direct contact route is useless; it
  means the UI should guide the user toward a GP/clinician referral first.
- `baselineScope` is only for named psychiatrist records. It is a conservative
  routing aid based on the Medical Council of New Zealand psychiatry vocational
  scope, which describes psychiatry as assessment, diagnosis, and treatment of
  psychological, emotional, or cognitive problems. It must not be displayed as
  an advertised specialty.
- `advertisedSpecialties` contains profile/source-backed interests or
  specialties only. These may appear as "listed interests" in the UI and can
  receive a stronger ranking boost than `baselineScope`.
- `advertisedSpecialtyEvidence` stores the short source evidence for the
  advertised interests. Do not copy broad baseline capability into this field.
- `specialtyTagsSource` explains whether broad tags came from listed
  interests, source-backed service text, or another reviewed source.

## Autonomous Evidence And States

Every autonomous claim retains:

- provider ID and clinician/practice/provider subject
- field and value
- exact source excerpt
- source URL and classified source type
- capture date and page hash
- extractor and extractor version
- confidence and independent verification outcome
- expiry date, subject-match status, practice-wide status, and conflicts

The canonical model keeps practices and clinicians separate. Practice reception
contacts can be reused only through an identity-matched clinician/practice
relationship and evidence that the contact belongs to the practice. Clinician
specialties, availability, gender, cultural support, age groups, and telehealth
never inherit from another clinician or the practice by default.

The canonical dataset is the retained internal source, while `providers.json`
is a generated public projection. Incremental runs must use the current public
file as their baseline so omitted fields and suppressed providers do not
reappear when an unrelated provider is checked. A normal canonical refresh
preserves internal claims and validation history; a destructive rebuild is a
deliberate migration operation only.

Unknown domains are `unknown`; a `.nz` domain or professional-looking name does
not make a source provider-owned. Ownership requires a known-domain signal and
identity match in captured content. Search snippets and LinkedIn are discovery
or corroboration signals only.

Record validation states are:

- `verified`: identity, professional role, location, a public contact route, and
  at least one ranking-relevant claim passed field policy
- `limited`: identity, professional role, location, and a public contact route
  passed, while unsupported ranking fields fail closed
- `monitoring`: the record is awaiting another source/freshness observation
- `suppressed`: explicit restrictive evidence was confirmed and the public
  record is reversibly omitted
- `unverifiable`: safe public evidence could not be established under policy

Unsupported ranking-sensitive and descriptive fields do not survive into the
generated public projection. This includes condition scope, specialties,
cultural preferences, clinician gender, telehealth, availability, cost,
eligibility, and service descriptions. Conservative safety restrictions such
as GP-referral guidance and `crisisOnly` remain until stronger evidence supports
a safe change. A provider without a safe identity, role, location, and contact
core is omitted rather than published with guessed details.

Automatic model extraction uses strict structured output, followed by a
separate skeptical verification call. A third adjudication is allowed only for
high-risk disagreement. The model never writes files, chooses stored source
URLs, or sees finder-user health data. Captured evidence text includes visible
page text and exact `mailto:`, `tel:`, booking-link, and JSON-LD fragments. Any
model excerpt that is not verbatim in that captured evidence is rejected.

See `AUTONOMOUS_PROVIDER_VALIDATION.md` for the full crawler, policy, rollout,
publish-gate, and rollback design.

## Verification Rules

- Prefer official provider pages, Healthpoint-approved data, Health NZ, PHOs,
  professional bodies, NGO-owned pages, or approved exports.
- Use Healthpoint and broad directories as source or website links for a specific
  provider when needed, but do not treat a broad directory as a direct provider.
- A direct provider must have at least one usable public contact route: phone,
  text, email, or official website/contact page.
- Coordinates are routing aids, not verification. Automated geocodes must be
  review-gated, must stay within New Zealand bounds, and must not be used to
  infer availability, direct contact suitability, telehealth, cultural support,
  or clinical scope.
- Do not geocode vague locality-only addresses such as a town name, region
  name, or "various venues" into a precise local point. Either find a public
  professional address, mark the provider as remote/phone/telehealth with
  evidence, or leave coordinates empty for manual review.
- Directory records must be marked `type: "directory"` or tagged `directory`.
  They must not show "Use this contact" in the UI.
- Directory records must not be tagged `direct-contact`. If a navigation phone
  number is retained for human review, it must be allowlisted in the source-fit
  audit and still treated as a directory in the UI.
- Crisis records must be tagged `crisis` and should only appear in crisis or
  fallback contexts, not as routine first-contact recommendations.
- Crisis-only records must be `helpline`, `public-service`, or `directory`
  records, not routine GP, counsellor, psychologist, or psychiatrist records.
- Use `psychiatry-service` for public specialist mental health teams that are a
  valid route to psychiatry or medication-specialist assessment, but are not
  private psychiatrist listings. Keep their `type` as `public-service` or
  `youth` unless the listing is a named psychiatrist or psychiatry practice.
- Psychiatrists are treated differently from psychologists and counsellors
  because they are medical specialists within a vocational scope of psychiatry.
  A psychiatrist record may carry baseline capability metadata for common
  psychiatric presentations such as mood disorders, anxiety disorders, bipolar
  disorder, psychosis, trauma/PTSD, and diagnosis/medication/risk assessment.
  This is for routing only. It is not a claim that the profile advertises those
  conditions as special interests.
- ADHD/neurodevelopmental assessment and substance/addiction comorbidity may be
  added to psychiatrist `baselineScope` when the profile or tags give a specific
  reason to treat that as relevant. Prefer explicit advertised specialties when
  available.
- Psychologist and counsellor records do not get baseline condition scope.
  Depression, anxiety, trauma, addiction, work stress, and cultural/support tags
  still need source evidence through `specialties`, `services`, `fit`,
  `patientGroups`, or reviewed tags.
- Private psychiatrist listings must carry referral metadata. If a profile says
  a GP referral is needed, the main first step should be booking with a GP and
  bringing the psychiatrist details, not emailing the psychiatrist as the main
  action.
- RANZCP Your Health in Mind psychiatrist profile records are GP-referral-first
  unless a newer source gives stronger contrary evidence. Keep the source URL
  and a short referral excerpt on the record.
- The approved `baselineScopeSource` is the Medical Council psychiatry
  vocational scope page:
  `https://www.mcnz.org.nz/registration/scopes-of-practice/vocational-and-provisional-vocational/types-of-vocational-scope/psychiatry/`.
- Use `ageGroups` where a source limits access. The website filters these
  records so child/adolescent-only and older-adult-only services are not shown
  to clearly incompatible ages.
- If a provider page says books are closed, not taking new clients, or not
  accepting referrals, do not promote it as a normal first-contact option. Move
  it to `data/monitors/provider-availability-watchlist.json` where possible, or
  keep it labelled with `availabilityStatus: "not_accepting"` /
  `"referrals_paused"` only when there is a deliberate fallback reason.
- Do not publish private emails, personal mobile numbers, or register addresses
  unless they are clearly public professional contact details.
- Keep MCNZ and Psychologists Board register data backend-only unless a separate
  public practice source confirms the user-facing contact.
- When a resolved user address/suburb is available, in-person local GP,
  counsellor, psychologist, psychiatrist, and men's-centre matches must be
  within 30 km. Region-only matching must not make a Blenheim provider look
  local to Golden Bay. Confirmed telehealth, national services, helplines,
  directories, and public regional pathways may be shown separately or labelled
  clearly.

## Support Preference Tags

Opt-in cultural and safety tags are hidden unless selected:

- `maori`
- `pasifika`
- `asian`
- `rainbow`

Provider gender is stored separately from general support tags where possible:

- `providerGender: "female"`
- `providerGender: "male"`
- optional `providerGenderSource` and `providerGenderEvidence`

Legacy `female` and `male` tags may still exist, but new imports should prefer
`providerGender` so a clinician's gender is not confused with a service focus
such as men's health or women's health. Only use provider-gender metadata when a
public source explicitly supports it. Do not infer ethnicity, culture, gender,
or affirming practice from a provider name alone.

## Availability Freshness Rules

Availability is not the same as link reachability. A provider website can be
online while the provider is full, paused, or waitlisting.

- `accepting` needs explicit public evidence such as "accepting new clients" or
  "currently available"; it must not be guessed from a booking button alone.
- `unknown` and `not_published` are normal for many providers. They stay visible
  with confirm-availability wording.
- `waitlist` stays visible but is ranked lower than unknown/not-published
  providers with similar fit.
- `not_accepting` and `referrals_paused` are excluded from the first care-path
  cards unless there are no alternatives, and they must be labelled clearly.
- Explicit `accepting`, `not_accepting`, and `referrals_paused` evidence is
  rechecked daily. Waitlists are rechecked monthly. Contact, referral, and cost
  claims are quarterly; scope/cultural/telehealth claims are six-monthly; and
  registration/identity claims are annual.
- Stale restrictive evidence cannot be treated as proof that a provider has
  reopened. A new explicit source claim must pass the same independent checks.
- Use `data/provider-availability-allowlist.json` only for short-lived, reviewed
  exceptions. Every item needs `id`, `rule`, `reason`, `reviewedBy`,
  `reviewedDate`, and `expiryDate`.

The availability tools are:

```sh
node tools/audit-provider-availability.mjs
node tools/recheck-provider-availability.mjs
```

The audit writes `data/provider-availability-audit.json` and
`AVAILABILITY_RECHECK_REPORT.md`. The legacy recheck tool writes
`data/provider-availability-recheck-results.json` and never changes
`providers.json` directly. Autonomous suppression requires two independent
run observations and remains reversible through the validation change log.

## Psychiatrist Referral Rules

Psychiatry is often a referral pathway, not a simple "email this person"
pathway. The app should reduce friction without sending users into a dead end.

- `referralType: "gp"` means a GP appointment is the practical first step.
- `referralType: "self"` needs public evidence of self-referral, online booking,
  direct patient enquiry, or an equivalent pathway.
- `referralType: "specialist"` means another clinician or health professional
  referral is required or usually expected.
- `referralType: "unknown"` stays eligible, but the UI must say referral
  requirements are unclear and may need checking.
- Do not mark `self` just because a phone number or email is published.

Run:

```sh
node tools/audit-psychiatrist-referrals.mjs
```

The audit writes `data/provider-psychiatrist-referral-audit.json` and
`PSYCHIATRIST_REFERRAL_AUDIT.md`.

## Update Checklist

Before committing provider data changes:

1. Run `node tools/validate-provider-data.mjs`.
2. Run `node tools/audit-provider-source-fit.mjs`.
3. Run `node tools/audit-provider-availability.mjs`.
4. Run `node tools/audit-psychiatrist-referrals.mjs`.
5. Run `node tools/audit-provider-quality.mjs providers.json`.
6. Run `node tools/audit-support-preferences.mjs providers.json`.
7. Run `node tools/audit-address-coverage.mjs providers.json`.
8. Run `node tools/audit-availability-watchlist.mjs`.
9. Run `npm run export:regional-quality`.
10. Run `node tools/check-links.mjs`.
11. Check exact contact-type filters: GP, counsellor, psychologist, psychiatrist.
12. Check opt-in filters: Maori, Pasifika, Asian, Rainbow, trauma-informed,
   telehealth, female provider, male provider.
13. Check one local workflow in a large city and one in a thin-coverage region.
14. Run `npm run verify:providers:shadow` and inspect the control-room report.

## Legacy Human Review Queue

The former provider review queue remains available for audit archaeology,
one-off diagnostics, and migration comparisons:

```sh
npm run export:review
```

The export produces `data/provider-review-queue.json`,
`data/provider-review-queue.csv`, and `PROVIDER_REVIEW_QUEUE.md`. The queue is
focused by default. It prioritises high-severity audit findings, providers that
can affect first recommendations, psychiatrist referral uncertainty,
availability risk, unsupported broad tags, weak support-preference evidence,
weak telehealth evidence, geocode concerns, directory/direct-contact confusion,
register-only records, missing contact details, low confidence, and stale
verification dates.

The primary `admin/index.html` no longer accepts decisions. It is a read-only
autonomous validation control room. Legacy decision JSON can still be applied
explicitly through:

```sh
npm run apply:review
```

Supported decisions are `approve`, `adjust`, `reject`, `move_to_watchlist`,
`duplicate`, and `needs_more_info`. `correctedFields` is intentionally
allowlisted. Unsafe fields are rejected unless an explicit unsafe-field flag is
used for an exceptional local maintenance task.

New provider imports are allowed only from reviewed discovery suggestions. The
decision must be `approve`, must include `newProviderCandidate: true` or an
explicit `new-provider-import` approval, and must include a human-captured
source excerpt. The apply script rejects Google Places seed text, search-result
snippets, LinkedIn-only signals, blocked pages, and missing evidence. It fills
safe defaults such as verification month, `not_published` availability, and
psychiatrist baseline-scope metadata, but it does not infer accepting
availability, self-referral, advertised specialties, telehealth, cultural tags,
or broad condition tags from silence.

Every applied decision appends to `data/provider-review-log.jsonl`. The log is
the audit trail and should not be rewritten during normal review work.

## Legacy AI-Assisted Review Drafts

This older queue reviewer remains available for reproducing historical decision
drafts, but it is not the production autonomous workflow:

```sh
npm run review:ai -- --limit 25
```

The AI reviewer is evidence-bound. It receives current provider fields, audit
issues, source URLs, captured excerpts, and allowed corrected fields. It must
choose `needs_more_info` when evidence is weak, blocked, stale, conflicting, or
missing. The script writes `data/provider-ai-review-prompts.json`,
`data/provider-ai-review-decisions.json`, and `PROVIDER_AI_REVIEW_REPORT.md`.
When API quota is unavailable, Codex may draft
`data/provider-codex-review-decisions.json` from source pages opened in the
active repo session. Treat those decisions as AI-generated proposals and apply
them only through the explicit AI-review apply flag.

AI-generated decisions must not be applied accidentally. The controlled apply
script rejects them unless `--allow-ai-review-decisions` is passed. Always run a
dry run before any apply:

```sh
npm run apply:review -- --decisions data/provider-ai-review-decisions.json --allow-ai-review-decisions --dry-run
```

AI review must still follow the same rules as human review: do not invent
contact details, availability, self-referral, support tags, telehealth,
advertised specialties, costs, addresses, or clinician gender. Do not clear
verification metadata from AI output. After any apply, rerun validation, audits,
and tests before committing.

## Regional Priority Report

Use the regional data-quality report to decide where human review should start:

```sh
npm run export:regional-quality
```

The export writes `data/regional-data-quality-report.json` and
`REGIONAL_DATA_QUALITY_REPORT.md`. It combines local direct-care coverage, weak
GP source corroboration tasks, source-fit findings, availability/referral/
watchlist signals, and address or coordinate gaps into reviewer actions by
region. The report is triage only: it does not prove provider availability and
must not update `providers.json` without a reviewed decision, validation,
audits, and tests.

## Discovery And Snowball Enrichment

The discovery pipeline is for finding and corroborating public provider data,
not publishing it automatically. It starts with `providers.json`, audit gaps,
review queue items, thin-region search queues, and optional manual seeds:

```sh
npm run discover:seeds
npm run discover:enrich
npm run discover:suggest
npm run export:review
```

`tools/enrich-provider-candidates.mjs` works in bounded rounds. Round 1 searches
from seed details such as city, provider type, clinician name, practice name,
address, and known source URLs. Later rounds use found clinician/practice names,
clinic domains, phone numbers, email domains, addresses, Healthpoint/NZCCP/
RANZCP/Psychology Today titles, and public LinkedIn role signals to generate
more precise follow-up searches. The default maximum is three rounds.

Search engines must be accessed through official APIs (`GOOGLE_API_KEY` plus
`GOOGLE_CSE_ID`, or `BING_WEB_SEARCH_KEY`). If keys are missing, or `--no-network`
is used, the tooling writes reviewable search queues and seed-derived candidate
records; it must not scrape blocked SERP HTML.

Google Places discovery uses its own bounded review-gated export:

```sh
npm run discover:places -- --no-network
npm run discover:places -- --api-key-file "path/to/google-places-api-key.txt" --region Northland --type psychologist --limit-queries 2 --merge-existing
```

The key must remain local or in a secret manager. Do not commit it, paste it into
reports, or expose it in browser code. Places results may corroborate public
business identity, phone, website, address, and coordinates. They must not be
used alone for condition scope, advertised specialties, availability, referral,
cost, telehealth, cultural/safety tags, or direct clinical suitability.

Places `queryType` is only the search intent. It is not proof of the provider
`type`. For example, a result found by a psychiatrist query stays `unknown`
unless the result name/types, an existing matched provider record, or a stronger
source explicitly supports psychiatry. Shared directory/register domains,
shared clinic emails, and shared practice phones are identity signals, not
merge proof; clinician identity should win before shared contact details.

Google Places candidates are allowed to become discovery seeds. If a candidate
has a public provider-owned website, `npm run discover:enrich --
--fetch-seed-sources --max-seed-sources 10 --limit 10` may fetch that website as
a bounded source check. This mode skips Google Maps/search/social URLs and only
creates evidence candidates for review. It must not turn Places data into live
clinical claims.

Google Places can also work from the GP source corroboration queue:

```sh
npm run discover:places -- --gp-corroboration-queue data/gp-source-corroboration-queue.json --region Northland --limit-queries 5 --merge-existing
```

Those results are exact-practice discovery leads tied back to queued GP
provider IDs. They are not enough by themselves to change live GP records; a
reviewer still needs stronger practice-owned, Healthpoint, PHO/HPI/FHIR, or
official evidence.

Exact GP queue results must corroborate the queued target before they are kept
as a target match. A result needs a real name, phone, or address signal for the
queued provider; proximity or the fact that the result came from the target
query is not enough. If a stale merged result only matches a different provider,
the Places export drops it rather than showing it as GP corroboration.

Google Places can also create coordinate-gap review candidates for known
providers that have a public address but no coordinates:

```sh
npm run discover:places -- --coordinate-gap-providers --limit-queries 24 --max-results-per-query 3 --merge-existing
```

This mode skips vague locality-only addresses unless
`--include-vague-coordinate-gaps` is explicitly supplied. Places coordinate
candidates stay tied to the target provider ID, but they are still review
items. A reviewer must confirm that the Places result is the same professional
provider or same public clinic location before applying coordinates.

For focused address and distance-ranking work, export the location/distance
review pack:

```sh
npm run export:location-review-pack
```

The pack deduplicates missing-address, missing-coordinate, and coordinate-gap
tasks by provider, then groups them with batch keys like
`location-review:<issue>:<priority>:<match-strength>:<type>`. Draft decisions
must go through:

```sh
npm run draft:location-distance -- --confirmed-human-review --reviewer "Your name"
```

This helper can only draft `address`, `lat`, `lon`, `coordinateSource`,
`coordinatePrecision`, `coordinateConfidence`, and
`geocodeNeedsManualReview`. Google Places remains a location corroboration clue
only; it must not approve provider type, scope, availability, referral, cost,
telehealth, cultural support, or support-preference tags.

After exporting `data/gp-corroboration-review-pack.json` and checking captured
source excerpts, draft controlled GP contact/source decisions with:

```sh
npm run draft:gp-corroboration -- --confirmed-human-review --reviewer "Your name" --notes "Checked source; public contact/source fields match."
```

The helper is deliberately narrow. It only drafts public contact/source updates
such as `website`, `source`, `sourceQuality`, public phone, address, or
coordinates. It cannot approve availability, enrolment status, mental-health
scope, cultural support, funding, or referral claims. For failed source
captures, use `--decision needs_more_info --status failed` so the row remains a
manual browser-review task with no live provider changes.

The evidence graph keeps probable provider identities separate. It can match on
clinician name, practice name, domain, phone, email, address, city/region, and
known directory URLs. It should not merge two clinicians just because they work
at the same clinic, and it should not turn a directory/register page into a
direct provider without a separate public practice/contact source.

Source trust levels:

- `provider_owned` / `clinic_owned`: high for contact, service wording,
  explicit availability, and telehealth wording.
- `healthpoint` / `official_register`: high for contact and classification,
  but still check referral and availability wording carefully.
- `professional_directory`: medium/high depending on the field and whether a
  provider-owned source corroborates it.
- `google_places`: medium/low for public business identity, phone, website,
  address, and coordinates. Discovery/corroboration only.
- `linkedIn_public`: low/medium for role, clinic, city, or website discovery
  only. Do not use it alone for specialties, availability, referral pathways, or
  support-preference tags.
- `search_result`: low confidence, discovery only.
- `third_party_directory`: medium/low and generally needs corroboration.

`tools/build-provider-suggestions.mjs` turns evidence graph nodes into suggested
actions: add a provider, update an existing provider, mark duplicate, move to
watchlist, needs manual research, or reject as not relevant. Suggestions feed
the auditor queue and keep `reviewGateRequired: true`.

Must be reviewed before live use:

- `accepting` availability
- psychiatrist `self` referral
- cultural/safety tags
- telehealth/online flags
- broad need tags or advertised specialties
- sexual-harm or sensitive-claims scope
- candidates based only on LinkedIn, search snippets, or generic directories
- conflicting addresses, phone numbers, websites, or clinician/practice identity

## Structured Evidence Model

Review queue items can include structured source evidence:

```json
{
  "sourceEvidence": {
    "contact": [],
    "address": [],
    "availability": [],
    "referral": [],
    "scope": [],
    "tags": {},
    "telehealth": [],
    "cultural": [],
    "cost": []
  }
}
```

Each evidence item supports:

- `field`
- `value`
- `sourceUrl`
- `sourceType`
- `excerpt`
- `capturedAt`
- `confidence`
- `extractor`
- `needsManualReview`

Do not fake excerpts. If an importer cannot capture a source excerpt for a
claim, mark the relevant evidence item as `needsManualReview: true`.

Source-page extractors should treat identity fields conservatively. Do not use a
closure notice, waitlist notice, news heading, or other announcement as the
provider name. When a team page flattens several names together, keep a
title-prefixed clinician match narrow and leave the rest for manual review
instead of merging multiple clinicians into one record.

## Claim-Level Evidence Graph

Provider rows are now also exported as field-level claims:

```sh
npm run evidence:graph
npm run evidence:score
npm run export:claims
npm run export:auto-resolution
```

Each claim should carry:

- `claimId`
- `providerId`
- `field`
- `value`
- `sourceUrl`
- `sourceType`
- `sourceOwnerType`
- `excerpt` when an actual short excerpt is available
- `sourceLastChecked`
- `confidence`
- `riskLevel`
- `decision`
- `reason`
- `requiredHumanAction`

The graph is advisory. It does not change `providers.json`.

`auto_accept` is limited to low-risk public identity, contact, or location
claims from strong sources with no attached audit conflict. It must not be used
for availability, referral pathways, provider type, clinical scope, support
preference tags, telehealth, cost, age eligibility, crisis suitability, or
directory/direct-provider status.

The focused claim review queue compresses repeated issues into batches such as:

- GP source corroboration
- sensitive tag or scope evidence
- availability review
- referral pathway review
- location and distance evidence
- directory/direct-contact confusion

Use `npm run export:claims -- --include-all` only for deep audits. The default
claim queue stays focused so reviewers are not flooded with every stored field.

`npm run export:auto-resolution` creates advisory proposals for what can be
removed from manual claim review noise. The current policy is deliberately
narrow: it may de-prioritize low-risk stored claims that are already strong
enough, but it must not mutate provider data or approve high-risk claims. The
output also lists automation blocks so reviewers can see why availability,
referral, scope, support tags, and conflicts remain human-review work.

The auditor console may display those proposals as a queue source, but each row
is still a planning group rather than a provider approval. Use it to collapse
safe low-risk checks and to plan manual batches. Do not use it to mark
availability, referral pathway, cultural/safety tags, telehealth, cost,
specialty, or provider type as approved without reviewed source evidence.

The auditor console can also load the dedicated GP source corroboration queue.
Those rows are one-practice source checks for weak third-party GP records. They
may support corrections to website, phone, address, coordinates, source quality,
confidence, and verification metadata, but they must not be used to infer
availability, enrolment, mental-health specialty, cultural/language support, or
funding eligibility.

The console's filtered-batch helper is limited to `needs_more_info` decisions
for already-filtered sets. It is intended to record that a batch still needs
source research, not to approve or adjust provider data. Existing item decisions
are preserved and the exported decision JSON must still go through the controlled
apply, validation, audit, and test workflow.

`npm run draft:claim-batch -- --batch-key "<batch key>"` can prepare a
review-decision draft from one claim batch. This helper is intentionally narrow:
it does not write live provider data, it defaults to `needs_more_info`, and
`adjust` drafts require `--confirmed-human-review`, a reviewer, and source
excerpt or notes. Adjustment drafts only remove values from existing array
fields; they must not add support tags, telehealth, scope, availability, or
referral claims.

`npm run draft:source-fit-capture` can prepare reviewed decisions from
`data/provider-source-fit-evidence-capture.json`. Use it only after a human has
checked the source-fit capture rows and confirmed that the claim should be
removed or left unsupported. It groups rows by provider so several removals from
one record become one merged `adjust` decision and cannot re-add tags removed by
another row. The helper may remove `tags`, `needScope`, or
`advertisedSpecialties` values and may turn unsupported `onlineAvailable` /
`phoneSupport` booleans off. It must not add capabilities, availability,
referral, support-preference, telehealth, or specialty claims.

Never guess:

- accepting-new-client status
- psychiatrist self-referral
- Māori, Pasifika, Asian, Rainbow, trauma-informed, or telehealth support
- broad need tags such as depression, anxiety, trauma, addiction, or work
- whether a directory/register entry is a direct provider

## Source-Fit Audit

The source-fit audit protects against a record being more confident than its
source. It flags examples such as:

- sexual-harm-only sources tagged for general depression or anxiety
- addiction-only services ranking for unrelated low-mood support
- ACC, concussion, pain, or return-to-work providers used as broad psychology
- crisis pathways offered as routine first contacts
- directories with direct-contact signals
- national individual clinicians without telehealth evidence
- cultural-support or telehealth tags that lack public-source evidence
- register-only professionals without a separate public practice contact

High-severity findings fail CI unless a short-lived exception exists in
`data/provider-source-fit-allowlist.json`. Every allowlist item needs `id`,
`rule`, `reason`, `reviewedBy`, `reviewedDate`, and `expiryDate`; use it only
when the UI intentionally handles the risk safely.

Use this stricter command when source URLs, not only user-visible websites, need
network verification:

```sh
CHECK_PROVIDER_SOURCES=true node tools/check-links.mjs
```

For unsupported broad/support/telehealth findings, use a bounded evidence
capture pass before asking a human to inspect every row:

```sh
npm run export:source-fit-capture -- --limit 30 --rate-limit-ms 1000
```

Use resumable batches after the first run:

```sh
npm run export:source-fit-capture -- --limit 30 --skip-existing --merge-existing --rate-limit-ms 1000
```

The export writes `data/provider-source-fit-evidence-capture.json`,
`data/provider-source-fit-evidence-capture.csv`, and
`PROVIDER_SOURCE_FIT_EVIDENCE_CAPTURE.md`. It may mark a row as:

- `source_support_found`: the source page contains a short excerpt that appears
  to support the flagged claim. This still requires human confirmation.
- `safe_removal_candidate`: the source was reachable and no support wording was
  found. The generated correction only removes unsupported tags or telehealth
  flags; it does not add new claims.
- `needs_human_browser_review`, `source_skipped`, or `fetch_failed`: do not
  infer anything. Open the source manually or leave the item as
  `needs_more_info`.

For Māori, Pasifika, Asian, and Rainbow support-preference findings, the capture
tool is deliberately slower to suggest removals. If the provider's public name,
practice name, URL, or stored public text contains relevant identity cues but
the automated fetch misses explicit wording, the row is classified as
`needs_human_browser_review` rather than `safe_removal_candidate`.

This capture layer is designed to reduce review effort, not to bypass review.
Never use it to approve sensitive tags, telehealth, advertised specialties, or
availability without a reviewer checking the excerpt.

`--skip-existing` compares provider ID, audit rule, and target value against
the existing capture file so repeated bounded runs move on to new findings.
`--merge-existing` keeps previously captured excerpts and adds the new batch to
the same output. Stale merged rows are dropped by default when the underlying
source-fit finding no longer exists, so auditors do not spend time on already
resolved claims. Use `--keep-stale-existing` only when preserving old capture
rows for investigation. This is still review-gated; preserving an excerpt does
not approve the claim.

Each source-fit capture row has a batch key in the form
`source-fit:<status>:<rule>:<target>`. Use the auditor **Batch** filter to work
one repeated issue at a time, such as all safe-removal candidates for
unsupported telehealth flags, without mixing them with unrelated claims.
The summary includes eligible capture coverage. A zero remaining count means
the current capture rules have checked every source-fit finding they are
designed to handle; other audit rules may still need different review queues.

After reviewing safe-removal candidates, draft controlled decisions with:

```sh
npm run draft:source-fit-capture -- --confirmed-human-review --reviewer "Your name" --notes "Checked source; unsupported claims should be removed."
```

To keep the draft aligned with one auditor batch, pass the same batch key:

```sh
npm run draft:source-fit-capture -- --batch-key "source-fit:safe_removal_candidate:weak-telehealth-evidence:telehealth" --confirmed-human-review --reviewer "Your name" --notes "Checked this batch; unsupported telehealth claims should be removed."
```

The helper also accepts non-removal batch keys, including
`source_support_found`, but those drafts are `needs_more_info` only. Captured
support excerpts are review aids, not bulk approvals.

Then inspect the draft JSON/Markdown, run `npm run apply:review` only when the
decision file is correct, and rerun validation/audits/tests before committing.

Some official health and provider sites block automated link checks or rate-limit
them. Treat `401`, `403`, `429`, and Cloudflare-style `520`-`524` results as
"manual browser review needed" rather than automatically broken. The checker
uses a browser-like user agent by default; override `LINK_CHECK_USER_AGENT`,
`LINK_CHECK_RETRIES`, or `LINK_CHECK_CONCURRENCY` for slower manual audits.

GP corroboration review-pack rows use batch keys in the form
`gp-review:<priority>:<source-capture-status>:<source-category>`. Use these
with the auditor **Batch** filter or with `npm run draft:gp-corroboration --
--batch-key "<key>"` so captured Healthpoint rows, captured practice-site rows,
blocked source rows, and manual conflicts are not mixed together. GP batch
drafts remain contact/source-only and cannot approve enrolment, availability,
mental-health scope, cultural support, funding, or referral claims.

## Known Data Risks

- Many imported GP and directory records are intentionally marked `medium`
  confidence with `needsManualVerification: true`. That does not mean the record
  is unusable; it means the source should be manually checked before wider public
  promotion.
- Several non-GP support services still need address or coordinate enrichment for
  stronger distance ranking.
- Local psychiatrist coverage is thin in many regions. National telehealth
  psychiatry helps, but it is not a full substitute for local specialist access.
- Source URLs can break even when the user-visible phone/email remains valid.
  Broken source URLs should trigger manual re-verification.
