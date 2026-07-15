# Codex Provider Validation Batch

Generated: 2026-07-15T05:28:05.813Z
Batch: codex-20260715052805-fd0ad3ee
Providers: 3

This is a local, no-API-key safe-remediation batch. Positive high-risk claims are prohibited.

## 1. Heartwood Psychiatry

- Provider ID: `northland-heartwood-psychiatry`
- Type/location: psychiatrist | Northland and telehealth | Northland
- Priority: high / medium
- Modes: evidence_only
- Rules: discovery-suggestion, needs_manual_research
- Sources: https://www.heartwoodpsychiatry.co.nz/

## 2. Dr Staverton (Tony) Kautoke

- Provider ID: `psychiatry-nz-staverton-kautoke`
- Type/location: psychiatrist | Telehealth across New Zealand | National
- Priority: high / medium
- Modes: restrictive_availability_or_evidence_only
- Rules: stale-availability, discovery-suggestion, update_existing_provider
- Sources: https://psychiatry.nz/

## 3. Dr Evan Wilson

- Provider ID: `ranzcp-13276`
- Type/location: psychiatrist | Bromley | Canterbury
- Priority: high / medium
- Modes: restrictive_availability_or_evidence_only, evidence_only
- Rules: weak-telehealth-evidence, stale-availability, discovery-suggestion, update_existing_provider
- Sources: https://www.yourhealthinmind.org/find-a-psychiatrist/profile/13276/dr-evan-wilson
