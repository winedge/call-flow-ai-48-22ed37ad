import { useShallow } from "zustand/react/shallow";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Megaphone, Play, Pause, Square, Copy } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState, StatusPill } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDB } from "@/lib/data-store";

export const Route = createFileRoute("/_app/campaigns/")({
  head: () => ({ meta: [{ title: "Campaigns — BulkCall AI" }] }),
  component: CampaignsList,
});

function CampaignsList() {
  const orgId = useDB((s) => s.currentOrgId);
  const campaigns = useDB(useShallow((s) => s.campaigns.filter((c) => c.org_id === orgId)));
  const agents = useDB((s) => s.agents);
  const calls = useDB((s) => s.calls);
  const setStatus = useDB((s) => s.setCampaignStatus);
  const duplicate = useDB((s) => s.duplicateCampaign);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Launch, pause, and monitor outbound calling campaigns."
        actions={
          <Button asChild className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            <Link to="/campaigns/new">
              <Plus className="size-4 mr-1" /> New Campaign
            </Link>
          </Button>
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create your first campaign to start dispatching AI-driven calls."
          action={
            <Button asChild className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
              <Link to="/campaigns/new">
                <Plus className="size-4 mr-1" /> New Campaign
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                  <th className="px-6 py-3 font-medium">Campaign</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Agent</th>
                  <th className="px-6 py-3 font-medium">Calls</th>
                  <th className="px-6 py-3 font-medium">Connected</th>
                  <th className="px-6 py-3 font-medium">Conversion</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {campaigns.map((c) => {
                  const cCalls = calls.filter((x) => x.campaign_id === c.id);
                  const connected = cCalls.filter((x) => x.status === "completed").length;
                  const booked = cCalls.filter((x) => x.appointment_booked).length;
                  const conv = cCalls.length
                    ? ((booked / cCalls.length) * 100).toFixed(1) + "%"
                    : "—";
                  const agent = agents.find((a) => a.id === c.agent_id);
                  return (
                    <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/20">
                      <td className="px-6 py-4">
                        <Link
                          to="/campaigns/$id"
                          params={{ id: c.id }}
                          className="font-medium text-zinc-200 hover:text-brand-primary"
                        >
                          {c.name}
                        </Link>
                        <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                          {c.calls_per_minute}/min · {c.timezone}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-6 py-4 text-zinc-400">{agent?.name ?? "—"}</td>
                      <td className="px-6 py-4 font-mono text-zinc-300">{cCalls.length}</td>
                      <td className="px-6 py-4 font-mono text-zinc-300">{connected}</td>
                      <td className="px-6 py-4 font-mono text-brand-primary">{conv}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          {c.status === "running" ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setStatus(c.id, "paused");
                                toast.success(`${c.name} paused`);
                              }}
                            >
                              <Pause className="size-3.5" />
                            </Button>
                          ) : c.status === "paused" || c.status === "draft" ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setStatus(c.id, "running");
                                toast.success(`${c.name} launched`);
                              }}
                            >
                              <Play className="size-3.5 text-brand-primary" />
                            </Button>
                          ) : null}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost">
                                <span className="text-lg leading-none text-zinc-500">⋯</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => duplicate(c.id)}>
                                <Copy className="size-3.5 mr-2" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setStatus(c.id, "stopped");
                                  toast.success(`${c.name} stopped`);
                                }}
                                className="text-red-400"
                              >
                                <Square className="size-3.5 mr-2" /> Stop
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
