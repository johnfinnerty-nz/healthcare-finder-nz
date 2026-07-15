# Local Codex Autonomous Provider Validation

This workflow uses Codex itself as the review worker. It does not require an
OpenAI API key and it does not use GitHub Actions. All work stays in the local
repository and may be committed locally, but must never be pushed by the
automation.

This is a conservative remediation lane, not a replacement for every gate in
the credentialed validation engine. It is designed to make useful progress
without allowing a single Codex pass to publish new high-risk claims.

## What This Lane Can Do

- verify and correct public phone, text, email, website, booking, name,
  practice, city, region, and professional address data from exact evidence
- remove unsupported positive tags, condition scope, services, patient groups,
  age groups, and advertised specialties
- retain or strengthen explicit GP/specialist referral guidance
- move a provider to the availability watchlist when a public source explicitly
  says they are closed, not accepting, fully booked, waitlisted, or referrals
  are paused
- defer uncertain work with `needs_more_info`

## What This Lane Cannot Do

- add a new provider
- mark a provider as accepting clients
- mark a psychiatrist as self-referral or remove existing referral guidance
- add cultural, Rainbow, telehealth, gender, condition, age-group, patient-group,
  service, or advertised-specialty claims
- add coordinates or clear manual-verification metadata
- approve, reject, or merge records
- push, publish, email providers, submit forms, or bypass blocked sites

These restrictions are enforced in code, not only in the automation prompt.

## Files

- `data/provider-validation/codex-current-batch.json`: the currently leased
  provider batch
- `CODEX_PROVIDER_VALIDATION_BATCH.md`: readable batch summary
- `data/provider-validation/codex-review-decisions.json`: Codex research and
  correction proposals
- `data/provider-validation/codex-verified-decisions.json`: proposals that have
  passed fresh source verification
- `CODEX_PROVIDER_EVIDENCE_REPORT.md`: exact-evidence gate report
- `data/provider-validation/codex-progress.json`: completed, deferred, and
  leased queue items
- `data/provider-review-log.jsonl`: append-only applied-decision history

## One Autonomous Run

1. Confirm the local worktree is clean. Stop without editing if another person
   or process has uncommitted work.
2. Refresh the queue with `npm run export:review`.
3. Lease the next three non-GP providers with
   `npm run codex:batch -- --limit 3`.
4. For each provider, inspect public professional sources. Start with the
   provider/clinic site, then use official registers, Healthpoint, and
   professional directories for corroboration. Inspect relevant team, contact,
   services, fees, referral, telehealth, FAQ, and booking pages. Never use a
   search-result snippet as evidence.
5. Write `data/provider-validation/codex-review-decisions.json`. Every proposed
   field needs `sourceEvidence` with an exact excerpt and source URL. Record two
   distinct pass IDs:

   ```json
   {
     "version": 1,
     "decisions": [
       {
         "reviewId": "provider:example",
         "reviewIds": ["provider:example"],
         "providerId": "example",
         "action": "adjust",
         "generatedBy": "codex-autonomous-reviewer",
         "reviewer": "Codex autonomous validator",
         "reviewedDate": "2026-07-15",
         "correctedFields": {
           "email": "care@example.nz"
         },
         "sourceEvidence": [
           {
             "field": "email",
             "value": "care@example.nz",
             "sourceUrl": "https://example.nz/contact",
             "excerpt": "Email: care@example.nz"
           }
         ],
         "codexReview": {
           "researchPassId": "research-example-1",
           "verificationPassId": "verification-example-1",
           "verificationConclusion": "accept"
         },
         "reviewNotes": "Provider identity and contact were checked against the provider-owned contact page."
       }
     ]
   }
   ```

6. Perform a skeptical second pass before setting
   `verificationConclusion: "accept"`. Reopen sources, check that the claim
   belongs to the named clinician rather than only the wider practice, and look
   for contradictions, stale announcements, referral caveats, availability
   caveats, and directory-only records.
7. Refetch and mechanically verify every excerpt with
   `npm run codex:verify-evidence`.
8. Dry-run the controlled application:

   ```sh
   npm run apply:review -- --decisions data/provider-validation/codex-verified-decisions.json --allow-ai-review-decisions --dry-run
   ```

9. If and only if the source gate and dry run pass, apply locally:

   ```sh
   npm run apply:review -- --decisions data/provider-validation/codex-verified-decisions.json --allow-ai-review-decisions
   ```

10. Run `npm run check:syntax`, `npm run validate:data`, `npm run audit`, and
    `npm test`.
11. Update progress with `npm run codex:progress` only after the decision outcome
    is known.
12. Commit locally with a batch-specific message. Never push. If any validation
    fails, do not commit or continue with another batch; report the failure and
    leave the affected record unchanged.

## Why It Is Safe Without An API Key

Codex supplies the research judgement, but cannot bypass deterministic policy:

- batch leases prevent repeated concurrent work
- the source page is fetched again after Codex drafts the decision
- the exact excerpt must exist in the captured page
- the page must match the provider or known practice identity
- prompt-injection-like source text blocks the decision
- a distinct skeptical pass must explicitly accept the evidence
- positive high-risk additions are prohibited regardless of wording
- the existing review apply guard, audit log, validation, audits, and tests still
  run
- local git provides a reversible history

This intentionally favours precision over queue completion. An uncertain record
is deferred for 30 days rather than guessed.
