# Referral gateway sync (Phase 1: ingest referout · Phase 2: referin → ARRIVED)

**Date:** 2026-07-20 · **Approved scope:** Phase 1 + 2 (operator choice)
**Root cause doc:** memory `project-referral-lifecycle-stuck` — gateway pulls zero referral
data; autoArriveReferrals circularly gated on journey ownership nothing moves (156/156 prod
rows stuck INITIATED since ≤2026-05-16).

## Design decisions

1. **Template = newborn feed** (additive, best-effort, idempotent): SQL in
   `src/config/hosxp-queries.ts` → sections in `BrowserPushBody` → persist branches in
   `/api/sync/browser-push` → processors in new `src/services/sync/referrals.ts`.
   A referral failure must NEVER block the labor/ANC push.
2. **Phase 1 — origin side.** New `REFEROUT_MATERNITY_SINCE` (pg+mysql): `referout ro JOIN
   ovst o ON o.vn=ro.vn JOIN patient p ON p.hn=o.hn` selecting refer_number, refer_date,
   refer_time, refer_hospcode (destination hcode), pre_diagnosis, icd10,
   referout_emergency_type_id, p.hn, p.cid, p.fname/lname; rolling window
   `refer_date >= today-60d` (client-computed, like the ANC window; no server cutoff
   bootstrap — referrals are a rolling window, not append-only history). Maternity filter
   via EXISTS(person_anc active-window OR ipt_pregnancy) to cut volume; final relevance is
   decided server-side.
3. **Server policy: journey-must-exist.** `processBrowserReferouts` upserts
   `cached_referrals` by the SAME compound key the webhook path uses
   `(from_hospital_id, refer_number)` so both paths converge on one row — but unlike
   `processReferralCreate` it NEVER creates journeys: rows whose cid_hash matches no
   existing maternal journey are skipped+counted (ghost-journey lesson c80e9be — referral
   alone is weak evidence). Re-pull refreshes destination/reason/diagnosis (the "resync
   like ANC" behavior). Existing lifecycle status is never regressed by an upsert.
4. **Phase 2 — destination side.** New `REFERIN_SINCE`: `referin ri JOIN patient p ON
   p.hn=ri.hn` selecting p.cid, ri.refer_hospcode (origin), ri.refer_date, same 60d
   window. `processBrowserReferins` (runs under the DESTINATION hospital's push): match
   cached_referrals WHERE from_hospital=hcode(ri.refer_hospcode) AND to_hospital=pushing
   hospital AND status IN (INITIATED, ACCEPTED, IN_TRANSIT) AND journey.cid_hash =
   hash(cid) AND initiated_at ≤ refer_date+1d → set ARRIVED + arrived_at + move
   `maternal_journeys.current_hospital_id` to destination (same semantics as
   confirmArrival; ownership move only, no journey creation → no CID-collision surface).
   referin has NO refer_number column (verified against schema), hence the composite match.
   `refer_reply` → ACCEPTED is deferred (semantics unconfirmed) — documented future work.
5. **Back-compat:** all new push-body sections optional; old gateways keep working. New
   result counters surfaced in BrowserPollResult + push response + sync_events log.

## Hardening (post adversarial review, same day)

Confirmed findings fixed before first commit:

- **referin fuzzy match** gained a 30-day lower bound on initiation age (a fresh
  referin can no longer flip a months-old stuck INITIATED row) and a dedupe
  (journey + destination + arrival timestamp) so one evidence row arrives at
  most one referral across re-pulled cycles. referin.referout_number exists in
  the schema but is 0%-populated at live sites, so the composite match stays.
- **ownership move** now guarded: never for DELIVERED journeys, and only when
  the arrival is the journey's newest ARRIVED evidence (out-of-order 60-day
  backfill can't strand a round-trip patient at the wrong hospital).
  arrived_at approximates from referin.refer_date (mirrors origin send date).
- **referout.icd10 does not exist** in real HOSxP — principal diagnosis is
  `pdx` (live-verified); SQL + row mapping corrected.
- **Buddhist-Era dates** normalized via normalizeHosxpDate before caching.
- **refer_number yearly reuse** guard: an existing row initiated >90d from the
  pulled refer_date is a different physical referral — skipped, not overwritten.
- **REFERIN_SINCE dropped its ANC filter** (arriving women often aren't
  ANC-registered at the destination yet); window shortened to 14d, LIMIT 500;
  REFEROUT window 60d, LIMIT 200. Referrals no longer defeat the push-skip
  decision (they ride along with regular pushes).
- Per-row try/catch isolation + failed counters in both processors.

## ovst fallback (operator request, same day)

Some hospitals never fill the refer-in form (operator knowledge), so referin
evidence alone under-detects arrivals. Fallback: the GET bootstrap returns a
probe list (getReferralArrivalProbe — CIDs of open referrals TO the requesting
hospital, ≤100, initiated ≤30d, readwrite sessions of active hospitals only);
the gateway queries ovst for just those CIDs (OVST_FIRST_VISIT_FOR_CIDS,
validated 13-digit CIDs interpolated) and pushes `visitEvidences`
[{cid, visit_date}]. processBrowserVisitEvidences shares the exact guarded
arrival core with referin (30d window, per-evidence dedupe, DELIVERED +
newest-evidence ownership guards) — just without the origin constraint.

## Files

- `src/config/hosxp-queries.ts` — REFEROUT_MATERNITY_SINCE, REFERIN_SINCE (retire dead
  REFEROUT_PREGNANCY or leave with pointer comment)
- `src/services/sync/referrals.ts` — processBrowserReferouts, processBrowserReferins (NEW)
- `src/app/api/sync/browser-push/route.ts` — two best-effort persist branches
- `src/lib/browser-poll.ts` — two SQL pulls + body sections + result counters
- Tests: `tests/unit/services/sync-referrals.test.ts` (PGlite), browser-push route section
  tests mirroring the newborn section's coverage

## Test list (write FIRST)

P1: upsert creates INITIATED for known journey · idempotent re-push (no dupes, refreshed
fields) · converges with webhook-created row (same key) · skips unknown cid (counted) ·
skips unknown destination hcode (counted) · never regresses an advanced status.
P2: referin match → ARRIVED + ownership moved · no match (wrong origin/cid/status/date) →
untouched · terminal/REJECTED never resurrected · idempotent (second referin push no-op).
Route: sections optional · processor throw does not fail the push (sync_event error logged).
