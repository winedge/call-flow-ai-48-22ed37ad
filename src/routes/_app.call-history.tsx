import { createFileRoute, Link } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDB } from "@/lib/data-store";
import { callsToCsv, downloadFile, formatDuration, leadScore } from "@/lib/reporting";
import { endReasonLabel, endReasonTone, END_REASON_ORDER } from "@/lib/voice/call-end-reasons";

const TONE_CLASS: Record<"green" | "amber" | "blue" | "red" | "gray", string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  blue: "text-sky-400",
  red: "text-red-400",
  gray: "text-zinc-500",
};

export const Route = createFileRoute("/_app/call-history")({
  head: () => ({ meta: [{ title: "Call history — BulkCall AI" }] }),
  component: CallHistory,
});

function CallHistory() {
  const orgId = useDB((s) => s.currentOrgId);
  const calls = useDB(useShallow((s) => s.calls.filter((c) => c.org_id === orgId)));
  const agents = useDB((s) => s.agents);
  const campaigns = useDB((s) => s.campaigns);
  const contacts = useDB((s) => s.contacts);

  const [statusFilter, setStatusFilter] = useState("all");
  const [endReasonFilter, setEndReasonFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [leadFilter, setLeadFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toMs = dateTo ? new Date(dateTo).getTime() + 86_400_000 : Infinity;
    return calls
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .filter((c) => endReasonFilter === "all" || (c.end_reason ?? "") === endReasonFilter)
      .filter((c) => campaignFilter === "all" || c.campaign_id === campaignFilter)
      .filter((c) => agentFilter === "all" || c.agent_id === agentFilter)
      .filter((c) => sentimentFilter === "all" || c.sentiment === sentimentFilter)
      .filter((c) => {
        if (leadFilter === "all") return true;
        if (leadFilter === "qualified") return (c.outcome || "").toLowerCase().includes("qualified") || (c.outcome || "").toLowerCase().includes("interested");
        if (leadFilter === "appointment") return c.appointment_booked;
        if (leadFilter === "dnc") return (c.outcome || "").toLowerCase().includes("dnc") || (c.outcome || "").toLowerCase().includes("not interested");
        return true;
      })
      .filter((c) => {
        const t = new Date(c.started_at).getTime();
        return t >= fromMs && t <= toMs;
      })
      .filter((c) => {
        if (!q) return true;
        const contact = contacts.find((x) => x.id === c.contact_id);
        return (
          c.phone_to.includes(q) ||
          (c.outcome || "").toLowerCase().includes(q) ||
          (contact?.name || "").toLowerCase().includes(q) ||
          (contact?.company || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [calls, statusFilter, endReasonFilter, campaignFilter, agentFilter, sentimentFilter, leadFilter, dateFrom, dateTo, search, contacts]);

  const orgCampaigns = campaigns.filter((c) => c.org_id === orgId);
  const orgAgents = agents.filter((a) => a.org_id === orgId);

  function exportCsv() {
    if (filtered.length === 0) return toast.info("Nothing to export");
    const rows = filtered.map((c) => {
      const contact = contacts.find((x) => x.id === c.contact_id);
      const agent = agents.find((a) => a.id === c.agent_id);
      const camp = campaigns.find((x) => x.id === c.campaign_id);
      return {
        started_at: c.started_at,
        contact_name: contact?.name ?? "",
        phone: c.phone_to,
        campaign: camp?.name ?? "",
        agent: agent?.name ?? "",
        status: c.status,
        end_reason: c.end_reason ?? "",
        outcome: c.outcome,
        sentiment: c.sentiment ?? "",
        duration_sec: c.duration_sec,
        ai_minutes: c.ai_minutes,
        cost_usd: (c.cost_cents / 100).toFixed(2),
        appointment_booked: c.appointment_booked,
        lead_score: leadScore(c),
      };
    });
    downloadFile(callsToCsv(rows), `call-history-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${filtered.length} calls`);
  }

  function resetFilters() {
    setStatusFilter("all");
    setEndReasonFilter("all");
    setCampaignFilter("all");
    setAgentFilter("all");
    setSentimentFilter("all");
    setLeadFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  return (
    <>
      <PageHeader
        title="Call History"
        description={`${filtered.length.toLocaleString()} of ${calls.length.toLocaleString()} calls`}
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="size-3.5 mr-1" /> Export CSV
          </Button>
        }
      />

      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="no_answer">No answer</SelectItem>
              <SelectItem value="busy">Busy</SelectItem>
              <SelectItem value="voicemail">Voicemail</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={endReasonFilter} onValueChange={setEndReasonFilter}>
            <SelectTrigger><SelectValue placeholder="End reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All end reasons</SelectItem>
              {END_REASON_ORDER.map((r) => (
                <SelectItem key={r} value={r}>{endReasonLabel(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger><SelectValue placeholder="Campaign" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {orgCampaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {orgAgents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
            <SelectTrigger><SelectValue placeholder="Sentiment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sentiment</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          <Select value={leadFilter} onValueChange={setLeadFilter}>
            <SelectTrigger><SelectValue placeholder="Lead status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leads</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="appointment">Booked</SelectItem>
              <SelectItem value="dnc">Not interested / DNC</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={resetFilters}>Reset filters</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
          <div className="relative">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, company, outcome…" className="pl-9" />
          </div>
        </div>
      </div>

      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[1000px]">
            <thead>
              <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                <th className="px-4 py-3 text-left font-medium">When</th>
                <th className="px-4 py-3 text-left font-medium">Contact</th>
                <th className="px-4 py-3 text-left font-medium">Number</th>
                <th className="px-4 py-3 text-left font-medium">Campaign</th>
                <th className="px-4 py-3 text-left font-medium">Agent</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">End reason</th>
                <th className="px-4 py-3 text-left font-medium">Sentiment</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-xs text-zinc-500">No calls match your filters.</td></tr>
              ) : (
                filtered.slice(0, 200).map((c) => {
                  const agent = agents.find((a) => a.id === c.agent_id);
                  const camp = campaigns.find((x) => x.id === c.campaign_id);
                  const contact = contacts.find((x) => x.id === c.contact_id);
                  return (
                    <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-400 font-mono text-xs whitespace-nowrap">
                        {new Date(c.started_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-4 py-3 text-zinc-200">
                        <Link to="/calls/$id" params={{ id: c.id }} className="hover:text-brand-primary">
                          {contact?.name || <span className="text-zinc-500 italic">Unknown</span>}
                        </Link>
                        {contact?.company && <p className="text-[10px] text-zinc-500">{contact.company}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-300">{c.phone_to}</td>
                      <td className="px-4 py-3 text-zinc-400 truncate max-w-[160px]">{camp?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-400 truncate max-w-[120px]">{agent?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] uppercase tracking-wider font-mono ${
                          c.status === "completed" ? "text-emerald-400" :
                          c.status === "failed" ? "text-red-400" :
                          c.status === "voicemail" ? "text-amber-400" :
                          c.status === "in_progress" ? "text-brand-primary" : "text-zinc-500"
                        }`}>{c.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] uppercase tracking-wider font-mono ${TONE_CLASS[endReasonTone(c.end_reason)]}`}>
                          {endReasonLabel(c.end_reason)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{c.sentiment ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400">{formatDuration(c.duration_sec)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{leadScore(c)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400">${(c.cost_cents / 100).toFixed(2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && (
          <div className="px-4 py-3 text-xs text-zinc-500 border-t border-surface-border/40">
            Showing latest 200 of {filtered.length.toLocaleString()} — refine filters or export to CSV to see the rest.
          </div>
        )}
      </div>
    </>
  );
}
