import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Play, Pause, Square, Copy, ArrowLeft, Download, Radio } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

import { PageHeader, StatTile, StatusPill } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDB } from "@/lib/data-store";
import { computeCampaignMetrics, formatEta, formatDuration, callsToCsv, downloadFile, leadScore } from "@/lib/reporting";
import { endReasonLabel, END_REASON_ORDER, END_REASON_TONE } from "@/lib/voice/call-end-reasons";

const END_REASON_FILL: Record<string, string> = {
  green: "#22c55e",
  amber: "#f59e0b",
  blue: "#38bdf8",
  red: "#ef4444",
  gray: "#64748b",
};

export const Route = createFileRoute("/_app/campaigns/$id")({
  head: () => ({ meta: [{ title: "Campaign — BulkCall AI" }] }),
  component: CampaignDetail,
});

const OUTCOME_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];

function CampaignDetail() {
  const { id } = Route.useParams();
  const campaign = useDB((s) => s.campaigns.find((c) => c.id === id));
  const agent = useDB((s) => s.agents.find((a) => a.id === campaign?.agent_id));
  const list = useDB((s) => s.lists.find((l) => l.id === campaign?.list_id));
  const phone = useDB((s) => s.phones.find((p) => p.id === campaign?.phone_number_id));
  const calls = useDB(useShallow((s) => s.calls.filter((c) => c.campaign_id === id)));
  const contacts = useDB(useShallow((s) => s.contacts.filter((c) => c.list_id === campaign?.list_id)));
  const setStatus = useDB((s) => s.setCampaignStatus);
  const duplicate = useDB((s) => s.duplicateCampaign);

  if (!campaign) throw notFound();
  const cmp = campaign;


  const metrics = useMemo(
    () => computeCampaignMetrics(cmp, calls, contacts),
    [cmp, calls, contacts],
  );

  const liveCalls = useMemo(
    () => calls.filter((c) => c.status === "in_progress" || c.status === "dialing"),
    [calls],
  );

  const outcomeData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calls) {
      const key = c.outcome || (c.status === "completed" ? "no outcome" : c.status);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [calls]);

  const statusData = [
    { name: "Answered", value: metrics.answered, fill: "#22c55e" },
    { name: "Voicemail", value: metrics.voicemail, fill: "#f59e0b" },
    { name: "No answer", value: metrics.noAnswer, fill: "#64748b" },
    { name: "Busy", value: metrics.busy, fill: "#a855f7" },
    { name: "Failed", value: metrics.failed, fill: "#ef4444" },
  ].filter((d) => d.value > 0);

  const endReasonData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calls) {
      if (!c.end_reason) continue;
      map.set(c.end_reason, (map.get(c.end_reason) ?? 0) + 1);
    }
    return END_REASON_ORDER
      .filter((r) => map.has(r))
      .map((r) => ({
        name: endReasonLabel(r),
        value: map.get(r)!,
        fill: END_REASON_FILL[END_REASON_TONE[r]],
      }));
  }, [calls]);

  const hourlyData = useMemo(() => {
    const bins: Record<string, { hour: string; calls: number; answered: number }> = {};
    for (const c of calls) {
      const d = new Date(c.started_at);
      const key = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
      const bin = bins[key] ?? { hour: key, calls: 0, answered: 0 };
      bin.calls++;
      if (c.status === "completed" || c.status === "voicemail") bin.answered++;
      bins[key] = bin;
    }
    return Object.values(bins).slice(-24);
  }, [calls]);

  function exportCallsCsv() {
    if (calls.length === 0) return toast.info("No calls yet to export");
    const rows = calls.map((c) => ({
      started_at: c.started_at,
      phone: c.phone_to,
      status: c.status,
      end_reason: c.end_reason ?? "",
      outcome: c.outcome,
      duration_sec: c.duration_sec,
      ai_minutes: c.ai_minutes,
      cost_usd: (c.cost_cents / 100).toFixed(2),
      sentiment: c.sentiment ?? "",
      appointment_booked: c.appointment_booked,
      lead_score: leadScore(c),
      summary: c.summary,
    }));
    downloadFile(callsToCsv(rows), `${cmp.name.replace(/\s+/g, "_")}_calls.csv`);
    toast.success("CSV exported");
  }

  function exportReport() {
    const rows = [
      ["Campaign", cmp.name],
      ["Status", cmp.status],
      ["Created", new Date(cmp.created_at).toLocaleString()],
      ["First call", metrics.firstAt ? new Date(metrics.firstAt).toLocaleString() : "—"],
      ["Last call", metrics.lastAt ? new Date(metrics.lastAt).toLocaleString() : "—"],
      ["Total contacts", metrics.totalContacts],
      ["Calls placed", metrics.placed],
      ["Calls answered", metrics.answered],
      ["Answer rate", `${metrics.answerRate.toFixed(1)}%`],
      ["Completion rate", `${metrics.completionRate.toFixed(1)}%`],
      ["Success rate", `${metrics.successRate.toFixed(1)}%`],
      ["Avg duration", formatDuration(metrics.avgDur)],
      ["AI minutes", metrics.aiMinutes.toFixed(1)],
      ["Total cost", `$${(metrics.costCents / 100).toFixed(2)}`],
      ["Appointments booked", metrics.booked],
      ["Qualified leads", metrics.qualified],
      ["Callbacks requested", metrics.callbacks],
      ["Voicemails", metrics.voicemail],
      ["No answer", metrics.noAnswer],
      ["Busy", metrics.busy],
      ["Failed", metrics.failed],
    ];
    const csv = rows.map(([k, v]) => `${k},${String(v).replace(/,/g, ";")}`).join("\n");
    downloadFile(csv, `${cmp.name.replace(/\s+/g, "_")}_report.csv`);
    toast.success("Report exported");
  }

  return (
    <>
      <PageHeader
        title={cmp.name}
        description={`Created ${new Date(cmp.created_at).toLocaleDateString()} · ${cmp.timezone}`}
        crumb={[
          { label: "Campaigns", to: "/campaigns" },
          { label: cmp.name, to: `/campaigns/${cmp.id}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={cmp.status} />
            {cmp.status === "running" ? (
              <Button size="sm" variant="outline" onClick={() => { setStatus(cmp.id, "paused"); toast.success("Paused"); }}>
                <Pause className="size-3.5 mr-1" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
                onClick={() => { setStatus(cmp.id, "running"); toast.success("Running"); }}
              >
                <Play className="size-3.5 mr-1" /> {cmp.status === "paused" ? "Resume" : "Launch"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { duplicate(cmp.id); toast.success("Duplicated"); }}>
              <Copy className="size-3.5 mr-1" /> Duplicate
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setStatus(cmp.id, "stopped"); toast.success("Stopped"); }}>
              <Square className="size-3.5 mr-1" /> Stop
            </Button>
          </div>
        }
      />

      {/* Progress + ETA banner */}
      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">Campaign progress</p>
            <p className="text-lg font-medium text-zinc-100">
              {metrics.placed.toLocaleString()} / {metrics.totalContacts.toLocaleString()} calls
              <span className="text-zinc-500 text-sm font-mono ml-2">({metrics.completionRate.toFixed(1)}%)</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">Est. remaining</p>
            <p className="text-lg font-mono text-brand-primary">{formatEta(metrics.etaMinutes)}</p>
          </div>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-primary transition-all"
            style={{ width: `${Math.min(100, metrics.completionRate)}%` }}
          />
        </div>
      </div>

      <Tabs defaultValue="live" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="live">
            {liveCalls.length > 0 && (
              <span className="size-1.5 rounded-full bg-brand-primary animate-pulse mr-1.5" />
            )}
            Live Monitor
          </TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="calls">Call History</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>

        {/* ============ LIVE MONITOR ============ */}
        <TabsContent value="live" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatTile label="Contacts" value={metrics.totalContacts.toLocaleString()} />
            <StatTile label="Placed" value={metrics.placed.toLocaleString()} accent />
            <StatTile label="In progress" value={metrics.inProgress} />
            <StatTile label="Queued" value={metrics.queued.toLocaleString()} />
            <StatTile label="Answered" value={metrics.answered} />
            <StatTile label="No answer" value={metrics.noAnswer} />
            <StatTile label="Voicemail" value={metrics.voicemail} />
            <StatTile label="Busy" value={metrics.busy} />
            <StatTile label="Failed" value={metrics.failed} />
            <StatTile label="Callbacks" value={metrics.callbacks} />
            <StatTile label="Appointments" value={metrics.booked} accent />
            <StatTile label="Qualified" value={metrics.qualified} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Success rate" value={`${metrics.successRate.toFixed(1)}%`} accent />
            <StatTile label="Answer rate" value={`${metrics.answerRate.toFixed(1)}%`} />
            <StatTile label="Avg duration" value={formatDuration(metrics.avgDur)} />
            <StatTile label="Credits used" value={`$${(metrics.costCents / 100).toFixed(2)}`} hint={`${metrics.aiMinutes.toFixed(1)} AI min`} />
          </div>

          {/* Live calls stream */}
          <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-surface-border/60 flex justify-between items-center">
              <h2 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                <Radio className="size-3.5 text-brand-primary" />
                Active calls
                {liveCalls.length > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/30">
                    {liveCalls.length}
                  </span>
                )}
              </h2>
              <Link to="/live-calls" className="text-xs text-brand-primary hover:underline">Open full monitor →</Link>
            </div>
            {liveCalls.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No calls in flight. When campaigns are running, live calls stream here automatically.
              </div>
            ) : (
              <div className="divide-y divide-surface-border/30">
                {liveCalls.map((c) => {
                  const dur = Math.round((Date.now() - new Date(c.started_at).getTime()) / 1000);
                  return (
                    <Link to="/calls/$id" params={{ id: c.id }} key={c.id} className="p-4 flex items-center gap-4 hover:bg-zinc-800/30 transition-colors">
                      <div className="size-2 rounded-full bg-brand-primary animate-pulse" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm text-zinc-100">{c.phone_to}</p>
                        <p className="text-[11px] text-zinc-500">{c.status}</p>
                      </div>
                      <p className="font-mono text-sm text-brand-primary">{formatDuration(dur)}</p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ============ REPORTS ============ */}
        <TabsContent value="reports" className="space-y-6">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={exportReport}>
              <Download className="size-3.5 mr-1" /> Report CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportCallsCsv}>
              <Download className="size-3.5 mr-1" /> Calls CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Download className="size-3.5 mr-1" /> Print / PDF
            </Button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
              <h3 className="text-sm font-medium text-zinc-200 mb-4">Overview</h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <ReportRow label="Started" value={metrics.firstAt ? new Date(metrics.firstAt).toLocaleString() : "—"} />
                <ReportRow label="Last activity" value={metrics.lastAt ? new Date(metrics.lastAt).toLocaleString() : "—"} />
                <ReportRow label="Total contacts" value={metrics.totalContacts.toLocaleString()} />
                <ReportRow label="Calls placed" value={metrics.placed.toLocaleString()} />
                <ReportRow label="Answer rate" value={`${metrics.answerRate.toFixed(1)}%`} />
                <ReportRow label="Completion rate" value={`${metrics.completionRate.toFixed(1)}%`} />
                <ReportRow label="Avg duration" value={formatDuration(metrics.avgDur)} />
                <ReportRow label="Total cost" value={`$${(metrics.costCents / 100).toFixed(2)}`} />
                <ReportRow label="AI minutes" value={metrics.aiMinutes.toFixed(1)} />
                <ReportRow label="Appointments" value={metrics.booked.toLocaleString()} />
                <ReportRow label="Qualified" value={metrics.qualified.toLocaleString()} />
                <ReportRow label="Callbacks" value={metrics.callbacks.toLocaleString()} />
              </dl>
            </div>

            <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
              <h3 className="text-sm font-medium text-zinc-200 mb-4">Call status breakdown</h3>
              {statusData.length === 0 ? (
                <div className="h-64 grid place-items-center text-xs text-zinc-500">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} label>
                      {statusData.map((_, i) => <Cell key={i} fill={statusData[i].fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 md:col-span-2">
              <h3 className="text-sm font-medium text-zinc-200 mb-4">Outcome breakdown</h3>
              {outcomeData.length === 0 ? (
                <div className="h-56 grid place-items-center text-xs text-zinc-500">No outcomes recorded yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={outcomeData}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} />
                    <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {outcomeData.map((_, i) => <Cell key={i} fill={OUTCOME_COLORS[i % OUTCOME_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 md:col-span-2">
              <h3 className="text-sm font-medium text-zinc-200 mb-4">Why calls ended</h3>
              {endReasonData.length === 0 ? (
                <div className="h-56 grid place-items-center text-xs text-zinc-500">
                  No end reasons recorded yet — they appear once the AI, transfer, voicemail, or timeout logic fires on a live call.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={endReasonData}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {endReasonData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>


            {hourlyData.length > 1 && (
              <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 md:col-span-2">
                <h3 className="text-sm font-medium text-zinc-200 mb-4">Call volume over time</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis dataKey="hour" stroke="#71717a" fontSize={11} />
                    <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="calls" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="answered" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ============ CALL HISTORY ============ */}
        <TabsContent value="calls" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-zinc-500">{calls.length.toLocaleString()} calls</p>
            <Button size="sm" variant="outline" onClick={exportCallsCsv}>
              <Download className="size-3.5 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[860px]">
                <thead>
                  <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                    <th className="px-4 py-3 text-left font-medium">When</th>
                    <th className="px-4 py-3 text-left font-medium">Number</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">End reason</th>
                    <th className="px-4 py-3 text-left font-medium">Outcome</th>
                    <th className="px-4 py-3 text-left font-medium">Sentiment</th>
                    <th className="px-4 py-3 text-right font-medium">Duration</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">No calls yet</td></tr>
                  ) : (
                    calls.slice(0, 200).map((c) => (
                      <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/20">
                        <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                          {new Date(c.started_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-200">
                          <Link to="/calls/$id" params={{ id: c.id }} className="hover:text-brand-primary">{c.phone_to}</Link>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.status}</td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">{endReasonLabel(c.end_reason)}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.outcome || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.sentiment ?? "—"}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-400">{formatDuration(c.duration_sec)}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{leadScore(c)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ============ CONFIG ============ */}
        <TabsContent value="config" className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-6">
            <InfoCard title="Agent" body={agent?.name ?? "—"} sub={agent?.voice_name} />
            <InfoCard title="Contact list" body={list?.name ?? "—"} sub={list?.description} />
            <InfoCard title="From number" body={phone?.number ?? "—"} sub={phone?.type ?? ""} />
            <InfoCard title="Timezone" body={cmp.timezone} sub={`${cmp.calling_hours.start}–${cmp.calling_hours.end}`} />
            <InfoCard title="Pace" body={`${cmp.calls_per_minute} calls/min`} />
            <InfoCard title="Retries" body={`${cmp.retry_rules.max_attempts}× · ${cmp.retry_rules.gap_minutes}m gap`} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-8">
        <Button asChild variant="ghost">
          <Link to="/campaigns"><ArrowLeft className="size-3.5 mr-1" /> All campaigns</Link>
        </Button>
      </div>
    </>
  );
}

function ReportRow({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt className="text-zinc-500 uppercase tracking-wider text-[10px] font-mono">{label}</dt>
      <dd className="text-zinc-200 font-mono text-right">{value}</dd>
    </>
  );
}

function InfoCard({ title, body, sub }: { title: string; body: string; sub?: string }) {
  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 font-mono">{title}</p>
      <p className="text-sm font-medium text-zinc-200">{body}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}
