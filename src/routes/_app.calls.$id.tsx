import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileText, Play, Star, User, Building2, Phone as PhoneIcon, Mail, Calendar, Tag, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatTile } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useDB } from "@/lib/data-store";
import { downloadFile, formatDuration, leadScore } from "@/lib/reporting";
import { endReasonLabel } from "@/lib/voice/call-end-reasons";
import { SentimentBadge, sentimentLabel } from "@/components/app/sentiment-badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/calls/$id")({
  head: () => ({ meta: [{ title: "Call - BulkCall AI" }] }),
  component: CallDetail,
});

type LocalNotes = { notes: string; tags: string[]; next_action: string };

function loadLocal(id: string): LocalNotes {
  if (typeof window === "undefined") return { notes: "", tags: [], next_action: "" };
  try {
    return JSON.parse(localStorage.getItem(`call-notes:${id}`) || "") as LocalNotes;
  } catch {
    return { notes: "", tags: [], next_action: "" };
  }
}
function saveLocal(id: string, v: LocalNotes) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`call-notes:${id}`, JSON.stringify(v));
}

function CallDetail() {
  const { id } = Route.useParams();
  const call = useDB((s) => s.calls.find((c) => c.id === id));
  const contact = useDB((s) => s.contacts.find((c) => c.id === call?.contact_id));
  const agent = useDB((s) => s.agents.find((a) => a.id === call?.agent_id));
  const campaign = useDB((s) => s.campaigns.find((c) => c.id === call?.campaign_id));

  const [local, setLocal] = useState<LocalNotes>({ notes: "", tags: [], next_action: "" });
  const [tagInput, setTagInput] = useState("");
  const [recordingSrc, setRecordingSrc] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    if (id) setLocal(loadLocal(id));
  }, [id]);

  useEffect(() => {
    if (!call?.recording_url || !id) {
      setRecordingSrc(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) {
          setRecordingError("Please sign in to play recordings.");
          return;
        }
        const res = await fetch(`/api/calls/${id}/recording`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setRecordingError(`Recording unavailable (${res.status})`);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setRecordingSrc(objectUrl);
        setRecordingError(null);
      } catch (e) {
        setRecordingError(e instanceof Error ? e.message : "Failed to load recording");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [call?.recording_url, id]);

  if (!call) throw notFound();

  const score = leadScore(call);
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-neutral-500";

  const updateLocal = (patch: Partial<LocalNotes>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    saveLocal(id, next);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || local.tags.includes(t)) { setTagInput(""); return; }
    updateLocal({ tags: [...local.tags, t] });
    setTagInput("");
  };

  const removeTag = (t: string) => updateLocal({ tags: local.tags.filter((x) => x !== t) });

  const downloadTranscript = () => {
    if (call.transcript.length === 0) return toast.info("No transcript to download");
    const text = [
      `Call ${call.id}`,
      `Contact: ${contact?.name ?? "Unknown"} - ${call.phone_to}`,
      `Started: ${new Date(call.started_at).toLocaleString()}`,
      `Duration: ${formatDuration(call.duration_sec)}`,
      `Agent: ${agent?.name ?? "-"}`,
      `Campaign: ${campaign?.name ?? "-"}`,
      "",
      "TRANSCRIPT",
      ...call.transcript.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`),
      "",
      call.summary ? `SUMMARY\n${call.summary}` : "",
    ].join("\n");
    downloadFile(text, `transcript-${call.id.slice(0, 8)}.txt`, "text/plain;charset=utf-8");
  };

  // Structured extraction: prefer per-agent field definitions when present,
  // otherwise fall back to whatever contact metadata we already know.
  const agentFields = agent?.data_fields ?? [];
  const extractedByLabel: { label: string; value: string }[] = [];
  if (agentFields.length > 0) {
    for (const f of agentFields) {
      const raw = call.extracted_data?.[f.key];
      let display: string;
      if (raw === null || raw === undefined || raw === "") {
        display = "-";
      } else if (typeof raw === "boolean") {
        display = raw ? "Yes" : "No";
      } else {
        display = String(raw);
      }
      extractedByLabel.push({ label: f.label || f.key, value: display });
    }
  } else {
    const fallback: Record<string, string> = {
      ...(contact?.name ? { Name: contact.name } : {}),
      ...(contact?.email ? { Email: contact.email } : {}),
      ...(contact?.company ? { Company: contact.company } : {}),
      Phone: call.phone_to,
      ...(contact?.custom_vars ?? {}),
      ...(call.appointment_booked ? { Appointment: "Yes" } : {}),
    };
    for (const [k, v] of Object.entries(fallback)) {
      extractedByLabel.push({ label: k, value: v });
    }
  }


  return (
    <>
      <PageHeader
        title={contact?.name ? `${contact.name} · ${call.phone_to}` : call.phone_to}
        description={`${new Date(call.started_at).toLocaleString()} · ${formatDuration(call.duration_sec)} · ${call.status}`}
        crumb={[
          { label: "Call History", to: "/call-history" },
          { label: call.phone_to, to: `/calls/${call.id}` },
        ]}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={downloadTranscript}>
              <FileText className="size-3.5 mr-1" /> Transcript
            </Button>
            {campaign && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/campaigns/$id" params={{ id: campaign.id }}>View campaign</Link>
              </Button>
            )}
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <StatTile label="Status" value={call.status} />
        <StatTile label="End reason" value={endReasonLabel(call.end_reason)} />
        <StatTile label="Duration" value={formatDuration(call.duration_sec)} />
        <StatTile label="Sentiment" value={sentimentLabel(call.sentiment)} />
        <StatTile label="Lead score" value={score} accent={score >= 70} />
        <StatTile label="AI minutes" value={call.ai_minutes.toFixed(2)} />
        <StatTile label="Cost" value={`$${(call.cost_cents / 100).toFixed(2)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column - transcript + recording */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recording */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <h2 className="text-sm font-medium text-neutral-900 mb-3 flex items-center gap-2">
              <Play className="size-3.5 text-brand-primary" /> Recording
            </h2>
            {call.recording_url ? (
              <div className="space-y-3">
                {recordingSrc ? (
                  <audio controls src={recordingSrc} className="w-full" />
                ) : recordingError ? (
                  <p className="text-xs text-red-600">{recordingError}</p>
                ) : (
                  <p className="text-xs text-neutral-500 italic">Loading recording…</p>
                )}
                <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono">
                  <span>{new Date(call.started_at).toLocaleString()} · {formatDuration(call.duration_sec)}</span>
                  {recordingSrc && (
                    <a href={recordingSrc} download={`recording-${call.id.slice(0, 8)}.mp3`} className="text-brand-primary hover:underline flex items-center gap-1">
                      <Download className="size-3" /> Download
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-neutral-500 italic">
                No recording available. Enable call recording in your campaign settings to capture audio.
              </p>
            )}
          </div>

          {/* Summary */}
          {call.summary && (
            <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
              <h2 className="text-sm font-medium text-neutral-900 mb-3">AI Summary</h2>
              <p className="text-sm text-neutral-800 leading-relaxed">{call.summary}</p>
            </div>
          )}

          {/* Transcript */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-neutral-900">Transcript</h2>
              {call.transcript.length > 0 && (
                <Button size="sm" variant="ghost" onClick={downloadTranscript}>
                  <Download className="size-3.5 mr-1" /> .txt
                </Button>
              )}
            </div>
            {call.transcript.length === 0 ? (
              <p className="text-xs text-neutral-500 italic">No transcript captured for this call.</p>
            ) : (
              <div className="bg-neutral-100 rounded-lg p-4 ring-1 ring-black/5 space-y-3 max-h-[600px] overflow-y-auto">
                {call.transcript.map((t, i) => (
                  <div key={i} className="flex gap-3">
                    <span className={`text-[10px] font-mono uppercase tracking-wider shrink-0 w-10 pt-0.5 ${
                      t.speaker === "ai" ? "text-brand-primary" : "text-neutral-500"
                    }`}>
                      {t.speaker === "ai" ? "AI" : "User"}
                    </span>
                    <p className="text-sm text-neutral-900 leading-relaxed">{t.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column - extracted info, notes, tags */}
        <div className="space-y-6">
          {/* Contact */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <h2 className="text-sm font-medium text-neutral-900 mb-3">Contact</h2>
            <div className="space-y-2 text-xs">
              <InfoLine icon={User} label="Name" value={contact?.name || "Unknown"} />
              <InfoLine icon={PhoneIcon} label="Phone" value={call.phone_to} mono />
              {contact?.email && <InfoLine icon={Mail} label="Email" value={contact.email} />}
              {contact?.company && <InfoLine icon={Building2} label="Company" value={contact.company} />}
              <InfoLine icon={Calendar} label="Called" value={new Date(call.started_at).toLocaleString()} />
            </div>
          </div>

          {/* Lead score card */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium text-neutral-900">Lead score</h2>
              <span className={`text-2xl font-mono ${scoreColor}`}>{score}</span>
            </div>
            <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden mb-3">
              <div className={`h-full ${score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-neutral-400"}`} style={{ width: `${score}%` }} />
            </div>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Derived from sentiment, duration, appointment status, and call outcome.
            </p>
          </div>

          {/* Extracted info */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <h2 className="text-sm font-medium text-neutral-900 mb-3 flex items-center gap-2">
              <Star className="size-3.5 text-amber-400" /> Extracted information
            </h2>
            <dl className="space-y-2 text-xs">
              {extractedByLabel.length === 0 && (
                <p className="text-[11px] text-neutral-500 italic">No fields captured.</p>
              )}
              {extractedByLabel.map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-neutral-500 uppercase tracking-wider text-[10px] font-mono">{label}</dt>
                  <dd className="text-neutral-900 text-right break-words min-w-0">{value}</dd>
                </div>
              ))}
              {call.outcome && (
                <div className="flex justify-between gap-3">
                  <dt className="text-neutral-500 uppercase tracking-wider text-[10px] font-mono">Outcome</dt>
                  <dd className="text-neutral-900 text-right">{call.outcome}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Tags */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <h2 className="text-sm font-medium text-neutral-900 mb-3 flex items-center gap-2">
              <Tag className="size-3.5" /> Tags
            </h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {local.tags.length === 0 && <span className="text-[11px] text-neutral-500 italic">No tags yet</span>}
              {local.tags.map((t) => (
                <button key={t} onClick={() => removeTag(t)} className="px-2 py-0.5 rounded-full bg-neutral-200 text-[10px] text-neutral-800 hover:bg-red-500/20 hover:text-red-300">
                  {t} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Add tag…"
                className="h-8 text-xs"
              />
              <Button size="sm" variant="outline" onClick={addTag}>Add</Button>
            </div>
          </div>

          {/* Notes & next action */}
          <div className="bg-white ring-1 ring-black/5 rounded-xl p-5">
            <h2 className="text-sm font-medium text-neutral-900 mb-3 flex items-center gap-2">
              <StickyNote className="size-3.5" /> Notes & next action
            </h2>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono mb-1 block">Next recommended action</label>
            <Input
              value={local.next_action}
              onChange={(e) => updateLocal({ next_action: e.target.value })}
              placeholder="e.g. Send follow-up email"
              className="mb-3 text-xs"
            />
            <label className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono mb-1 block">Notes</label>
            <Textarea
              value={local.notes}
              onChange={(e) => updateLocal({ notes: e.target.value })}
              placeholder="Internal notes about this call…"
              rows={5}
              className="text-xs"
            />
            <p className="text-[10px] text-neutral-500 mt-2">Saved locally on this device.</p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Button asChild variant="ghost">
          <Link to="/call-history"><ArrowLeft className="size-3.5 mr-1" /> All calls</Link>
        </Button>
      </div>
    </>
  );
}

function InfoLine({ icon: Icon, label, value, mono }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-3.5 text-neutral-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">{label}</p>
        <p className={`text-neutral-900 truncate ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </div>
  );
}
