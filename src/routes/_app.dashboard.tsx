import { useShallow } from "zustand/react/shallow";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { PhoneCall, Voicemail, CalendarCheck, Radio, Users } from "lucide-react";

import { PageHeader, StatusPill } from "@/components/app/primitives";
import { useDB } from "@/lib/data-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dispatch Board - BulkCall AI" },
      { name: "description", content: "Live call-ops console for your outbound AI dispatchers." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const orgId = useDB((s) => s.currentOrgId);
  const calls = useDB(useShallow((s) => s.calls.filter((c) => c.org_id === orgId)));
  const campaigns = useDB(useShallow((s) => s.campaigns.filter((c) => c.org_id === orgId)));
  const agents = useDB((s) => s.agents);

  const now = Date.now();
  const startToday = new Date().setHours(0, 0, 0, 0);
  const callsToday = calls.filter((c) => new Date(c.started_at).getTime() >= startToday);
  const answered = callsToday.filter((c) => ["completed", "voicemail", "in_progress"].includes(c.status));
  const completed = callsToday.filter((c) => c.status === "completed");
  const voicemails = callsToday.filter((c) => c.status === "voicemail");
  const failed = callsToday.filter((c) => c.status === "failed");
  const booked = completed.filter((c) => c.appointment_booked).length;
  const liveCalls = calls.filter((c) => c.status === "in_progress");

  // 60-minute density strip (each cell = 1 minute of the last hour)
  const heat = useMemo(() => {
    const cells: number[] = new Array(60).fill(0);
    for (const c of calls) {
      const t = new Date(c.started_at).getTime();
      const mins = Math.floor((now - t) / 60000);
      if (mins >= 0 && mins < 60) cells[59 - mins] += 1;
    }
    return cells;
  }, [calls, now]);
  const heatMax = Math.max(1, ...heat);

  // Per-agent occupancy roster
  const roster = useMemo(
    () =>
      agents.map((a) => {
        const inFlight = calls.filter((c) => c.agent_id === a.id && c.status === "in_progress").length;
        const doneToday = callsToday.filter((c) => c.agent_id === a.id && c.status === "completed").length;
        return { agent: a, inFlight, doneToday };
      }),
    [agents, calls, callsToday],
  );

  const activeCampaigns = campaigns.filter((c) => c.status === "running");
  const pace = activeCampaigns.reduce((s, c) => s + (c.calls_per_minute ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dispatch Board"
        description="Live view of every outbound line, dispatcher, and campaign in motion."
      />

      {/* SITREP band - the "state of the room" at a glance */}
      <div className="mb-6 rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] divide-y md:divide-y-0 md:divide-x divide-neutral-200/70">
          <div className="p-5">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              <span className={cn("size-2 rounded-full", liveCalls.length ? "bg-emerald-500 animate-pulse" : "bg-neutral-300")} />
              {liveCalls.length ? "On the wire" : "Room quiet"}
            </div>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-5xl font-mono font-medium tracking-tight text-neutral-900 tabular-nums">
                {String(liveCalls.length).padStart(2, "0")}
              </span>
              <span className="pb-2 text-xs text-neutral-500">
                {liveCalls.length === 1 ? "line active" : "lines active"}
              </span>
            </div>
            <p className="mt-3 text-[11px] font-mono text-neutral-500">
              Pacing {pace}/min - {activeCampaigns.length} campaign{activeCampaigns.length === 1 ? "" : "s"} running
            </p>
          </div>
          <SitrepCell icon={PhoneCall} label="Placed today" value={callsToday.length} />
          <SitrepCell
            icon={CalendarCheck}
            label="Booked"
            value={booked}
            sub={completed.length ? `${Math.round((booked / completed.length) * 100)}% of completed` : "no completed calls"}
          />
          <SitrepCell
            icon={Voicemail}
            label="Voicemail / Failed"
            value={`${voicemails.length} / ${failed.length}`}
            sub={callsToday.length ? `${Math.round((answered.length / callsToday.length) * 100)}% answered` : "-"}
          />
        </div>

        {/* Minute-by-minute call density strip */}
        <div className="border-t border-neutral-200/70 px-5 pt-4 pb-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
            <span>Last 60 minutes - call density</span>
            <span>peak {heatMax}/min</span>
          </div>
          <div className="flex items-end gap-[2px] h-14">
            {heat.map((v, i) => {
              const h = Math.max(2, Math.round((v / heatMax) * 100));
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-t-sm",
                    v === 0 ? "bg-neutral-100" : v >= heatMax * 0.66 ? "bg-brand-primary" : v >= heatMax * 0.33 ? "bg-brand-primary/60" : "bg-brand-primary/30",
                  )}
                  style={{ height: `${h}%` }}
                  title={`t-${59 - i} min · ${v} calls`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-mono text-neutral-400">
            <span>-60m</span>
            <span>-45m</span>
            <span>-30m</span>
            <span>-15m</span>
            <span>now</span>
          </div>
        </div>
      </div>

      {/* Two-column ops split: live wire + dispatcher roster */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        {/* Live wire */}
        <div className="lg:col-span-3 rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-brand-primary" strokeWidth={1.75} />
              <h2 className="text-sm font-medium text-neutral-900">The Wire</h2>
            </div>
            <span className="text-[10px] font-mono text-neutral-500">
              {liveCalls.length} open
            </span>
          </div>
          <div className="divide-y divide-neutral-100 max-h-[360px] overflow-y-auto">
            {liveCalls.length === 0 && (
              <div className="px-5 py-16 text-center">
                <p className="text-xs text-neutral-500">No conversations in progress.</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  When a campaign is running, live calls stream in here.
                </p>
              </div>
            )}
            {liveCalls.map((c) => {
              const agent = agents.find((a) => a.id === c.agent_id);
              const dur = Math.round((now - new Date(c.started_at).getTime()) / 1000);
              const mm = String(Math.floor(dur / 60)).padStart(2, "0");
              const ss = String(dur % 60).padStart(2, "0");
              const last = c.transcript.at(-1);
              return (
                <div key={c.id} className="px-5 py-4 hover:bg-neutral-50/60 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium text-neutral-900 tabular-nums">
                        {c.phone_to}
                      </p>
                      <p className="text-[11px] text-neutral-500 truncate">
                        via {agent?.name ?? "unassigned"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-mono text-neutral-800 tabular-nums">
                        {mm}:{ss}
                      </span>
                    </div>
                  </div>
                  {last && (
                    <div className="mt-2 pl-3 border-l-2 border-brand-primary/40 text-[12px] text-neutral-700 italic">
                      "{last.text}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dispatcher roster - who's on shift */}
        <div className="lg:col-span-2 rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-neutral-500" strokeWidth={1.75} />
              <h2 className="text-sm font-medium text-neutral-900">Dispatchers on shift</h2>
            </div>
            <span className="text-[10px] font-mono text-neutral-500">{agents.length}</span>
          </div>
          <div className="divide-y divide-neutral-100 max-h-[360px] overflow-y-auto">
            {roster.length === 0 && (
              <div className="px-5 py-12 text-center text-xs text-neutral-500">
                No AI agents configured yet.
              </div>
            )}
            {roster.map(({ agent, inFlight, doneToday }) => (
              <div key={agent.id} className="px-5 py-3 flex items-center gap-3">
                <div
                  className={cn(
                    "size-9 rounded-full grid place-items-center text-[11px] font-mono font-medium ring-1",
                    inFlight > 0
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      : "bg-neutral-100 text-neutral-600 ring-black/5",
                  )}
                >
                  {agent.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 truncate">{agent.name}</p>
                  <p className="text-[11px] text-neutral-500">
                    {inFlight > 0 ? `on call - ${inFlight} line${inFlight === 1 ? "" : "s"}` : "standby"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono text-neutral-900 tabular-nums">{doneToday}</p>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">today</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaign roster with progress bars */}
      <div className="rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200/70 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-900">Campaign roster</h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            {activeCampaigns.length} running / {campaigns.length} total
          </span>
        </div>
        <div className="divide-y divide-neutral-100">
          {campaigns.slice(0, 6).map((c) => {
            const cCalls = calls.filter((x) => x.campaign_id === c.id);
            const cBooked = cCalls.filter((x) => x.appointment_booked).length;
            const cConv = cCalls.length ? (cBooked / cCalls.length) * 100 : 0;
            const agent = agents.find((a) => a.id === c.agent_id);
            return (
              <div key={c.id} className="px-5 py-4 grid grid-cols-1 md:grid-cols-[1.5fr_auto_1fr_1fr] items-center gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{c.name}</p>
                  <p className="text-[11px] text-neutral-500">
                    {agent?.name ?? "unassigned"} - {c.calls_per_minute ?? 0}/min
                  </p>
                </div>
                <StatusPill status={c.status} />
                <div className="min-w-[120px]">
                  <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 mb-1">
                    <span>calls</span>
                    <span className="text-neutral-900 tabular-nums">{cCalls.length}</span>
                  </div>
                  <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className="h-full bg-neutral-800"
                      style={{ width: `${Math.min(100, cCalls.length ? Math.log(cCalls.length + 1) * 22 : 0)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono text-brand-primary tabular-nums">
                    {cCalls.length ? `${cConv.toFixed(1)}%` : "-"}
                  </p>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                    conv
                  </p>
                </div>
              </div>
            );
          })}
          {campaigns.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-xs text-neutral-500">No campaigns yet.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SitrepCell({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
        <Icon className="size-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <p className="mt-2 text-3xl font-mono font-medium tracking-tight text-neutral-900 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-1 text-[11px] font-mono text-neutral-500">{sub}</p>}
    </div>
  );
}

// Unused imports to appease TS if referenced elsewhere.
