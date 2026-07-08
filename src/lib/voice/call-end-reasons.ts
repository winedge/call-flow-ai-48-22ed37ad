/**
 * Canonical end-of-call reasons, plus a human label + tone for the UI.
 *
 * Written by the voice-bridge (agent ended / transfer / max_duration /
 * silence_timeout / caller_hangup / bridge_error) and by the AMD callback
 * (voicemail_left / voicemail_hangup).
 */
export type EndReason =
  | "agent_ended"
  | "transfer"
  | "max_duration"
  | "silence_timeout"
  | "caller_hangup"
  | "voicemail_left"
  | "voicemail_hangup"
  | "bridge_error"
  | "agent_config_error"
  | "other";

export const END_REASON_LABEL: Record<EndReason, string> = {
  agent_ended: "AI ended",
  transfer: "Transferred",
  max_duration: "Max duration",
  silence_timeout: "Silence timeout",
  caller_hangup: "Caller hung up",
  voicemail_left: "Voicemail left",
  voicemail_hangup: "Voicemail (hung up)",
  bridge_error: "Bridge error",
  agent_config_error: "Agent config error",
  other: "Other",
};

/**
 * Tailwind color hint for badges/charts. Green = clean AI outcome,
 * amber = timeout-ish, blue = transfer/voicemail-left, red = error.
 */
export const END_REASON_TONE: Record<EndReason, "green" | "amber" | "blue" | "red" | "gray"> = {
  agent_ended: "green",
  transfer: "blue",
  max_duration: "amber",
  silence_timeout: "amber",
  caller_hangup: "gray",
  voicemail_left: "blue",
  voicemail_hangup: "gray",
  bridge_error: "red",
  agent_config_error: "red",
  other: "gray",
};

export const END_REASON_ORDER: EndReason[] = [
  "agent_ended",
  "transfer",
  "voicemail_left",
  "voicemail_hangup",
  "caller_hangup",
  "silence_timeout",
  "max_duration",
  "bridge_error",
  "agent_config_error",
  "other",
];

export function endReasonLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return END_REASON_LABEL[v as EndReason] ?? v;
}

export function endReasonTone(v: string | null | undefined): "green" | "amber" | "blue" | "red" | "gray" {
  if (!v) return "gray";
  return END_REASON_TONE[v as EndReason] ?? "gray";
}
