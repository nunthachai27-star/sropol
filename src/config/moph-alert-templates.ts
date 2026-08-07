// MOPH Prompt LINE Flex alert templates.
//
// Builds the LINE Flex "bubble" JSON sent via the MOPH Prompt API. Two scopes
// (codex #6c — PDPA payload leakage):
//   - hospital_staff: MAY include a limited patient name/reference.
//   - province_center: MUST NOT include patient name/cid — only severity,
//     origin hospital, case ref, and confirm URL. The center is a broad
//     distribution list; minimum-necessary data only.
//
// LINE Flex requires CONCRETE hex colors (CSS vars like `var(--risk-high)` are
// meaningless to LINE's renderer), so this module defines its own severity
// palette. This is a distinct rendering target from the web CSS-var palettes in
// risk-levels.ts / maternal-screen-display.ts — not duplication.
//
// The server wraps a bare bubble with `title` as altText (per the API spec), so
// these builders return a bare bubble, not a full {type:'flex',altText,...}
// envelope. `alertTitle` produces the Thai alt-text/title string.

export type AlertSeverity = 'high' | 'emergency';
export type AlertRecipientScope =
  | 'hospital_staff'
  | 'province_center'
  // Self-subscribed users (notification_preferences row NOT on any admin list).
  // PDPA-safe like province_center: no patient name persisted/rendered —
  // enqueue's isStaff check is strict `=== 'hospital_staff'`.
  | 'self_subscribed';

export interface BuildAlertFlexInput {
  severity: AlertSeverity;
  recipientScope: AlertRecipientScope;
  /** Origin hospital name (resolved by the API from the session). */
  hospitalName: string;
  /** Case/journey reference shown to all scopes. */
  caseRef: string;
  /** Patient name — ONLY rendered for hospital_staff scope. Ignored for center. */
  patientName?: string | null;
  /** Optional maternal-triage acuity Thai label (e.g. 'ฉุกเฉิน'); falls back to severity label. */
  acuityLabel?: string | null;
  /** Optional action-button URL in the Flex footer (hospital scope only). */
  confirmUrl?: string | null;
}

// LINE Flex severity palette (concrete hex).
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  high: '#ef4444',
  emergency: '#ef4444',
};

const SEVERITY_LABEL_TH: Record<AlertSeverity, string> = {
  high: 'เสี่ยงสูง',
  emergency: 'ฉุกเฉิน',
};

const SCOPE_LABEL_TH: Record<AlertRecipientScope, string> = {
  hospital_staff: 'ผู้รับผิดชอบ รพ.',
  province_center: 'ศูนย์กลางจังหวัด',
  self_subscribed: 'ผู้ลงทะเบียนด้วยตนเอง',
};

/** Thai title/alt-text for the alert. */
export function alertTitle(input: { severity: AlertSeverity; hospitalName: string }): string {
  const tag = SEVERITY_LABEL_TH[input.severity];
  return `แจ้งเตือนกรณี${tag} — ${input.hospitalName}`;
}

function textBlock(
  text: string,
  opts: { weight?: 'bold' | 'regular'; size?: string; color?: string } = {},
): Record<string, unknown> {
  return {
    type: 'text',
    text,
    weight: opts.weight ?? 'regular',
    size: opts.size ?? 'md',
    color: opts.color,
    wrap: true,
  };
}

function footerButton(confirmUrl: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: '#ef4444',
        action: { type: 'uri', label: 'เปิดดูกรณี', uri: confirmUrl },
      },
    ],
  };
}

/**
 * Build a bare LINE Flex bubble for an alert. Patient name is rendered ONLY
 * when recipientScope === 'hospital_staff'; province_center never sees it.
 */
export function buildAlertFlex(input: BuildAlertFlexInput): Record<string, unknown> {
  const sevLabel = input.acuityLabel?.trim() || SEVERITY_LABEL_TH[input.severity];
  const scopeLabel = SCOPE_LABEL_TH[input.recipientScope];
  const headerTitle = `แจ้งเตือน${sevLabel}`;

  const bodyContents: Record<string, unknown>[] = [
    textBlock(headerTitle, { weight: 'bold', size: 'xl', color: SEVERITY_COLOR[input.severity] }),
    textBlock(`โรงพยาบาลต้นทาง: ${input.hospitalName}`, { weight: 'bold' }),
    textBlock(`กรณี: ${input.caseRef}`),
    textBlock(`แจ้งถึง: ${scopeLabel}`),
  ];

  // PDPA: patient name only for hospital-staff scope.
  if (input.recipientScope === 'hospital_staff' && input.patientName) {
    bodyContents.push(textBlock(`ผู้ป่วย: ${input.patientName}`));
  }

  const footer: Record<string, unknown> | undefined = input.confirmUrl
    ? footerButton(input.confirmUrl)
    : undefined;

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
    },
  };
  if (footer) bubble.footer = footer;
  return bubble;
}
