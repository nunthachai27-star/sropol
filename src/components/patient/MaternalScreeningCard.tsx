// MaternalScreeningCard — read-only display of maternal labor-triage
// screening results (Phase 4 U2, docs/superpowers/plans/2026-07-16-maternal-screening-ui.md).
//
// GC-U1 (binding): the underlying rule set is PROVISIONAL_UNAPPROVED — every
// surface here carries the shadow banner, and NOTHING renders green,
// including STABLE/NO_LOCAL_MATCH (see src/config/maternal-screen-display.ts
// for the color source of truth).
//
// GC-U2 (binding): `localTier`/`emergencyAcuity`/`isComplete`/
// `suspectedConditions` are a distinct vocabulary from CPD/ANC/partograph.
// This file imports colors/labels ONLY from
// `@/config/maternal-screen-display` — never `risk-levels.ts`,
// `cdss-presentation.ts`, or the ANC riskMeta map — and never renders a
// partograph/CPD/ANC component.
//
// GC-U5 (binding): this card only renders what the API response gives it.
// No client-side re-derivation of tier/acuity, no write paths.
'use client';

import { ShieldAlert } from 'lucide-react';
import type { MaternalScreenAssessmentDto, MaternalScreenAssessmentsResponse } from '@/types/api';
import type {
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
  SuspectedMaternalCondition,
} from '@/types/maternal-screening';
import {
  MATERNAL_SCREEN_TIER_LABEL_TH,
  MATERNAL_SCREEN_TIER_COLOR,
  EMERGENCY_ACUITY_LABEL_TH,
  EMERGENCY_ACUITY_COLOR,
  MATERNAL_SCREEN_FALLBACK_COLOR,
  SUSPECTED_CONDITION_LABEL_TH,
} from '@/config/maternal-screen-display';
import { IncompleteAssessmentMarker } from '@/components/shared/IncompleteAssessmentMarker';
import { ErrorState } from '@/components/shared/ErrorState';
import { LoadingState } from '@/components/shared/LoadingState';
import { formatRelativeAge } from '@/lib/relative-time';
import { formatThaiDate, formatThaiTime } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MaternalScreeningCardProps {
  data: MaternalScreenAssessmentsResponse | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CARD_BORDER = 'var(--rule-strong)';

const SHADOW_BANNER_TEXT = 'การคัดกรองท้องถิ่น (ชุดกฎยังไม่ได้รับการรับรอง — โหมดเงา)';
const EMPTY_TEXT = 'ยังไม่มีข้อมูลการคัดกรอง';
const MORE_HISTORY_TEXT = 'มีประวัติเพิ่มเติม';
const SUPERSESSION_TEXT = 'แก้ไขแทนรายการก่อนหน้า';
const ERROR_MESSAGE = 'ไม่สามารถโหลดข้อมูลการคัดกรองความเสี่ยงมารดาได้';

// ---------------------------------------------------------------------------
// Chip recipe — bordered transparent mono chip, inline style from the
// display config, data-* attribute for tests (AncRiskChip/FlagChip recipe).
// ---------------------------------------------------------------------------

function TierChip({ tier }: { tier: MaternalScreenLocalTier }) {
  const color = MATERNAL_SCREEN_TIER_COLOR[tier] ?? MATERNAL_SCREEN_FALLBACK_COLOR;
  return (
    <span
      data-testid="maternal-screen-tier-chip"
      data-tier={tier}
      className="inline-block border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {MATERNAL_SCREEN_TIER_LABEL_TH[tier] ?? tier}
    </span>
  );
}

function AcuityChip({ acuity }: { acuity: MaternalEmergencyAcuity }) {
  const color = EMERGENCY_ACUITY_COLOR[acuity] ?? MATERNAL_SCREEN_FALLBACK_COLOR;
  return (
    <span
      data-testid="maternal-screen-acuity-chip"
      data-acuity={acuity}
      className="inline-block border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {EMERGENCY_ACUITY_LABEL_TH[acuity] ?? acuity}
    </span>
  );
}

function SuspectedConditionChip({ condition }: { condition: SuspectedMaternalCondition }) {
  // Neutral/muted — suspected conditions are informational labels, not a
  // severity axis of their own (GC-U1: never green; GC4: never a diagnosis).
  const color = MATERNAL_SCREEN_FALLBACK_COLOR;
  return (
    <span
      data-testid="maternal-screen-suspected-chip"
      data-condition={condition}
      className="inline-block border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {SUSPECTED_CONDITION_LABEL_TH[condition] ?? condition}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function ShadowBanner({ ruleSetVersion }: { ruleSetVersion: string }) {
  return (
    <div
      data-testid="maternal-screen-shadow-banner"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 font-mono text-[11px]"
      style={{
        borderColor: 'var(--risk-medium)',
        background: 'color-mix(in srgb, var(--risk-medium) 10%, white)',
        color: 'var(--ink-navy)',
      }}
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--risk-medium)' }} />
      <span className="font-semibold">{SHADOW_BANNER_TEXT}</span>
      <span style={{ color: 'var(--ink-navy-muted)' }}>rule set {ruleSetVersion}</span>
    </div>
  );
}

function EvidenceRow({ field, value }: { field: string; value: unknown }) {
  return (
    <div className="font-mono text-[10px]" style={{ color: 'var(--ink-navy-dim)' }}>
      {field}: {String(value)}
    </div>
  );
}

function AssessmentSummary({ assessment }: { assessment: MaternalScreenAssessmentDto }) {
  return (
    <div data-testid="maternal-screen-latest" className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <TierChip tier={assessment.localTier} />
        <AcuityChip acuity={assessment.emergencyAcuity} />
        {!assessment.isComplete && (
          <IncompleteAssessmentMarker
            missingCount={assessment.missingRequiredFields.length}
            data-testid="maternal-screen-incomplete-marker"
          />
        )}
      </div>

      {assessment.suspectedConditions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {assessment.suspectedConditions.map((condition) => (
            <SuspectedConditionChip key={condition} condition={condition} />
          ))}
        </div>
      )}

      {assessment.matches.length > 0 && (
        <div data-testid="maternal-screen-matches" className="space-y-1.5">
          {assessment.matches.map((match) => (
            <div
              key={match.ruleId}
              className="border-l-2 pl-2"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              <div
                className="font-mono text-[10px] font-semibold"
                style={{ color: 'var(--ink-navy)' }}
              >
                RULE {match.ruleId}
              </div>
              {match.evidence.map((e, i) => (
                <EvidenceRow
                  key={`${match.ruleId}-${String(e.field)}-${i}`}
                  field={String(e.field)}
                  value={e.value}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {assessment.missingRequiredFields.length > 0 && (
        <div
          data-testid="maternal-screen-missing-fields"
          className="font-mono text-[10px]"
          style={{ color: 'var(--ink-navy-muted)' }}
        >
          ขาดข้อมูล: {assessment.missingRequiredFields.join(', ')}
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]"
        style={{ color: 'var(--ink-navy-muted)' }}
      >
        <span>{formatRelativeAge(assessment.assessedAt)}ที่แล้ว</span>
        <span>
          · {formatThaiDate(assessment.assessedAt)} {formatThaiTime(assessment.assessedAt)}
        </span>
        <span>· {assessment.sourceSystem}</span>
      </div>
    </div>
  );
}

function HistoryRow({ row }: { row: MaternalScreenAssessmentDto }) {
  return (
    <div
      data-testid="maternal-screen-history-row"
      className="flex flex-wrap items-center gap-1.5 border-t px-3 py-1.5 font-mono text-[10px]"
      style={{ borderColor: 'var(--rule-strong)' }}
    >
      <span style={{ color: 'var(--ink-navy-muted)' }}>
        {formatRelativeAge(row.assessedAt)}ที่แล้ว
      </span>
      <TierChip tier={row.localTier} />
      <AcuityChip acuity={row.emergencyAcuity} />
      {!row.isComplete && (
        <span
          data-testid="maternal-screen-history-incomplete-dot"
          title="ข้อมูลไม่สมบูรณ์"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--risk-medium)' }}
        />
      )}
      {row.supersedesId !== null && (
        <span
          data-testid="maternal-screen-supersession-marker"
          style={{ color: 'var(--ink-navy-dim)' }}
        >
          {SUPERSESSION_TEXT}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MaternalScreeningCard({
  data,
  isLoading,
  error,
  onRetry,
}: MaternalScreeningCardProps) {
  const hasData = !!data && (data.latest !== null || data.history.length > 0);
  const ruleSetVersion = data?.latest?.ruleSetVersion ?? data?.history[0]?.ruleSetVersion ?? '—';

  return (
    <div
      data-testid="maternal-screening-card"
      className="rounded-sm border bg-white"
      style={{ borderColor: CARD_BORDER }}
    >
      {/* Card header — matches the repo tile style (see LaborProgressCard). */}
      <div
        className="border-b px-3 py-2"
        style={{
          borderColor: CARD_BORDER,
          background: 'linear-gradient(135deg, var(--accent-navy-soft) 0%, white 60%)',
        }}
      >
        <h3 className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ink-navy)]">
          การคัดกรองความเสี่ยงมารดา
        </h3>
      </div>

      {isLoading && (
        <div className="p-3">
          <LoadingState variant="skeleton" />
        </div>
      )}

      {/* Constitution VI — stale-while-error: once data is on screen, a
          background revalidation error must NOT blank the card out. The DATA
          branch takes priority whenever hasData is true, even if `error` is
          truthy; ErrorState only renders when there is no data to fall back
          on. The page-level failedFeeds banner carries the failure signal
          while stale data stays visible here. */}
      {!isLoading && error != null && !hasData && (
        <ErrorState variant="banner" message={ERROR_MESSAGE} onRetry={onRetry} />
      )}

      {!isLoading && error == null && !hasData && (
        <div
          data-testid="maternal-screen-empty"
          className="px-3 py-4 text-center font-mono text-[11px]"
          style={{ color: 'var(--ink-navy-muted)' }}
        >
          {EMPTY_TEXT}
        </div>
      )}

      {!isLoading && hasData && data && (
        <>
          <ShadowBanner ruleSetVersion={ruleSetVersion} />
          <div className="p-3">
            {data.latest && <AssessmentSummary assessment={data.latest} />}

            {data.history.length > 0 && (
              <div className="mt-3">
                <div
                  className="px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--ink-navy-muted)' }}
                >
                  ประวัติการประเมิน
                </div>
                {data.history.map((row) => (
                  <HistoryRow key={row.id} row={row} />
                ))}
                {data.nextCursor !== null && (
                  <div
                    data-testid="maternal-screen-more-history-note"
                    className="px-3 py-1.5 font-mono text-[10px]"
                    style={{ color: 'var(--ink-navy-muted)' }}
                  >
                    {MORE_HISTORY_TEXT}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
