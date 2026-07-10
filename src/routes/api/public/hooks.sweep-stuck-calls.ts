/**
 * Safety-net sweeper for calls that never reached a terminal state.
 *
 * Twilio normally POSTs a `completed` / `no-answer` / `busy` / `failed`
 * status when a call ends. If that webhook is missed (network hiccup,
 * signature mismatch, phone unreachable + carrier never returned a
 * terminal SIP response) the calls row can sit in `queued`, `ringing`,
 * or `in_progress` forever, which pins it to the Live Calls dashboard.
 *
 * This endpoint marks any non-terminal call older than STUCK_AFTER_MS
 * as `no_answer` with end_reason=`no_answer_timeout`. Safe to run every
 * minute via pg_cron.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api/cors";

const STUCK_AFTER_MS = 3 * 60 * 1000; // 3 minutes

export const Route = createFileRoute("/api/public/hooks/sweep-stuck-calls")({
  server: {
    handlers: {
      GET: async () => runSweep(),
      POST: async () => runSweep(),
    },
  },
});

async function runSweep() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const nowIso = new Date().toISOString();

  const { data: stuck, error: readErr } = await supabaseAdmin
    .from("calls")
    .select("id, status, started_at")
    .is("ended_at", null)
    .in("status", ["queued", "ringing", "in_progress"])
    .lt("started_at", cutoff)
    .limit(200);

  if (readErr) {
    return json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const ids = (stuck ?? []).map((r) => r.id);
  if (ids.length === 0) return json({ ok: true, swept: 0 });

  const { error: updErr } = await supabaseAdmin
    .from("calls")
    .update({
      status: "no_answer",
      end_reason: "no_answer_timeout",
      ended_at: nowIso,
    } as never)
    .in("id", ids);

  if (updErr) {
    return json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return json({ ok: true, swept: ids.length });
}
