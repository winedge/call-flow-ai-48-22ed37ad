/**
 * Shared reporting/metric helpers for campaigns and calls.
 */
import type { Call, Campaign, Contact } from "@/lib/data-store";

export type CampaignMetrics = ReturnType<typeof computeCampaignMetrics>;

export function computeCampaignMetrics(campaign: Campaign, calls: Call[], contacts: Contact[]) {
  const cCalls = calls.filter((c) => c.campaign_id === campaign.id);
  const totalContacts = contacts.filter((c) => c.list_id === campaign.list_id).length;

  const byStatus = {
    completed: 0,
    in_progress: 0,
    queued: 0,
    no_answer: 0,
    busy: 0,
    failed: 0,
    voicemail: 0,
    dialing: 0,
  };
  let answered = 0;
  let sumDur = 0;
  let sumCost = 0;
  let sumMinutes = 0;
  let booked = 0;
  let qualified = 0;
  let callbacks = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  let voicemailCount = 0;
  for (const c of cCalls) {
    if (c.status in byStatus) (byStatus as Record<string, number>)[c.status]++;
    // Voicemail can be encoded via status OR via end_reason (AMD sets end_reason
    // to voicemail_left / voicemail_hangup while status remains completed).
    const isVoicemail =
      c.status === "voicemail" ||
      c.end_reason === "voicemail_left" ||
      c.end_reason === "voicemail_hangup";
    if (isVoicemail) voicemailCount++;
    if (c.status === "completed" || isVoicemail) answered++;
    sumDur += c.duration_sec;
    sumCost += c.cost_cents;
    sumMinutes += c.ai_minutes;
    if (c.appointment_booked) booked++;
    const outcome = (c.outcome || "").toLowerCase();
    if (outcome.includes("qualified") || outcome.includes("interested")) qualified++;
    if (outcome.includes("callback") || outcome.includes("call back")) callbacks++;
    const started = new Date(c.started_at).getTime();
    if (!firstAt || started < firstAt) firstAt = started;
    if (!lastAt || started > lastAt) lastAt = started;
  }

  const placed = cCalls.length;
  const remaining = Math.max(0, totalContacts - placed);
  const answerRate = placed ? (answered / placed) * 100 : 0;
  const completionRate = totalContacts ? (placed / totalContacts) * 100 : 0;
  const successRate = placed ? (booked / placed) * 100 : 0;
  const avgDur = placed ? sumDur / placed : 0;

  // ETA - based on last N calls throughput
  let etaMinutes: number | null = null;
  if (campaign.status === "running" && remaining > 0 && placed >= 2 && firstAt && lastAt) {
    const spanMin = Math.max(1, (lastAt - firstAt) / 60_000);
    const rate = placed / spanMin; // calls per min observed
    if (rate > 0) etaMinutes = Math.round(remaining / rate);
  }

  return {
    campaignId: campaign.id,
    totalContacts,
    placed,
    queued: remaining,
    inProgress: byStatus.in_progress + byStatus.dialing,
    completed: byStatus.completed,
    answered,
    noAnswer: byStatus.no_answer,
    voicemail: voicemailCount,
    failed: byStatus.failed,
    busy: byStatus.busy,
    callbacks,
    booked,
    qualified,
    answerRate,
    completionRate,
    successRate,
    avgDur,
    aiMinutes: sumMinutes,
    costCents: sumCost,
    firstAt,
    lastAt,
    etaMinutes,
  };
}

export function formatEta(mins: number | null): string {
  if (mins == null) return "-";
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatDuration(sec: number): string {
  if (!sec || sec < 0) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function callsToCsv(rows: Array<Record<string, string | number | boolean | null>>): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
}

export function downloadFile(content: string, filename: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Heuristic lead score (0-100). Rewards signals that actually happen on our
 * calls: how much information the agent extracted, how engaged the caller
 * was (transcript turns + duration), whether the agent (not the caller) ended
 * the call cleanly, and — when present — booking / sentiment / outcome tags.
 */
export function leadScore(call: Call): number {
  // Non-completed calls can't really score.
  if (call.status !== "completed") return 0;

  let s = 10; // baseline for any completed call

  // 1. Data completeness — the strongest signal. Count meaningful
  //    (non-null, non-empty) values in extracted_data.
  const entries = Object.entries(call.extracted_data ?? {});
  if (entries.length > 0) {
    const filled = entries.filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === "string") return v.trim().length > 0;
      return true;
    }).length;
    const ratio = filled / entries.length;
    s += Math.round(ratio * 45); // up to +45
  }

  // 2. Engagement — transcript turns.
  const turns = Array.isArray(call.transcript) ? call.transcript.length : 0;
  if (turns >= 6) s += 5;
  if (turns >= 14) s += 5;
  if (turns >= 24) s += 5;

  // 3. Duration.
  if (call.duration_sec >= 30) s += 3;
  if (call.duration_sec >= 90) s += 4;
  if (call.duration_sec >= 180) s += 3;

  // 4. How the call ended.
  const reason = (call.end_reason || "").toLowerCase();
  if (reason === "agent_ended" || reason === "completed") s += 8;
  else if (reason === "caller_hangup" && turns < 6) s -= 15; // early hang-up
  else if (reason === "no_answer" || reason === "voicemail" || reason === "busy" || reason === "failed") s -= 20;

  // 5. Explicit outcome / sentiment / appointment when the pipeline sets them.
  if (call.appointment_booked) s += 25;
  if (call.sentiment === "positive") s += 8;
  if (call.sentiment === "negative") s -= 10;
  const o = (call.outcome || "").toLowerCase();
  if (o.includes("qualified") || o.includes("interested") || o.includes("booked")) s += 10;
  if (o.includes("not interested") || o.includes("dnc") || o.includes("do not")) s -= 25;

  return Math.max(0, Math.min(100, s));
}
