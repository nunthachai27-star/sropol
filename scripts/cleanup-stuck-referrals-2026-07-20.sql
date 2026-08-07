-- Cleanup of legacy stuck-INITIATED referrals (2026-07-20)
-- Context: docs/superpowers/plans/2026-07-20-referral-gateway-sync.md
--
-- Before the referral gateway sync shipped (3625bb3 + c063076) no evidence
-- could ever advance a referral, so every cached_referrals row sat at
-- INITIATED. The live sync now handles rows initiated within its 30-day
-- matching window; this script settles ONLY what the live path cannot:
--
--   Step 1  ARRIVED backfill — rows (any age) where the app DB already holds
--           proof the patient reached the destination: an ANC visit or a
--           labor admission at to_hospital after initiation. arrived_at is
--           the REAL earliest evidence timestamp, never fabricated. Journey
--           ownership moves under the same guards as the live path (never
--           for DELIVERED journeys, never against newer arrival evidence).
--
--   Step 2  EXPIRED close-out — rows older than 30 days with no evidence
--           anywhere. Status EXPIRED (terminal, cleanup-only; UI renders
--           'หมดอายุ'). Nothing is deleted.
--
-- Rows initiated within the last 30 days and without evidence are LEFT
-- UNTOUCHED — the live referin/ovst sync is still able to resolve them.
--
-- SAFE BY DEFAULT: running this file is a DRY RUN that prints the change
-- ledgers and rolls back. To apply for real:
--
--   docker exec -i kk-lrms-postgres-1 psql -U kklrms -d kklrms \
--     -v apply=1 -f - < scripts/cleanup-stuck-referrals-2026-07-20.sql
--
-- (omit `-v apply=1` for the dry run). Idempotent: re-runs match nothing.
-- Every change writes an audit_logs row (action CLEANUP_REFERRAL_*).

\set ON_ERROR_STOP on
BEGIN;

-- ─── Step 1 ledger: evidence-based arrivals ─────────────────────────────────
CREATE TEMP TABLE cleanup_arrivals ON COMMIT DROP AS
SELECT
  s.id            AS referral_id,
  s.journey_id,
  s.to_hospital_id,
  s.initiated_at,
  LEAST(
    COALESCE(ev.anc_date, 'infinity'::timestamptz),
    COALESCE(ev.labor_date, 'infinity'::timestamptz)
  )               AS evidence_at,
  CASE
    WHEN ev.anc_date IS NOT NULL AND (ev.labor_date IS NULL OR ev.anc_date <= ev.labor_date)
      THEN 'anc_visit_at_destination'
    ELSE 'labor_admission_at_destination'
  END             AS evidence_source
FROM cached_referrals s
LEFT JOIN LATERAL (
  SELECT
    -- cached_anc_visits.visit_date stores date-only visits as UTC midnight,
    -- which renders as 07:00 in Bangkok; shift those to Bangkok midnight so a
    -- date-precision arrival honestly displays as 00:00. Real times pass
    -- through untouched.
    (SELECT CASE
              WHEN to_char(MIN(av.visit_date) AT TIME ZONE 'UTC', 'HH24MISS') = '000000'
                THEN MIN(av.visit_date) - interval '7 hours'
              ELSE MIN(av.visit_date)
            END
     FROM cached_anc_visits av
     WHERE av.journey_id = s.journey_id
       AND av.hospital_id = s.to_hospital_id
       AND av.visit_date >= s.initiated_at)                    AS anc_date,
    -- admit_date is timestamptz with real admission times — no cast needed.
    (SELECT MIN(cp.admit_date) FROM cached_patients cp
     WHERE cp.journey_id = s.journey_id
       AND cp.hospital_id = s.to_hospital_id
       AND cp.admit_date >= s.initiated_at::date)              AS labor_date
) ev ON true
WHERE s.status = 'INITIATED'
  AND (ev.anc_date IS NOT NULL OR ev.labor_date IS NOT NULL);

\echo '=== Step 1 ledger — will be marked ARRIVED (evidence-based) ==='
SELECT referral_id, to_hospital_id, initiated_at, evidence_at, evidence_source
FROM cleanup_arrivals ORDER BY initiated_at;

UPDATE cached_referrals cr
SET status = 'ARRIVED', arrived_at = ca.evidence_at, updated_at = now()
FROM cleanup_arrivals ca
WHERE cr.id = ca.referral_id AND cr.status = 'INITIATED';

-- Ownership follows the newest arrival evidence only; DELIVERED journeys
-- never move (same guards as processBrowserReferins).
UPDATE maternal_journeys mj
SET current_hospital_id = ca.to_hospital_id, updated_at = now()
FROM cleanup_arrivals ca
WHERE mj.id = ca.journey_id
  AND mj.care_stage <> 'DELIVERED'
  AND NOT EXISTS (
    SELECT 1 FROM cached_referrals newer
    WHERE newer.journey_id = mj.id
      AND newer.status = 'ARRIVED'
      AND newer.arrived_at > ca.evidence_at
  );

INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id,
                        metadata, created_at, user_name, user_role, hospital_code)
SELECT gen_random_uuid()::text, NULL, 'CLEANUP_REFERRAL_ARRIVED', 'REFERRAL',
       ca.referral_id,
       jsonb_build_object(
         'script', 'cleanup-stuck-referrals-2026-07-20',
         'evidence_source', ca.evidence_source,
         'evidence_at', ca.evidence_at,
         'initiated_at', ca.initiated_at
       ),
       now(), 'data-cleanup-script', 'ADMIN', NULL
FROM cleanup_arrivals ca;

-- ─── Step 2 ledger: expired close-out (old + zero evidence) ─────────────────
CREATE TEMP TABLE cleanup_expired ON COMMIT DROP AS
SELECT s.id AS referral_id, s.journey_id, s.to_hospital_id, s.initiated_at
FROM cached_referrals s
WHERE s.status = 'INITIATED'
  AND s.initiated_at < now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM cached_anc_visits av
    WHERE av.journey_id = s.journey_id
      AND av.hospital_id = s.to_hospital_id
      AND av.visit_date >= s.initiated_at)
  AND NOT EXISTS (
    SELECT 1 FROM cached_patients cp
    WHERE cp.journey_id = s.journey_id
      AND cp.hospital_id = s.to_hospital_id
      AND cp.admit_date >= s.initiated_at::date);

\echo '=== Step 2 ledger — will be marked EXPIRED (old, no evidence) ==='
SELECT referral_id, to_hospital_id, initiated_at FROM cleanup_expired ORDER BY initiated_at;

UPDATE cached_referrals cr
SET status = 'EXPIRED', updated_at = now()
FROM cleanup_expired ce
WHERE cr.id = ce.referral_id AND cr.status = 'INITIATED';

INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id,
                        metadata, created_at, user_name, user_role, hospital_code)
SELECT gen_random_uuid()::text, NULL, 'CLEANUP_REFERRAL_EXPIRED', 'REFERRAL',
       ce.referral_id,
       jsonb_build_object(
         'script', 'cleanup-stuck-referrals-2026-07-20',
         'initiated_at', ce.initiated_at,
         'reason', 'no arrival evidence within 30-day window'
       ),
       now(), 'data-cleanup-script', 'ADMIN', NULL
FROM cleanup_expired ce;

\echo '=== Post-cleanup status distribution ==='
SELECT status, count(*) FROM cached_referrals GROUP BY status ORDER BY status;

\if :{?apply}
COMMIT;
\echo '*** APPLIED — changes committed. ***'
\else
ROLLBACK;
\echo '*** DRY RUN — everything rolled back. Re-run with -v apply=1 to commit. ***'
\endif
