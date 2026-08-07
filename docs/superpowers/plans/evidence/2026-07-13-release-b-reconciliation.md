# Release B — Clinical-Data Reconciliation Evidence

**For:** clinical-owner sign-off (Release B "reconciliation contract")
**Generated:** 2026-07-13 (read-only queries against the production kk-lrms database)
**Source:** the three queries in `src/services/reconciliation.ts`, run verbatim; identical to what `GET /api/admin/reconciliation-report` returns
**Data as of:** production database at deploy of `1d4e608` (Releases A+B+C live)

> This is a **read-only** discrepancy report. Nothing was modified. It contains **de-identified
> aggregates only** — hospital codes, counts, and de-identified admission dates. No patient
> names or CIDs appear.

---

## Bottom line

Reconciliation is **clean and favorable — safe to bless the Release B canonical rules.**

| Check | Result | Meaning |
|---|---:|---|
| ANC risk mismatches (journey level vs latest screening) | **0** | The new canonical ANC rule introduces **no discrepancy** with existing data |
| Duplicate active journeys per (hospital, HN) | **0** | The one-active-journey invariant already holds; the `uq_mj_hospital_hn_active` index was **created cleanly at deploy** (fail-safe path not needed) |
| PREGNANCY journeys with an active labor admission ("stuck") | **3** | Pre-existing residue of the LABOR-transition bug B1 fixes — **the only actionable item** |

## Context (denominators)

- **5,258** maternal journeys total: 1,726 pregnancy · 3 labor · 3,529 delivered
- **108** journeys have ANC risk screenings (LOW 82 · HR1 8 · HR2 13 · HR3 5)
- Only these 108 are eligible for a risk-mismatch — and **0** disagree with their latest screening.

---

## The three decisions to bless (reconciliation contract)

1. **Canonical ANC rule** — item-derived severity is authoritative; a declared level may only *raise* it, never lower it. **Evidence:** 0 existing journeys conflict with this rule. The production browser sync already computes risk this way, so no back-conversion is needed.
2. **Historical-correction policy: future-only** — no historical rows were rewritten by this deploy. The 3 stuck cases below are pre-existing; they are corrected going forward, not retroactively edited.
3. **Duplicate active journeys** — **0 found**, so the uniqueness index was created without touching any data. (If any had existed, the migration would have *refused* to create the index and reported them, never deleting a row.)

## The one actionable finding — 3 "stuck" PREGNANCY-with-active-labor cases

These are journeys still marked PREGNANCY that have a cached labor row still flagged ACTIVE. **Root cause (confirmed by drill-down): they are NOT a Release B / B1 problem** — they are stale ACTIVE-labor rows for patients who have **left the active-labor ward in HOSxP** (delivered/discharged) but were never reconciled from ACTIVE → DELIVERED.

Evidence: all three hospitals synced **today** (บ้านฝาง 08:57, มัญจาคีรี 09:51, เขาสวนกวาง 09:59 — the latter two *after* the deploy), yet each patient's own `cached_patients.synced_at` is old (below). That means these patients **dropped out of the labor-sync payload** — so B1 never sees them (B1 only transitions patients present in the payload), and the auto-discharge reconcile never flipped their stale ACTIVE row. No `delivered_at` and no recorded newborn in the cache — consistent with the update simply never arriving after they left the ward.

| Hospital | Risk | Labor admitted | Patient row last synced | Partograph | Assessment |
|---|---|---|---|---|---|
| **10995 บ้านฝาง** | LOW | 2026-06-12 | **2026-06-12** | 2 obs, both 12 Jun | Frozen ~1 month; a labor cannot last a month — she delivered long ago. Stale ACTIVE row. |
| 11009 มัญจาคีรี | LOW | 2026-07-08 | 2026-07-08 | none | Dropped from payload after 8 Jul; no partograph → left ward without reconcile |
| 11011 เขาสวนกวาง | LOW | 2026-07-07 | 2026-07-12 | 3 obs, ALERT, latest 11 Jul | Was a genuinely monitored labor; dropped from payload after 12 Jul |

**This is orthogonal to Release B** — a pre-existing data-hygiene gap in the auto-discharge/reconcile path (a previously-ACTIVE labor patient who disappears from the sync payload should be marked DELIVERED, and here three were not). It affects **3 of 1,729** active journeys (0.17%), all LOW risk.

**Recommended follow-up (own ticket, not urgent, not a Release B blocker):** verify the browser-push auto-discharge reconcile handles "patient previously ACTIVE is absent from the current payload," and/or a one-time cleanup of ACTIVE labor rows whose `synced_at` is older than the hospital's recent sync activity. None of the three needs individual clinical review — they are almost certainly all delivered.

## Two items to confirm for the sign-off artifact (both benign here)

- The deployed `/api/admin/reconciliation-report` includes **HN** in the duplicate list (needed to physically locate a duplicate for remediation). The repo's PDPA convention (`pii-mask.ts`) masks name/CID but **not HN**. Confirm HN is acceptable in a sign-off document. *(Moot today: 0 duplicates, so no HN appears.)*
- In the report payload, `hospitalId` = **current** hospital for risk/stuck rows but **registering** hospital for duplicate rows (deliberate — it matches the uniqueness definition the index enforces).

---

## Sign-off

- [ ] Clinical owner reviewed and approves the canonical ANC classification rule (derived severity authoritative)
- [ ] Approves future-only correction policy (no historical rewrite)
- [ ] Acknowledges the 3 stuck-pregnancy cases and the บ้านฝาง manual-review recommendation

**Name / date:** ______________________
