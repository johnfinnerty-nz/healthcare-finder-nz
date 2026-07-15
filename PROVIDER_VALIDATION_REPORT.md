# Autonomous Provider Validation Report

Generated: 2026-07-14T23:03:16.385Z
Run: validation-20260714230316-aa3f798f
Mode: shadow
Rollout stage: shadow

## Run Health

- Clean run: no
- Model: gpt-5.6
- Model verification complete: no
- Providers selected/checked: 20/20
- Pages fetched: 0
- Evidence claims retained: 0
- Structured-output errors: 0
- Blocked sources: 0
- Fetch errors: 0
- Synthetic claim-evaluation precision: 100.00% (27 versioned cases)

## Publish Gate

- Passed: no
- Blocked: model-credentials-missing
- Blocked: model-validation-incomplete
- Blocked: shadow-rollout-not-ready-for-publish
- Blocked: rollout-stage-needs-three-clean-runs

## Proposed Changes

- Material updates: 0
- Reversible suppressions: 0

## Validation States

- monitoring: 1214

## Remaining Risks

- Blocked, login-only, private, or robots-disallowed sources remain unverified and are not bypassed.
- Published phone and email details mean the provider publicly lists them; this process does not call or send test messages.
- The 99.5% gate applies to the versioned claim fixture. Production precision still depends on source coverage and should be monitored through rollback and smoke checks.
- A model credential is mandatory for publishing. Credential-less runs are diagnostic shadow runs only.
