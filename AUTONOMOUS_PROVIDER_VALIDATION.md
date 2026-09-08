# Autonomous Provider Validation

This workflow validates public professional provider information without giving
a browser or model permission to write production data directly. It is
conservative by design: uncertain fields are omitted from ranking, explicit
negative availability is reversible, and every publish attempt must pass
deterministic gates.

## Data Flow

```text
providers.json (current public projection)
        |
        v
data/provider-validation/provider-canonical.json
  + separate practice and clinician entities
        |
        v
public source discovery and domain-bounded crawling
        |
        v
deterministic claims + strict model extraction
        |
        v
independent skeptical verification + rare adjudication
        |
        v
provider-validation-state.json + provider-evidence.json
        |
        v
shadow projection and safety gates
        |
        v
automation branch / pull request
        |
        v
providers.json (generated public projection)
```

The public finder remains static. The control room and model never write
`providers.json`. Only `tools/verify-providers.mjs --mode publish` can compile a
public projection, and it rolls the file back immediately if its local
post-publish checks fail.

The canonical file is not rebuilt from the public projection during ordinary
operation. `npm run canonical:providers` performs a non-destructive refresh: it
retains existing canonical claims and suppressed records, adds newly imported
public IDs, and carries validation state forward. The migration-only
`node tools/build-provider-canonical.mjs --force-rebuild` command discards that
internal history and should be used only when deliberately recreating the
canonical store from a trusted full source snapshot.

## Commands

Run a 25-provider incremental shadow check:

```sh
npm run verify:providers:shadow
```

Run a complete shadow pass:

```sh
npm run verify:providers:shadow -- --full
```

Include source discovery through configured official search APIs:

```sh
npm run verify:providers:shadow -- --full --discover
```

Regenerate the read-only report/control-room data without fetching sources:

```sh
npm run verify:providers:report
```

Attempt the current rollout publication:

```sh
npm run verify:providers:publish
```

Publication fails when credentials, rollout history, evidence, conflict,
precision, coverage, or change-size gates are not satisfied. Do not use
`--skip-post-publish-checks` in automation or production.

Evaluate deterministic policy fixtures:

```sh
npm run verify:providers:eval
```

Rollback a published run using the append-only change log:

```sh
npm run verify:providers:rollback -- --run-id validation-YYYYMMDDHHMMSS-id
```

## Credentials

Unattended model validation requires `OPENAI_API_KEY`. `gpt-5.6` is the default
model and can be changed with `PROVIDER_VALIDATION_MODEL`. Search discovery can
also use `GOOGLE_API_KEY` and `GOOGLE_CSE_ID`. Monthly discovery can use
`GOOGLE_PLACES_API_KEY`; matched Places websites remain discovery-only until
the fetched website passes identity, source, model, and deterministic policy.

Credentials must be GitHub Actions secrets or process environment variables.
The scripts do not read credential files from the repository or a user's home
directory. A ChatGPT or Codex subscription is not an unattended API credential.
Credential-less local runs are diagnostic shadow runs and can never publish.

Requests to the Responses API use `store: false`. They contain only public
professional provider material, never finder-user answers or health data.

## Crawling Rules

The crawler:

- accepts only public HTTP(S) pages on ports 80 or 443
- resolves and rejects private, loopback, link-local, and reserved addresses
  before every request and redirect
- rejects URL credentials, redirect loops, login pages, CAPTCHAs, and oversized
  or unsupported files
- reads `robots.txt`, honours matching allow/disallow rules and crawl delay,
  and discovers same-host sitemap URLs
- uses strict page and redirect budgets and one rate-limited crawl per domain
- uses conditional request metadata and page hashes
- keeps source metadata and relevant exact excerpts, not republished page copies
- exposes exact `mailto:`, `tel:`, booking-link, and JSON-LD fragments to the
  independent verifier without storing a full page snapshot
- uses `ETag`/`Last-Modified` revalidation; a `304 Not Modified` refreshes prior
  exact, model-verified claims and their expiry without storing a full page
- never bypasses access restrictions or scrapes search-result HTML

Headless rendering is an optional injected capability only. If no permitted
renderer is configured, JavaScript-only pages are recorded as needing a
fallback rather than bypassed.

## Source Ownership

An unfamiliar domain is `unknown`, not provider-owned. It is promoted to a
provider- or clinic-owned source only when the domain matches a known provider
signal and captured page text matches the clinician, practice, or provider
identity.

Search snippets and public LinkedIn signals are discovery/corroboration only.
They cannot independently establish specialties, availability, referrals,
cultural support, gender, or telehealth.

A search-discovered unknown domain is promoted to provider- or clinic-owned only
when the fetched page matches the provider's name and professional type and the
domain or a published email address supplies an ownership signal. A page that
merely mentions the clinician remains `unknown`.

