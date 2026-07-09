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

  for (const c of cCalls) {
    if (c.status in byStatus) (byStatus as Record<string, number>)[c.status]++;
    if (c.status === "completed" || c.status === "voicemail") answered++;
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
    voicemail: byStatus.voicemail,
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

/** Simple heuristic lead score (0–100) based on outcome, sentiment, duration, and appointment. */
export function leadScore(call: Call): number {
  let s = 20;
  if (call.appointment_booked) s += 40;
  if (call.sentiment === "positive") s += 20;
  if (call.sentiment === "negative") s -= 20;
  if (call.duration_sec > 60) s += 10;
  if (call.duration_sec > 180) s += 10;
  const o = (call.outcome || "").toLowerCase();
  if (o.includes("qualified") || o.includes("interested")) s += 15;
  if (o.includes("not interested") || o.includes("dnc")) s -= 30;
  return Math.max(0, Math.min(100, s));
}
