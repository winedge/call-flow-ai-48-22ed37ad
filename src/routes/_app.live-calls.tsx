import { createFileRoute } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { PhoneOff, ArrowRightLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { useDB } from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { Radio } from "lucide-react";

export const Route = createFileRoute("/_app/live-calls")({
  head: () => ({ meta: [{ title: "Live calls - BulkCall AI" }] }),
  component: LiveCalls,
});

// A call is "live" whenever it has not reached a terminal state. We match
// on ended_at being null (bridge/AMD/Twilio stamp ended_at on hangup) so
// queued/ringing/in_progress all surface here, not only rows that Twilio's
// intermediate status callback managed to update to "in_progress".
const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no_answer", "canceled"]);

// Overall live window - rows older than this never count as live even if
// they somehow never got an ended_at.
const LIVE_WINDOW_MS = 15 * 60 * 1000;

// A row still in "queued" state after this long has almost certainly been
// abandoned (Twilio's status callback didn't land, or the bridge died
// before reporting call-end). Drop it from the live view.
const QUEUED_STUCK_MS = 90 * 1000;

function LiveCalls() {
  const orgId = useDB((s) => s.currentOrgId);
  const [now, setNow] = useState(() => Date.now());
  const calls = useDB(
    useShallow((s) =>
      s.calls.filter((c) => {
        if (c.org_id !== orgId) return false;
        if (c.ended_at) return false;
        if (TERMINAL_STATUSES.has(c.status)) return false;
        const age = now - new Date(c.started_at).getTime();
        if (age >= LIVE_WINDOW_MS) return false;
        // Stuck "queued" rows are not live.
        if (c.status === "queued" && age >= QUEUED_STUCK_MS) return false;
        return true;
      }),
    ),
  );
  const agents = useDB((s) => s.agents);
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setTick((x) => x + 1);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Simulate "current speaker" toggling
  const currentSpeaker = (i: number): "ai" | "human" =>
    Math.floor((tick + i * 2) / 4) % 2 === 0 ? "ai" : "human";

  async function refresh({ notify = false, showSpinner = false } = {}) {
    if (!orgId) return;
    if (showSpinner) setRefreshing(true);
    try {
      const cutoff = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
      // Fetch ALL recent rows in the window (not filtered by ended_at) so
      // rows that have since ended come back with ended_at set and drop
      // out of the live filter in the store.
      const { data, error } = await supabase
        .from("calls")
        .select("*")
        .eq("user_id", orgId)
        .gte("started_at", cutoff)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      useDB.setState((s) => {
        const byId = new Map(s.calls.map((c) => [c.id, c]));
        for (const r of data ?? []) {
          const row = r as Record<string, unknown>;
          byId.set(row.id as string, {
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
        return { calls: Array.from(byId.values()).sort((a, b) => (a.started_at < b.started_at ? 1 : -1)) };
      });
      const active = (data ?? []).filter((r) => {
        const row = r as { ended_at: string | null; status: string };
        return !row.ended_at && !TERMINAL_STATUSES.has(row.status);
      }).length;
      if (notify) toast.success(`Refreshed - ${active} active call(s)`);
    } catch (e) {
      if (notify) toast.error(`Refresh failed: ${(e as Error).message}`);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  // Auto-refresh every 5s in case realtime is delayed.
  useEffect(() => {
    if (!orgId) return;
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

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
              {calls.length} active
            </span>
          </div>
        }
      />


      {calls.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No live calls"
          description="When campaigns are running you'll see active calls stream here in real time."
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {calls.map((c, i) => {
            const agent = agents.find((a) => a.id === c.agent_id);
            const dur = Math.round((Date.now() - new Date(c.started_at).getTime()) / 1000);
            const mm = String(Math.floor(dur / 60)).padStart(2, "0");
            const ss = String(dur % 60).padStart(2, "0");
            const speaker = currentSpeaker(i);
            return (
              <div key={c.id} className="bg-white ring-1 ring-black/5 rounded-xl p-5">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="font-mono text-neutral-900">{c.phone_to}</p>
                    <p className="text-[11px] text-neutral-500">via {agent?.name ?? "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-brand-primary text-lg">{mm}:{ss}</p>
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">elapsed</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  <SpeakerBar label="AI" active={speaker === "ai"} color="brand" />
                  <SpeakerBar label="Customer" active={speaker === "human"} color="zinc" />
                </div>

                <div className="bg-neutral-100 ring-1 ring-black/5 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto space-y-2">
                  {c.transcript.map((t, idx) => (
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
          })}
        </div>
      )}
    </>
  );
}

function SpeakerBar({ label, active, color }: { label: string; active: boolean; color: "brand" | "zinc" }) {
  return (
    <div className={`p-3 rounded-md ring-1 transition-all ${
      active
        ? color === "brand" ? "bg-brand-primary/10 ring-brand-primary/40" : "bg-neutral-200 ring-white/20"
        : "bg-white ring-black/5"
    }`}>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <div className="flex gap-0.5 mt-1.5 h-3 items-end">
        {Array.from({ length: 18 }).map((_, i) => {
          const h = active ? 30 + Math.random() * 70 : 12;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-all ${active ? (color === "brand" ? "bg-brand-primary" : "bg-neutral-500") : "bg-neutral-300"}`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