Practices and clinicians are separate canonical entities. Practice reception
details may be shared only from a source identity-matched to that practice and
its clinician relationship. Clinician
scope, specialties, availability, gender, age groups, and cultural claims never
inherit automatically.

## Model Verification

The first Responses call uses strict Structured Outputs to extract typed claims
with a subject and verbatim excerpt. A separate skeptical call receives the
page text and proposed claims, but not the first model's reasoning. A third call
is made only for a high-risk disagreement.

Implementation references: [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
and the [Batch API](https://developers.openai.com/api/docs/guides/batch).

Page text is treated as untrusted prompt content. Models receive no tools that
can write files, cannot choose the source URL stored with a claim, and cannot
publish. Any excerpt not found exactly in the captured evidence text is
discarded.

Deterministic prompt-injection wording or the extractor's injection flag makes
that provider run incomplete. Claims from the affected page cannot publish.

## Automatic Claim Policy

- Identity requires a provider/clinic source, official register, or
  professional directory that matches the named subject.
- Contact data requires a provider/clinic-owned source or identical values from
  two trusted sources. Phone and email syntax is checked, but operational
  delivery is not claimed.
- `accepting` requires explicit current provider-owned wording or a genuinely
  selectable appointment. A generic booking button is not availability.
- `not_accepting` and `referrals_paused` require two independent run
  observations before reversible suppression.
- Psychiatry self-referral requires explicit psychiatrist/clinic wording.
  Conservative GP or specialist referral guidance is retained otherwise.
- Psychologist/counsellor condition, specialty, cultural, age, gender, and
  telehealth fields require exact subject-matched evidence.
- Ranking tags use a bounded allowlist and an explicit value-specific evidence
  pattern. Gender is stored as a dedicated evidence-backed field, not inferred
  through a free-form tag.
- A clinician name elsewhere on a team page does not bind a separate clinic
  service paragraph to that person. Ranking-sensitive claims require local
  excerpt context or an unmistakable individual profile page.
- Psychiatrist `baselineScope` remains a low-weight routing aid. Only
  source-backed `advertisedSpecialties` can create specialty wording or a
  strong match.
- One unreachable fetch changes nothing. Repeated failures are tracked, and a
  provider becomes unverifiable only after all source paths remain
  uncorroborated for at least 30 days.

## Freshness

- accepting or restrictive availability: daily
- waitlists: monthly
- contact, referral, and cost: quarterly
- scope, cultural, age, gender, and telehealth claims: six-monthly
- professional identity/registration: annually

Expired claims do not pass publication policy.

## Rollout And Gates

Rollout stages are `shadow`, `canary_50`, `canary_250`, and `full`. Three clean
complete shadow passes are required before canary validation. Each canary stage
requires three clean validation runs before publication and progression.
Incremental checks smaller than the active cohort remain useful monitors but
cannot advance readiness. Publication cohorts are exactly 50, 250, and then all
providers.

Publishing is blocked when:

- the model credential is absent or model verification is incomplete
- strict output/schema errors occurred
- conflicts remain unexplained
- a source-page claim could affect more than five providers without explicit
  practice-wide evidence
- more than 2% of providers would be materially changed in one run
- a regional dead end would be created
- the versioned claim-policy fixture precision is below 99.5%, or any high-risk
  fixture creates a false positive
- rollout readiness is incomplete
- validation, source-fit, availability, referral, address, recommendation,
  link, syntax, or deployment checks fail

The fixture gate is a regression control, not proof of production-world model
precision. Production safety also depends on conservative omission, source
coverage, monitoring, canaries, and rollback.

## Automation

`.github/workflows/provider-validation.yml` runs incremental checks nightly,
specialist checks weekly, and full discovery monthly. Validation state is
carried between runs through a private Actions cache. The monthly job can
refresh Google Places candidate websites before crawling, and every automation
PR explicitly runs the full audit bundle, link checker, credential-pattern
scan, runtime-dependency lock check, and static deployment sanity check. If repository variable
`PROVIDER_VALIDATION_AUTO_PUBLISH` is `true`, an eligible run creates an
automation branch and pull request; it never writes directly to `main`.

`.github/workflows/provider-validation-smoke.yml` checks a merged machine
projection locally. Local failure creates an automatic revert pull request
and enables auto-merge subject to repository protections. Its manual dispatch
checks the public finnerty.me deployment; a public-host failure does not
automatically revert source because a merge does not deploy the website.

## Control Room

Serve the repository root and open `/admin/index.html`. This is a read-only
operational console showing run health, rollout status, evidence coverage,
stale claims, blocked sources, source timelines, proposed changes,
suppressions, search-discovered sources, regional gaps, and rollback history.
It contains no decision form, credentials, or production write path.
