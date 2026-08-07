// Video-call configuration — single source for the Jitsi domain and group
// limits so environments can adjust without code changes.
export const JITSI_DOMAIN = process.env.NEXT_PUBLIC_JITSI_DOMAIN ?? 'jitsi1.hosxp.net';

// Hard cap on people in one call (creator + invitees), keeping conferences
// within what the shared Jitsi instance handles comfortably.
export const MAX_CALL_PARTICIPANTS = 8;
