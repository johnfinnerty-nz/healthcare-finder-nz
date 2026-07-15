# Provider Validation Control Room

The primary admin page is a read-only operational view of the autonomous
provider validation engine. It is not a write-enabled admin console and does
not modify provider records.

## Run

From the repository root:

```sh
npm run verify:providers:report
python -m http.server 4174
```

Open:

```text
http://127.0.0.1:4174/admin/index.html
```

Do not open `admin/index.html` directly from disk. The browser must fetch
`data/provider-validation/control-room.json` through the local server.

## What It Shows

- latest run health and publish blockers
- shadow/canary rollout stage
- provider states: verified, limited, monitoring, suppressed, or unverifiable
- source fetch outcomes and blocked pages
- accepted, rejected, stale, and conflicting claims
- provider-level source timelines and external source links
- proposed automatic changes and reversible suppressions
- regional coverage and fallback health
- validation-run and rollback history

All provider source links open in a new tab with `noopener noreferrer`. Source
pages are not embedded or proxied.

## Refresh Data

Run a shadow validation to fetch and evaluate sources:

```sh
npm run verify:providers:shadow
```

Or regenerate the control-room projection from existing state:

```sh
npm run verify:providers:report
```

Then use **Refresh data** in the page.

## Safety Boundary

The browser has no endpoint, token, or filesystem capability for provider
writes. Automatic decisions are produced by backend scripts, compiled into a
shadow projection, and can reach `providers.json` only through the gated
publish command and automation pull request.

See `AUTONOMOUS_PROVIDER_VALIDATION.md` for source policy, credentials,
rollout, rollback, and commands.
