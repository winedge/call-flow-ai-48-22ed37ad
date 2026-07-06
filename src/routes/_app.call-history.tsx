import { createFileRoute } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useMemo, useState } from "react";
import { Download, Search, FileAudio, FileText } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB, type Call } from "@/lib/data-store";

export const Route = createFileRoute("/_app/call-history")({
  head: () => ({ meta: [{ title: "Call history — BulkCall AI" }] }),
  component: CallHistory,
});

function CallHistory() {
  const orgId = useDB((s) => s.currentOrgId);
  const calls = useDB(useShallow((s) => s.calls.filter((c) => c.org_id === orgId && c.status !== "in_progress"),
  ));
  const agents = useDB((s) => s.agents);
  const campaigns = useDB((s) => s.campaigns);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Call | null>(null);

  const filtered = useMemo(() => {
    return calls
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .filter((c) => !search || c.phone_to.includes(search) || c.outcome.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [calls, statusFilter, search]);

  return (
    <>
      <PageHeader
        title="Call History"
        description={`${calls.length.toLocaleString()} historical calls`}
      />

      <div className="flex gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="no_answer">No answer</SelectItem>
            <SelectItem value="busy">Busy</SelectItem>
            <SelectItem value="voicemail">Voicemail</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone or outcome..." className="pl-9" />
        </div>
      </div>

      <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead>
              <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                <th className="px-4 py-3 text-left font-medium">When</th>
                <th className="px-4 py-3 text-left font-medium">Number</th>
                <th className="px-4 py-3 text-left font-medium">Campaign</th>
                <th className="px-4 py-3 text-left font-medium">Agent</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Outcome</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((c) => {
                const agent = agents.find((a) => a.id === c.agent_id);
                const camp = campaigns.find((x) => x.id === c.campaign_id);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-surface-border/30 hover:bg-zinc-800/30 cursor-pointer"
                    onClick={() => setSelected(c)}
                  >
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                      {new Date(c.started_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-200">{c.phone_to}</td>
                    <td className="px-4 py-3 text-zinc-400">{camp?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-400">{agent?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase tracking-wider font-mono ${
                        c.status === "completed" ? "text-emerald-400" :
                        c.status === "failed" ? "text-red-400" :
                        c.status === "voicemail" ? "text-amber-400" : "text-zinc-500"
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{c.outcome}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">{c.duration_sec}s</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">${(c.cost_cents / 100).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="px-4 py-3 text-xs text-zinc-500 border-t border-surface-border/40">
            Showing latest 100 of {filtered.length.toLocaleString()}
          </div>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>Call · {selected.phone_to}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Pair label="Status" value={selected.status} />
                  <Pair label="Outcome" value={selected.outcome || "—"} />
                  <Pair label="Duration" value={`${selected.duration_sec}s`} />
                  <Pair label="AI minutes" value={selected.ai_minutes.toFixed(2)} />
                  <Pair label="Cost" value={`$${(selected.cost_cents / 100).toFixed(2)}`} />
                  <Pair label="Sentiment" value={selected.sentiment ?? "—"} />
                  <Pair label="Appointment" value={selected.appointment_booked ? "Booked ✓" : "—"} />
                  <Pair label="Twilio SID" value={selected.twilio_call_sid} mono />
                </div>

                {selected.recording_url && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 font-mono">Recording</p>
                    <div className="p-3 bg-zinc-900/60 rounded-lg ring-1 ring-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-zinc-300">
                        <FileAudio className="size-3.5" /> recording.mp3
                      </div>
                      <Button size="sm" variant="outline" onClick={() => toast.info("Streams from Twilio in production")}>
                        <Download className="size-3.5 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                )}

                {selected.summary && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 font-mono">AI Summary</p>
                    <p className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-3 ring-1 ring-white/5">{selected.summary}</p>
                  </div>
                )}

                {selected.transcript.length > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">Transcript</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const text = selected.transcript.map(t => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
                          const blob = new Blob([text], { type: "text/plain" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `transcript-${selected.id.slice(0, 8)}.txt`;
                          a.click();
                        }}
                      >
                        <FileText className="size-3.5 mr-1" /> Download
                      </Button>
                    </div>
                    <div className="bg-zinc-950/40 rounded-lg p-3 ring-1 ring-white/5 space-y-2 max-h-96 overflow-y-auto">
                      {selected.transcript.map((t, i) => (
                        <div key={i} className="text-xs font-mono">
                          <span className={t.speaker === "ai" ? "text-brand-primary" : "text-zinc-400"}>
                            {t.speaker === "ai" ? "AI" : "USR"} ›
                          </span>{" "}
                          <span className="text-zinc-200">{t.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Pair({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mb-1">{label}</p>
      <p className={`text-zinc-200 ${mono ? "font-mono truncate text-[11px]" : ""}`}>{value}</p>
    </div>
  );
}
