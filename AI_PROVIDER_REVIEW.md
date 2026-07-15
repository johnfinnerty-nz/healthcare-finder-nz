# AI Provider Review Workflow

> Legacy diagnostic workflow. Production provider validation now uses the
> autonomous, shadow-first engine documented in
> `AUTONOMOUS_PROVIDER_VALIDATION.md`. This queue-drafting tool cannot satisfy
> the autonomous publish gates.

This workflow helps work through the provider audit queue when full manual
review is difficult. It is an AI-assisted review system, not an automatic
publisher. The AI can draft decisions, but live provider data still changes only
through the controlled `apply:review` script, validation, audits, tests, and a
commit.

## What The AI Reviewer Does

The reviewer reads items from `data/provider-review-queue.json`, including:

- current provider fields
- audit rules and issues
- source URLs
- captured source evidence excerpts
- existing suggested corrections
- fields that affect ranking

It then drafts one conservative decision per queue item:

- `approve`
- `adjust`
- `reject`
- `move_to_watchlist`
- `duplicate`
- `needs_more_info`

If evidence is weak, conflicting, blocked, stale, or missing, the expected
decision is `needs_more_info`.

## What The AI Reviewer Must Not Do

The AI reviewer must not:

- invent contact details
- infer accepting new clients from silence
- infer psychiatrist self-referral from contact details
- add cultural, safety, telehealth, specialty, or condition tags without source
  evidence
- turn a directory or register-only listing into a direct provider
- clear `needsManualVerification`, `verified`, or `lastVerified`
- write directly to `providers.json`

Local guardrails strip unsafe fields from AI output. The apply script also
blocks AI-generated decisions unless you deliberately pass
`--allow-ai-review-decisions`.

## Run The Queue Export First

```sh
npm run export:review
```

This refreshes:

- `data/provider-review-queue.json`
- `data/provider-review-queue.csv`
- `PROVIDER_REVIEW_QUEUE.md`

## Generate AI Review Drafts

Without an API key, this writes prompts and conservative `needs_more_info`
placeholder decisions:

```sh
npm run review:ai -- --no-network --limit 25
```

## No-Token Codex-Assisted Review

If the API key has no quota, Codex can still review batches inside this repo
session. Use this pattern:

1. Export or inspect the queue with `npm run export:review`.
2. Ask Codex to review a small batch, such as critical psychiatrist records or
   stale availability records.
3. Codex should open public source pages, draft a decision file such as
   `data/provider-codex-review-decisions.json`, and mark each decision with
   `aiReview` / `requiresHumanApproval`.
4. Dry-run with:

```sh
npm run apply:review -- --decisions data/provider-codex-review-decisions.json --allow-ai-review-decisions --dry-run
```

5. Apply only if the dry run passes and the source evidence is explicit.

The local Codex heartbeat can now run this pattern repeatedly without an API
key. It uses small leased batches, a skeptical second pass, fresh source fetches,
exact-excerpt and provider-identity checks, deterministic high-risk claim bans,
the controlled apply guard, validation, audits, tests, and local-only commits.
See `CODEX_AUTONOMOUS_VALIDATION.md`.

With an OpenAI-compatible chat-completions endpoint:

```sh
$env:OPENAI_API_KEY="..."
npm run review:ai -- --limit 25
```

Optional settings:

```sh
npm run review:ai -- --priority critical --type psychiatrist --limit 20
npm run review:ai -- --region Northland --limit 50
npm run review:ai -- --provider-id provider-id-here --limit 1
npm run review:ai -- --prompts-only --limit 50
```

The script writes:

- `data/provider-ai-review-prompts.json`
- `data/provider-ai-review-decisions.json`
- `PROVIDER_AI_REVIEW_REPORT.md`

## Inspect Before Applying

Open `data/provider-ai-review-decisions.json` and check:

- `action`
- `correctedFields`
- `sourceUrl`
- `sourceExcerpt`
- `aiReview.confidence`
- `aiReview.riskFlags`
- `aiReview.guardrailsApplied`

Treat `approve`, `reject`, `move_to_watchlist`, and new-provider import decisions
as high-risk.

## Dry-Run Apply

AI drafts are blocked by default. To intentionally test them:

```sh
npm run apply:review -- --decisions data/provider-ai-review-decisions.json --allow-ai-review-decisions --dry-run
```

If the dry run passes and the decisions are acceptable, apply them:

```sh
npm run apply:review -- --decisions data/provider-ai-review-decisions.json --allow-ai-review-decisions
```

Then run:

```sh
npm test
npm run validate:data
npm run audit
```

## Recommended Operating Pattern

1. Start with high-risk, high-impact queues:
   - critical priority
   - psychiatrists
   - availability/watchlist records
   - unsupported broad tags
   - weak telehealth or cultural tags
2. Run small batches of 10 to 25 records.
3. Apply only decisions with strong source excerpts.
4. Leave uncertain records as `needs_more_info`.
5. Commit only after validation, audits, and tests pass.

The point is to reduce repetitive review labour without letting uncertain AI
claims silently affect public recommendations.
