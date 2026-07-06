import { useShallow } from "zustand/react/shallow";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Play, Pause, Square, Copy, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatTile, StatusPill } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { useDB } from "@/lib/data-store";

export const Route = createFileRoute("/_app/campaigns/$id")({
  head: () => ({ meta: [{ title: "Campaign — BulkCall AI" }] }),
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const campaign = useDB((s) => s.campaigns.find((c) => c.id === id));
  const agent = useDB((s) => s.agents.find((a) => a.id === campaign?.agent_id));
  const list = useDB((s) => s.lists.find((l) => l.id === campaign?.list_id));
  const phone = useDB((s) => s.phones.find((p) => p.id === campaign?.phone_number_id));
  const calls = useDB((s) => s.calls.filter((c) => c.campaign_id === id));
  const setStatus = useDB((s) => s.setCampaignStatus);
  const duplicate = useDB((s) => s.duplicateCampaign);

  if (!campaign) throw notFound();

  const stats = {
    total: calls.length,
    completed: calls.filter((c) => c.status === "completed").length,
    no_answer: calls.filter((c) => c.status === "no_answer").length,
    busy: calls.filter((c) => c.status === "busy").length,
    failed: calls.filter((c) => c.status === "failed").length,
    voicemail: calls.filter((c) => c.status === "voicemail").length,
    booked: calls.filter((c) => c.appointment_booked).length,
    avgDur: calls.length
      ? Math.round(calls.reduce((s, c) => s + c.duration_sec, 0) / calls.length)
      : 0,
    aiMin: calls.reduce((s, c) => s + c.ai_minutes, 0),
    costCents: calls.reduce((s, c) => s + c.cost_cents, 0),
  };
  const success = stats.total ? ((stats.booked / stats.total) * 100).toFixed(1) + "%" : "—";

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`Created ${new Date(campaign.created_at).toLocaleDateString()} · ${campaign.timezone}`}
        crumb={[
          { label: "Campaigns", to: "/campaigns" },
          { label: campaign.name, to: `/campaigns/${campaign.id}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={campaign.status} />
            {campaign.status === "running" ? (
              <Button size="sm" variant="outline" onClick={() => { setStatus(campaign.id, "paused"); toast.success("Paused"); }}>
                <Pause className="size-3.5 mr-1" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
                onClick={() => { setStatus(campaign.id, "running"); toast.success("Running"); }}
              >
                <Play className="size-3.5 mr-1" /> Launch
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { duplicate(campaign.id); toast.success("Duplicated"); }}>
              <Copy className="size-3.5 mr-1" /> Duplicate
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setStatus(campaign.id, "stopped"); toast.success("Stopped"); }}>
              <Square className="size-3.5 mr-1" /> Stop
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        <StatTile label="Total" value={stats.total} />
        <StatTile label="Completed" value={stats.completed} accent />
        <StatTile label="No Answer" value={stats.no_answer} />
        <StatTile label="Busy" value={stats.busy} />
        <StatTile label="Voicemail" value={stats.voicemail} />
        <StatTile label="Failed" value={stats.failed} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatTile label="Success Rate" value={success} accent />
        <StatTile label="Avg Duration" value={`${stats.avgDur}s`} />
        <StatTile label="AI Minutes" value={stats.aiMin.toFixed(0)} />
        <StatTile label="Cost" value={`$${(stats.costCents / 100).toFixed(2)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <InfoCard title="Agent" body={agent?.name ?? "—"} sub={agent?.voice_name} />
        <InfoCard title="Contact list" body={list?.name ?? "—"} sub={list?.description} />
        <InfoCard title="From number" body={phone?.number ?? "—"} sub={phone?.type ?? ""} />
      </div>

      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-surface-border/60 flex justify-between items-center">
          <h2 className="text-sm font-medium text-zinc-200">Recent calls</h2>
          <Link to="/call-history" className="text-xs text-brand-primary hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                <th className="px-6 py-3 text-left font-medium">Number</th>
                <th className="px-6 py-3 text-left font-medium">Status</th>
                <th className="px-6 py-3 text-left font-medium">Outcome</th>
                <th className="px-6 py-3 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 12).map((c) => (
                <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/20">
                  <td className="px-6 py-3 font-mono text-zinc-300">{c.phone_to}</td>
                  <td className="px-6 py-3 text-zinc-400">{c.status}</td>
                  <td className="px-6 py-3 text-zinc-400">{c.outcome || "—"}</td>
                  <td className="px-6 py-3 text-right font-mono text-zinc-400">{c.duration_sec}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <Button asChild variant="ghost">
          <Link to="/campaigns"><ArrowLeft className="size-3.5 mr-1" /> All campaigns</Link>
        </Button>
      </div>
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
