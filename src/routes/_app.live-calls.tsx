import { createFileRoute } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PhoneOff, ArrowRightLeft, RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState } from "@/components/app/primitives";
import { PageSkeleton } from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import { useDB, type AIAgent, type Call } from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/live-calls")({
  head: () => ({ meta: [{ title: "Live calls - BulkCall AI" }] }),
  component: LiveCalls,
});

// A call is "live" whenever it has not reached a terminal state.
const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no_answer", "canceled"]);
const LIVE_WINDOW_MS = 15 * 60 * 1000;
const QUEUED_STUCK_MS = 90 * 1000;
// If nothing has been said on the call after this long, assume the callee's
// phone is off / unreachable and Twilio's terminal webhook hasn't arrived
// yet. Hide it from the live view so it doesn't tick forever.
const SILENT_STUCK_MS = 2 * 60 * 1000;

function LiveCalls() {
  const hydrated = useDB((s) => s.hydrated);
  const orgId = useDB((s) => s.currentOrgId);
  // Slow ticker (5s) just to prune stuck queued rows and expire the live
  // window - NOT tied to per-second UI updates. Card elapsed-time counters
  // live inside each card, so the parent doesn't re-render every second.
  const [pruneTick, setPruneTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const liveCalls = useDB(
    useShallow((s) => {
      const now = Date.now();
      return s.calls.filter((c) => {
        if (c.org_id !== orgId) return false;
        if (c.ended_at) return false;
        if (TERMINAL_STATUSES.has(c.status)) return false;
        const age = now - new Date(c.started_at).getTime();
        if (age >= LIVE_WINDOW_MS) return false;
        if (c.status === "queued" && age >= QUEUED_STUCK_MS) return false;
        // Ringing or in_progress with no transcript activity = phone off /
        // unreachable / call never actually connected.
        const hasActivity = (c.transcript?.length ?? 0) > 0;
        if (!hasActivity && age >= SILENT_STUCK_MS) return false;
        return true;
      });
    }),
    // pruneTick isn't referenced above, but the ref below re-selects when it changes
  );
  // Force the selector to re-run when pruneTick advances - the selector reads
  // Date.now() directly, so zustand needs a reason to run it again.
  void pruneTick;

  const agents = useDB((s) => s.agents);
  const agentsById = useMemo(() => {
    const m = new Map<string, AIAgent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    const t = setInterval(() => setPruneTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const refreshingRef = useRef(false);
  async function refresh({ notify = false, showSpinner = false } = {}) {
    if (!orgId || refreshingRef.current) return;
    refreshingRef.current = true;
    if (showSpinner) setRefreshing(true);
    try {
      // Fire-and-forget: server-side safety net to mark any call that has
      // been ringing/in_progress with no terminal webhook as no_answer.
      fetch("/api/public/hooks/sweep-stuck-calls", { method: "POST" }).catch(() => {});
      const cutoff = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("calls")
        .select("*")
        .eq("user_id", orgId)
        .gte("started_at", cutoff)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = data ?? [];
      useDB.setState((s) => {
        // Only touch calls whose rows actually changed to avoid churning the
        // whole array (which forces every subscriber to re-diff).
        const incoming = new Map<string, Call>();
        for (const r of rows) {
          const row = r as Record<string, unknown>;
          incoming.set(row.id as string, {
            id: row.id as string,
            org_id: (row.user_id as string) ?? orgId,
            campaign_id: (row.campaign_id as string | null) ?? null,
            contact_id: (row.contact_id as string | null) ?? null,
            agent_id: (row.agent_id as string | null) ?? null,
            phone_to: (row.phone_to as string) ?? "",
            phone_from: (row.phone_from as string) ?? "",
            twilio_call_sid: (row.twilio_call_sid as string) ?? "",
            started_at: (row.started_at as string) ?? new Date().toISOString(),
            ended_at: (row.ended_at as string | null) ?? null,
            duration_sec: Number(row.duration_sec ?? 0),
            status: (row.status as never) ?? "queued",
            outcome: (row.outcome as string) ?? "",
            recording_url: (row.recording_url as string | null) ?? null,
            transcript: Array.isArray(row.transcript) ? (row.transcript as never) : [],
            summary: (row.summary as string) ?? "",
            sentiment: (row.sentiment as never) ?? null,
            cost_cents: Number(row.cost_cents ?? 0),
            ai_minutes: Number(row.ai_minutes ?? 0),
            appointment_booked: Boolean(row.appointment_booked),
            end_reason: (row.end_reason as string | null) ?? null,
            extracted_data:
              row.extracted_data && typeof row.extracted_data === "object" && !Array.isArray(row.extracted_data)
                ? (row.extracted_data as Record<string, never>)
                : {},
          });
        }
        let changed = false;
        const next = s.calls.map((c) => {
          const inc = incoming.get(c.id);
          if (!inc) return c;
          incoming.delete(c.id);
          // Shallow compare a few volatile fields to decide if the row actually changed.
          if (
            inc.status === c.status &&
            inc.ended_at === c.ended_at &&
            inc.duration_sec === c.duration_sec &&
            inc.recording_url === c.recording_url &&
            (inc.transcript?.length ?? 0) === (c.transcript?.length ?? 0)
          ) return c;
          changed = true;
          return inc;
        });
        if (incoming.size > 0) {
          changed = true;
          for (const inc of incoming.values()) next.unshift(inc);
        }
        return changed ? { calls: next } : {};
      });
      const active = rows.filter((r) => {
        const row = r as { ended_at: string | null; status: string };
        return !row.ended_at && !TERMINAL_STATUSES.has(row.status);
      }).length;
      if (notify) toast.success(`Refreshed - ${active} active call(s)`);
    } catch (e) {
      if (notify) toast.error(`Refresh failed: ${(e as Error).message}`);
    } finally {
      refreshingRef.current = false;
      if (showSpinner) setRefreshing(false);
    }
  }

  // Auto-refresh every 15s - realtime handles most updates; this is just a
  // safety net for missed events. 5s was hammering the DB and re-rendering
  // every card on each round-trip.
  useEffect(() => {
    if (!orgId) return;
    const t = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (!hydrated) return <PageSkeleton variant="cards" withActions />;

  return (
    <>
      <PageHeader
        title="Live Calls"
        description="Real-time dispatch monitor. Listen, transfer, or terminate any active call."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refresh({ notify: true, showSpinner: true })} disabled={refreshing}>
              <RefreshCw className={`size-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <span className="text-xs font-mono px-3 py-1 bg-brand-primary/10 text-brand-primary rounded-full ring-1 ring-brand-primary/30">
              <span className="size-1.5 rounded-full bg-brand-primary inline-block mr-1.5 animate-pulse" />
              {liveCalls.length} active
            </span>
          </div>
        }
      />

      {liveCalls.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No live calls"
          description="When campaigns are running you'll see active calls stream here in real time."
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {liveCalls.map((c, i) => (
            <CallCard key={c.id} call={c} index={i} agent={agentsById.get(c.agent_id ?? "")} />
          ))}
        </div>
      )}
    </>
  );
}

// Each card owns its own 1s timer so the parent + sibling cards never
// re-render on tick. React.memo keeps the card static unless its call row
// actually changes.
const CallCard = memo(function CallCard({
  call,
  index,
  agent,
}: {
  call: Call;
  index: number;
  agent: AIAgent | undefined;
}) {
  const startedAt = useMemo(() => new Date(call.started_at).getTime(), [call.started_at]);
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.round((Date.now() - startedAt) / 1000)));

  useEffect(() => {
    setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    const t = setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  // Deterministic "who's speaking" toggle based on time - no random per frame.
  const speaker: "ai" | "human" = Math.floor((elapsed + index * 2) / 4) % 2 === 0 ? "ai" : "human";

  return (
    <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="font-mono text-neutral-900">{call.phone_to}</p>
          <p className="text-[11px] text-neutral-500">via {agent?.name ?? "-"}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-brand-primary text-lg tabular-nums">{mm}:{ss}</p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">elapsed</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <SpeakerBar label="AI" active={speaker === "ai"} color="brand" />
        <SpeakerBar label="Customer" active={speaker === "human"} color="zinc" />
      </div>

      <div className="bg-neutral-100 ring-1 ring-black/5 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto space-y-2">
        {call.transcript.map((t, idx) => (
          <div key={idx} className="text-xs font-mono">
            <span className={t.speaker === "ai" ? "text-brand-primary" : "text-neutral-600"}>
              {t.speaker === "ai" ? "AI" : "USR"} ›
            </span>{" "}
            <span className="text-neutral-900">{t.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => toast.info("Transfer requires Twilio config")}>
          <ArrowRightLeft className="size-3.5 mr-1" /> Transfer
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-red-400" onClick={() => toast.info("End-call wired to Twilio in production")}>
          <PhoneOff className="size-3.5 mr-1" /> End call
        </Button>
      </div>
    </div>
  );
});

// Pre-computed static bar heights - no Math.random() on every render. The
// "active" state is expressed by CSS animation, not by re-rendering.
const BAR_HEIGHTS = [42, 68, 55, 80, 35, 62, 90, 48, 72, 58, 84, 40, 66, 52, 78, 45, 70, 60];

const SpeakerBar = memo(function SpeakerBar({
  label,
  active,
  color,
}: {
  label: string;
  active: boolean;
  color: "brand" | "zinc";
}) {
  return (
    <div
      className={`p-3 rounded-md ring-1 transition-colors ${
        active
          ? color === "brand"
            ? "bg-brand-primary/10 ring-brand-primary/40"
            : "bg-neutral-200 ring-white/20"
          : "bg-white ring-black/5"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <div className="flex gap-0.5 mt-1.5 h-3 items-end">
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm ${
              active
                ? color === "brand"
                  ? "bg-brand-primary animate-pulse"
                  : "bg-neutral-500 animate-pulse"
                : "bg-neutral-300"
            }`}
            style={{ height: active ? `${h}%` : "12%", animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
});
