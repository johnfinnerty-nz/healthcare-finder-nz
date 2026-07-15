# Codex Provider Validation Batch

Generated: 2026-07-15T02:25:41.003Z
Batch: codex-20260715022541-98dbf9ae
Providers: 3

This is a local, no-API-key safe-remediation batch. Positive high-risk claims are prohibited.

## 1. Psychiatry Down South

- Provider ID: `otago-psychiatry-down-south`
- Type/location: psychiatrist | Dunedin | Otago
- Priority: critical / high
- Modes: contact_or_location_corroboration, evidence_only
- Rules: discovery-suggestion, needs_manual_research, conflict-address, conflict-phone
- Sources: https://www.psychiatrydownsouth.co.nz/referrals | https://www.psychiatrydownsouth.co.nz/contact

## 2. Dr Christmas Seu

- Provider ID: `psychiatry-nz-christmas-seu`
- Type/location: psychiatrist | Telehealth across New Zealand | National
- Priority: critical / high
- Modes: safe_removal_or_evidence_only, restrictive_availability_or_evidence_only
- Rules: discovery-suggestion, needs_manual_research, conflict-name, conflict-email, conflict-tags, conflict-advertisedSpecialties, stale-availability
- Sources: https://psychiatry.nz/

## 3. Psychiatry.nz

- Provider ID: `psychiatry-nz-han-chung-lim`
- Type/location: psychiatrist | Telehealth across New Zealand | National
- Priority: critical / high
- Modes: safe_removal_or_evidence_only, restrictive_availability_or_evidence_only
- Rules: discovery-suggestion, needs_manual_research, conflict-email, conflict-tags, conflict-advertisedSpecialties, stale-availability, update_existing_provider
- Sources: https://psychiatry.nz/
