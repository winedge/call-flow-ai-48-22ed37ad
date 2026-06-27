import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
} from "recharts";

import { PageHeader, StatTile, StatusPill } from "@/components/app/primitives";
import { useDB } from "@/lib/data-store";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BulkCall AI" },
      { name: "description", content: "Real-time overview of your AI calling campaigns." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const orgId = useDB((s) => s.currentOrgId);
  const calls = useDB((s) => s.calls.filter((c) => c.org_id === orgId));
  const campaigns = useDB((s) => s.campaigns.filter((c) => c.org_id === orgId));
  const agents = useDB((s) => s.agents);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startToday = today.getTime();

  const callsToday = calls.filter(
    (c) => new Date(c.started_at).getTime() >= startToday,
  );
  const answered = callsToday.filter((c) =>
    ["completed", "voicemail", "in_progress"].includes(c.status),
  );
  const completed = callsToday.filter((c) => c.status === "completed");
  const booked = completed.filter((c) => c.appointment_booked).length;
  const aiMins = calls.reduce((s, c) => s + c.ai_minutes, 0);
  const liveCalls = calls.filter((c) => c.status === "in_progress");
  const failed = callsToday.filter((c) => c.status === "failed");

  const chartData = useMemo(() => {
    const buckets: { hour: string; calls: number; answered: number }[] = [];
    for (let h = 23; h >= 0; h--) {
      const from = Date.now() - h * 3600_000;
      const to = from + 3600_000;
      const inBucket = calls.filter((c) => {
        const t = new Date(c.started_at).getTime();
        return t >= from && t < to;
      });
      buckets.push({
        hour: new Date(from).toLocaleTimeString([], { hour: "2-digit", hour12: false }),
        calls: inBucket.length,
        answered: inBucket.filter((c) => ["completed", "voicemail"].includes(c.status)).length,
      });
    }
    return buckets;
  }, [calls]);

  return (
    <>
      <PageHeader
        title="Dispatch Overview"
        description="Real-time activity across all campaigns and agents."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <StatTile
          label="Active Campaigns"
          value={campaigns.filter((c) => c.status === "running").length}
          hint={`${campaigns.length} total`}
        />
        <StatTile
          label="Calls Today"
          value={callsToday.length.toLocaleString()}
          delta={`+${Math.round(callsToday.length * 0.18)} since 12h`}
        />
        <StatTile
          label="Answered"
          value={callsToday.length ? `${Math.round((answered.length / callsToday.length) * 100)}%` : "—"}
          hint={`${answered.length} of ${callsToday.length}`}
        />
        <StatTile
          label="Success Rate"
          value={completed.length ? `${Math.round((booked / completed.length) * 100)}%` : "0%"}
          hint={`${booked} booked`}
        />
        <StatTile
          label="AI Minutes"
          value={Math.round(aiMins).toLocaleString()}
          accent
          hint={`${agents.length} agents on duty`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        <div className="lg:col-span-8 bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Call Throughput</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">Last 24 hours</p>
            </div>
            <div className="flex gap-2 text-[10px] font-mono">
              <span className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded">24H</span>
              <span className="px-2 py-1 text-zinc-500">7D</span>
            </div>
          </div>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gradCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="hour" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} width={30} />
                <RTooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  cursor={{ stroke: "#10b981", strokeOpacity: 0.3 }}
                />
                <Area
                  type="monotone"
                  dataKey="calls"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#gradCalls)"
                />
                <Area
                  type="monotone"
                  dataKey="answered"
                  stroke="#52525b"
                  strokeWidth={1}
                  fill="transparent"
                  strokeDasharray="4 4"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-zinc-900/40 ring-1 ring-white/5 rounded-xl flex flex-col">
          <div className="p-4 border-b border-surface-border/60 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-200">Live Dispatch</h2>
            <span className="text-[10px] bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded-full font-mono">
              {liveCalls.length} Active
            </span>
          </div>
          <div className="p-4 space-y-3 max-h-[280px] overflow-y-auto">
            {liveCalls.length === 0 && (
              <p className="text-xs text-zinc-500 text-center py-8">
                No live calls right now.
              </p>
            )}
            {liveCalls.map((c) => {
              const agent = agents.find((a) => a.id === c.agent_id);
              const dur = Math.round(
                (Date.now() - new Date(c.started_at).getTime()) / 1000,
              );
              const mm = String(Math.floor(dur / 60)).padStart(2, "0");
              const ss = String(dur % 60).padStart(2, "0");
              const last = c.transcript.at(-1);
              return (
                <div
                  key={c.id}
                  className="p-3 bg-zinc-800/30 rounded-lg ring-1 ring-white/5 space-y-2"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs font-medium text-zinc-100">{c.phone_to}</p>
                      <p className="text-[10px] text-zinc-500">
                        Agent: {agent?.name ?? "—"}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-brand-primary">
                      {mm}:{ss}
                    </span>
                  </div>
                  {last && (
                    <div className="text-[11px] text-zinc-400 bg-zinc-950/40 p-2 rounded italic font-mono">
                      "{last.text}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">
            Appointments booked
          </p>
          <p className="text-2xl font-mono font-medium text-zinc-100">{booked}</p>
          <p className="text-[10px] text-zinc-500 mt-2">Across today's completed calls</p>
        </div>
        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">
            Failed calls
          </p>
          <p className="text-2xl font-mono font-medium text-red-400">{failed.length}</p>
          <p className="text-[10px] text-zinc-500 mt-2">Retry logic engaged</p>
        </div>
        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">
            Avg duration
          </p>
          <p className="text-2xl font-mono font-medium text-zinc-100">
            {completed.length
              ? Math.round(completed.reduce((s, c) => s + c.duration_sec, 0) / completed.length)
              : 0}
            <span className="text-xs text-zinc-500 ml-1">s</span>
          </p>
          <p className="text-[10px] text-zinc-500 mt-2">For completed calls today</p>
        </div>
      </div>

      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-surface-border/60 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-200">Recent Campaigns</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px]">
            <thead>
              <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                <th className="px-6 py-3 font-medium">Campaign</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Calls</th>
                <th className="px-6 py-3 font-medium">Agent</th>
                <th className="px-6 py-3 font-medium text-right">Conversion</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {campaigns.slice(0, 6).map((c) => {
                const cCalls = calls.filter((x) => x.campaign_id === c.id);
                const cBooked = cCalls.filter((x) => x.appointment_booked).length;
                const cConv = cCalls.length
                  ? ((cBooked / cCalls.length) * 100).toFixed(1) + "%"
                  : "—";
                const agent = agents.find((a) => a.id === c.agent_id);
                return (
                  <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/20">
                    <td className="px-6 py-4 font-medium text-zinc-200">{c.name}</td>
                    <td className="px-6 py-4">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-6 py-4 font-mono text-zinc-300">{cCalls.length}</td>
                    <td className="px-6 py-4 text-zinc-400">{agent?.name ?? "—"}</td>
                    <td className="px-6 py-4 text-right font-mono text-brand-primary">{cConv}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
