import { useShallow } from "zustand/react/shallow";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useRef, useMemo, useEffect } from "react";
import Papa from "papaparse";
import {
  Sparkles,
  Upload,
  Phone,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Check,
  Wand2,
  X,
  Plus,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Download,
  RefreshCw,
  MessageSquare,
  Building2,
  Calendar,
  ClipboardList,
  FileText,
} from "lucide-react";

import { toast } from "sonner";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDB, type Contact } from "@/lib/data-store";
import {
  generateAgentFromBrief,
  type GeneratedAgent,
} from "@/lib/agents/generate.functions";
import {
  preflightLaunch,
  type CheckResult,
} from "@/lib/launch/preflight.functions";
import {
  listTwilioNumbers,
  type TwilioNumber,
} from "@/lib/telephony/twilio-numbers.functions";

export const Route = createFileRoute("/_app/launch")({
  head: () => ({
    meta: [
      { title: "Launch a campaign - BulkCall AI" },
      {
        name: "description",
        content:
          "Describe your call in plain English. We generate the agent, you upload contacts, pick a number, and launch.",
      },
    ],
  }),
  component: LaunchWizard,
});

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;
const VOICES: { id: string; name: string }[] = [
  { id: "af_bella", name: "Bella - American Female, warm" },
  { id: "af_sarah", name: "Sarah - American Female, clear" },
  { id: "am_michael", name: "Michael - American Male, deep" },
  { id: "am_adam", name: "Adam - American Male, neutral" },
  { id: "bf_emma", name: "Emma - British Female" },
  { id: "bm_george", name: "George - British Male" },
];

const PRESETS: { id: string; label: string; icon: React.ElementType; brief: string; audience: string; goal: string }[] = [
  {
    id: "solar",
    label: "Solar / Home services",
    icon: Building2,
    brief:
      "We install rooftop solar in Austin, TX. Call homeowners who requested a quote in the last 90 days and haven't scheduled yet. Emphasize our $0-down financing and 25-year warranty.",
    audience: "Homeowners 30–70 who requested a solar quote",
    goal: "Book a free rooftop inspection this week",
  },
  {
    id: "b2b",
    label: "B2B outbound sales",
    icon: MessageSquare,
    brief:
      "We sell a workflow automation SaaS to operations leaders at 50–500-person companies. Call warm leads from our webinar list and qualify budget, timeline and current tool.",
    audience: "Ops managers/directors at mid-market SaaS",
    goal: "Book a 20-minute product demo",
  },
  {
    id: "clinic",
    label: "Appointment reminders",
    icon: Calendar,
    brief:
      "We're a dental clinic. Call patients with an appointment in the next 3 days to confirm attendance and offer to reschedule or take them off waitlist.",
    audience: "Existing patients with upcoming visits",
    goal: "Confirm the appointment or reschedule",
  },
  {
    id: "survey",
    label: "Customer survey",
    icon: ClipboardList,
    brief:
      "We're a fintech app. Call customers who churned in the last 30 days to run a short 3-question exit survey about pricing, features and support experience.",
    audience: "Churned customers, last 30 days",
    goal: "Complete a 3-question exit survey",
  },
];

const SAMPLE_CSV = "phone,name,email,company\n+14155551234,Ada Lovelace,ada@example.com,Analytical Engines\n+442071234567,Alan Turing,alan@example.co.uk,Bletchley Park\n";
const DRAFT_KEY = "bulkcall-launch-draft-v1";

type Step = 1 | 2 | 3 | 4;
type ContactRow = Omit<Contact, "id" | "org_id" | "created_at">;

function LaunchWizard() {
  const router = useRouter();
  const orgId = useDB((s) => s.currentOrgId);
  const phones = useDB(useShallow((s) => s.phones.filter((p) => p.org_id === orgId)));
  const addAgent = useDB((s) => s.addAgent);
  const addList = useDB((s) => s.addList);
  const addContactsBulk = useDB((s) => s.addContactsBulk);
  const addCampaign = useDB((s) => s.addCampaign);
  const addPhone = useDB((s) => s.addPhone);
  const setCampaignStatus = useDB((s) => s.setCampaignStatus);

  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [generating, setGenerating] = useState(false);

  // Step 2
  const [gen, setGen] = useState<GeneratedAgent | null>(null);

  // Step 3
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [listName, setListName] = useState("");
  const [phoneId, setPhoneId] = useState<string>(phones[0]?.id ?? "");
  const [newPhone, setNewPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [twilioNumbers, setTwilioNumbers] = useState<TwilioNumber[] | null>(null);
  const [twilioError, setTwilioError] = useState<string | null>(null);
  const [loadingTwilio, setLoadingTwilio] = useState(false);
  const [lastImportInfo, setLastImportInfo] = useState<{
    loaded: number;
    invalid: number;
    duplicates: number;
    headers: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 4
  const [campaignName, setCampaignName] = useState("");
  const [startImmediately, setStartImmediately] = useState(true);
  const [cpm, setCpm] = useState(10);
  const [launching, setLaunching] = useState(false);

  // Preflight
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { brief?: string; audience?: string; goal?: string };
        if (d.brief) setBrief(d.brief);
        if (d.audience) setAudience(d.audience);
        if (d.goal) setGoal(d.goal);
      }
    } catch { /* ignore */ }
  }, []);

  // Autosave brief
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ brief, audience, goal }));
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [brief, audience, goal]);

  // Load Twilio numbers when step 3 becomes active (once)
  useEffect(() => {
    if (step === 3 && twilioNumbers === null && !loadingTwilio && !twilioError) {
      void refreshTwilio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function refreshTwilio() {
    setLoadingTwilio(true);
    setTwilioError(null);
    try {
      const res = await listTwilioNumbers();
      if (res.ok) {
        setTwilioNumbers(res.numbers);
        // Auto-adopt any Twilio number that isn't already in our phone list
        for (const n of res.numbers) {
          if (!phones.some((p) => p.number === n.phone_number)) {
            addPhone(n.phone_number, "local");
          }
        }
      } else {
        setTwilioError(res.message);
        setTwilioNumbers([]);
      }
    } catch (e) {
      setTwilioError(e instanceof Error ? e.message : "Failed to load Twilio numbers");
      setTwilioNumbers([]);
    } finally {
      setLoadingTwilio(false);
    }
  }

  const contactCheck = useMemo<CheckResult>(() => {
    if (!contacts.length) {
      return {
        id: "twilio",
        status: "fail",
        label: "Contacts",
        detail: "No contacts loaded - upload a CSV or add numbers manually.",
      };
    }
    const seen = new Set<string>();
    let dupes = 0;
    let invalid = 0;
    for (const c of contacts) {
      if (!PHONE_RE.test(c.phone)) invalid++;
      else if (seen.has(c.phone)) dupes++;
      else seen.add(c.phone);
    }
    if (invalid) {
      return {
        id: "twilio",
        status: "fail",
        label: "Contact validity",
        detail: `${invalid} invalid phone number${invalid === 1 ? "" : "s"} - remove or fix them.`,
      };
    }
    return {
      id: "twilio",
      status: dupes ? "warn" : "pass",
      label: `${seen.size.toLocaleString()} valid contact${seen.size === 1 ? "" : "s"}`,
      detail: dupes
        ? `${dupes} duplicate number${dupes === 1 ? "" : "s"} will be skipped.`
        : "All phone numbers are E.164-valid.",
    };
  }, [contacts]);

  async function runPreflight() {
    const from = phones.find((p) => p.id === phoneId)?.number;
    if (!from) {
      toast.error("Pick a caller ID first.");
      return;
    }
    setChecking(true);
    try {
      const results = await preflightLaunch({ data: { fromNumber: from } });
      setChecks(results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preflight failed");
    } finally {
      setChecking(false);
    }
  }

  const allChecks: CheckResult[] = [contactCheck, ...(checks ?? [])];
  const hasFail = allChecks.some((c) => c.status === "fail");
  const canLaunch = checks !== null && !hasFail && contactCheck.status !== "fail";

  function applyPreset(p: (typeof PRESETS)[number]) {
    setBrief(p.brief);
    setAudience(p.audience);
    setGoal(p.goal);
  }

  async function handleGenerate() {
    if (brief.trim().length < 8) {
      toast.error("Give me a bit more detail - 1–2 sentences is plenty.");
      return;
    }
    setGenerating(true);
    try {
      const g = await generateAgentFromBrief({ data: { brief, audience, goal } });
      setGen(g);
      setListName(g.suggested_campaign_name + " - Contacts");
      setCampaignName(g.suggested_campaign_name);
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function ingestCSV(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        // Flexible header matching
        const key = (row: Record<string, string>, opts: string[]) => {
          for (const k of Object.keys(row)) {
            const lk = k.trim().toLowerCase();
            if (opts.includes(lk)) return row[k];
          }
          return "";
        };
        let invalid = 0;
        let duplicates = 0;
        const seenIn = new Set(contacts.map((c) => c.phone));
        const rows: ContactRow[] = [];
        for (const row of res.data) {
          const phone = (key(row, ["phone", "mobile", "number", "cell"]) ?? "").trim();
          if (!PHONE_RE.test(phone)) { invalid++; continue; }
          if (seenIn.has(phone)) { duplicates++; continue; }
          seenIn.add(phone);
          rows.push({
            list_id: null,
            name: (key(row, ["name", "full name", "first name"]) ?? "").trim(),
            company: (key(row, ["company", "organization", "org"]) ?? "").trim(),
            phone,
            email: (key(row, ["email", "e-mail"]) ?? "").trim(),
            custom_vars: {},
            tags: [],
            notes: "",
            status: "new",
          });
        }
        setContacts((prev) => [...prev, ...rows]);
        setLastImportInfo({ loaded: rows.length, invalid, duplicates, headers });
        toast.success(`Loaded ${rows.length} contact${rows.length === 1 ? "" : "s"}`);
      },
      error: () => toast.error("Failed to parse CSV"),
    });
  }

  function addManual() {
    if (!PHONE_RE.test(manualPhone.trim())) {
      toast.error("Phone must be E.164 format, e.g. +14155551234");
      return;
    }
    setContacts((p) => [
      ...p,
      {
        list_id: null,
        name: manualName.trim() || "Unknown",
        company: "",
        phone: manualPhone.trim(),
        email: "",
        custom_vars: {},
        tags: [],
        notes: "",
        status: "new",
      },
    ]);
    setManualName("");
    setManualPhone("");
  }

  function addFromNumber() {
    if (!PHONE_RE.test(newPhone.trim())) {
      toast.error("Number must be E.164 format, e.g. +14155551200");
      return;
    }
    const p = addPhone(newPhone.trim(), "local");
    setPhoneId(p.id);
    setNewPhone("");
    toast.success("Number added");
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulkcall-contacts-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function launch() {
    if (!gen) return;
    if (!contacts.length) return toast.error("Add at least one contact.");
    if (!phoneId) return toast.error("Pick or add a phone number.");
    setLaunching(true);
    try {
      const agent = addAgent({
        name: gen.name,
        tts_engine: "kokoro",
        voice_id: gen.voice_id,
        voice_name: gen.voice_name,
        language: gen.language,
        greeting: gen.greeting,
        system_prompt: gen.system_prompt,
        prompt: gen.prompt,
        business_knowledge: gen.business_knowledge,
        personality: gen.personality,
        temperature: gen.temperature,
        objective: gen.objective,
        qualification_questions: gen.qualification_questions,
        transfer_number: "",
        voicemail_handling: gen.voicemail_message ? "leave_message" : "hangup",
        voicemail_message: gen.voicemail_message,
        end_call_conditions: gen.end_call_conditions,
        max_retries: 3,
        retry_delay_minutes: 60,
        data_fields: [],
      });
      const list = addList(listName || `${campaignName} - Contacts`, `Auto-created for ${campaignName}`);
      const rows = contacts.map((c) => ({ ...c, list_id: list.id }));
      addContactsBulk(rows);
      const camp = addCampaign({
        name: campaignName || gen.suggested_campaign_name,
        agent_id: agent.id,
        list_id: list.id,
        phone_number_id: phoneId,
        timezone: "America/Los_Angeles",
        calling_hours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
        calls_per_minute: cpm,
        retry_rules: { max_attempts: 3, gap_minutes: 60 },
        voicemail_rules: { action: gen.voicemail_message ? "leave" : "skip" },
      });
      if (startImmediately) setCampaignStatus(camp.id, "running");
      sessionStorage.removeItem(DRAFT_KEY);
      toast.success(startImmediately ? "Campaign launched - dialing now" : "Campaign saved as draft");
      router.navigate({ to: "/campaigns/$id", params: { id: camp.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to launch");
    } finally {
      setLaunching(false);
    }
  }

  const selectedPhone = phones.find((p) => p.id === phoneId)?.number ?? null;
  const validContactCount = useMemo(() => {
    const seen = new Set<string>();
    for (const c of contacts) if (PHONE_RE.test(c.phone)) seen.add(c.phone);
    return seen.size;
  }, [contacts]);

  return (
    <>
      <PageHeader
        title="Launch a campaign"
        description="Describe the call in plain English. We generate the agent, you upload contacts and pick a number."
        crumb={[{ label: "Launch", to: "/launch" }]}
      />

      <Stepper current={step} />

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div>
          {step === 1 && (
            <StepCard
              title="Describe your campaign"
              hint="Two or three sentences is enough. Or start from a preset and tweak it."
            >
              <div>
                <Label className="text-neutral-800 mb-2 block">Start from a preset (optional)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="flex items-center gap-2 rounded-md border border-surface-border/60 bg-surface-panel/60 px-3 py-2 text-left text-xs text-neutral-900 hover:bg-surface-panel hover:border-brand-primary/50 transition-colors"
                    >
                      <p.icon className="size-4 text-brand-primary shrink-0" />
                      <span className="truncate">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Brief *">
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={5}
                  placeholder="e.g. We're a solar installer in Austin. Call homeowners with roofs over 5 years old and book a free rooftop inspection this month."
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Target audience (optional)">
                  <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. homeowners 35–65 in Texas" />
                </Field>
                <Field label="Success looks like (optional)">
                  <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. an inspection booked on the calendar" />
                </Field>
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-neutral-500">
                <Wand2 className="size-3.5" />
                Uses Lovable AI to draft the system prompt, greeting, personality, and qualification questions. You'll review before it goes live.
              </div>
              <Actions>
                <div />
                <Button onClick={handleGenerate} disabled={generating} className="min-w-40">
                  {generating ? (
                    <><Loader2 className="size-4 mr-2 animate-spin" /> Generating…</>
                  ) : (
                    <><Sparkles className="size-4 mr-2" /> Generate agent</>
                  )}
                </Button>
              </Actions>
            </StepCard>
          )}

          {step === 2 && gen && (
            <StepCard
              title="Review your AI agent"
              hint="These are drafts. Edit anything - the system prompt is what the AI follows on every turn."
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Agent name">
                  <Input value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} />
                </Field>
                <Field label="Voice">
                  <Select
                    value={gen.voice_id}
                    onValueChange={(v) => {
                      const name = VOICES.find((x) => x.id === v)?.name ?? v;
                      setGen({ ...gen, voice_id: v, voice_name: name });
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VOICES.map((v) => (<SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Opening line (the first thing the caller hears)">
                <Textarea rows={2} value={gen.greeting} onChange={(e) => setGen({ ...gen, greeting: e.target.value })} />
              </Field>
              <Field label="System prompt">
                <Textarea rows={6} value={gen.system_prompt} onChange={(e) => setGen({ ...gen, system_prompt: e.target.value })} />
              </Field>
              <Field label="Business knowledge base">
                <Textarea rows={5} value={gen.business_knowledge} onChange={(e) => setGen({ ...gen, business_knowledge: e.target.value })} placeholder="Facts, pricing, differentiators the agent may reference." />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Objective">
                  <Input value={gen.objective} onChange={(e) => setGen({ ...gen, objective: e.target.value })} />
                </Field>
                <Field label="Personality">
                  <Input value={gen.personality} onChange={(e) => setGen({ ...gen, personality: e.target.value })} />
                </Field>
              </div>
              <ListField
                label="Qualification questions"
                items={gen.qualification_questions}
                onChange={(items) => setGen({ ...gen, qualification_questions: items })}
                placeholder="e.g. Are you the decision-maker?"
              />
              <ListField
                label="End-call conditions"
                items={gen.end_call_conditions}
                onChange={(items) => setGen({ ...gen, end_call_conditions: items })}
                placeholder="e.g. Prospect books a demo"
              />
              <Field label="Voicemail message (leave blank to hang up on voicemail)">
                <Textarea rows={2} value={gen.voicemail_message} onChange={(e) => setGen({ ...gen, voicemail_message: e.target.value })} />
              </Field>

              <Actions>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="size-4 mr-2" /> Back
                </Button>
                <Button onClick={() => setStep(3)}>
                  Continue <ArrowRight className="size-4 ml-2" />
                </Button>
              </Actions>
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              title="Contacts and phone number"
              hint="Drop a CSV with a phone column (E.164 like +14155551234), or add numbers one at a time."
            >
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) ingestCSV(f);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
                  dragOver
                    ? "border-brand-primary bg-brand-primary/5"
                    : "border-surface-border/70 bg-surface-panel/30 hover:bg-surface-panel/50",
                )}
              >
                <Upload className="size-5 mx-auto text-brand-primary mb-2" />
                <div className="text-sm text-neutral-900">Drop a CSV here or click to browse</div>
                <div className="text-xs text-neutral-500 mt-1">
                  Accepted headers: <span className="font-mono">phone</span> (required), <span className="font-mono">name</span>, <span className="font-mono">email</span>, <span className="font-mono">company</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); downloadSample(); }}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-brand-primary hover:underline"
                >
                  <Download className="size-3" /> Download sample CSV
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) ingestCSV(f);
                    e.target.value = "";
                  }}
                />
              </div>

              {lastImportInfo && (
                <ImportReport info={lastImportInfo} />
              )}

              {/* Manual add */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input placeholder="Name (optional)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                <Input placeholder="+14155551234" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual(); }} />
                <Button variant="outline" onClick={addManual}>
                  <Plus className="size-3.5 mr-1" /> Add
                </Button>
              </div>

              {contacts.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded border border-surface-border/60 bg-surface-panel/40 divide-y divide-surface-border/40">
                  {contacts.slice(0, 100).map((c, i) => {
                    const invalid = !PHONE_RE.test(c.phone);
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-neutral-900 truncate flex-1">{c.name || "-"}</span>
                        <span className={cn("font-mono", invalid ? "text-red-400" : "text-neutral-500")}>{c.phone}</span>
                        <button
                          onClick={() => setContacts((p) => p.filter((_, j) => j !== i))}
                          className="ml-2 text-neutral-400 hover:text-red-400"
                          aria-label="Remove"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {contacts.length > 100 && (
                    <div className="px-3 py-2 text-xs text-neutral-500">+{contacts.length - 100} more…</div>
                  )}
                </div>
              )}

              {/* Twilio numbers */}
              <div className="pt-4 border-t border-surface-border/40">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-neutral-800">Caller ID (Twilio number the AI dials from)</Label>
                  <Button variant="ghost" size="sm" onClick={refreshTwilio} disabled={loadingTwilio}>
                    <RefreshCw className={cn("size-3.5 mr-1.5", loadingTwilio && "animate-spin")} /> Refresh
                  </Button>
                </div>

                {twilioError && (
                  <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
                    {twilioError}
                  </div>
                )}

                {phones.length > 0 ? (
                  <Select value={phoneId} onValueChange={setPhoneId}>
                    <SelectTrigger><SelectValue placeholder="Pick a number" /></SelectTrigger>
                    <SelectContent>
                      {phones.map((p) => {
                        const meta = twilioNumbers?.find((n) => n.phone_number === p.number);
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="font-mono">{p.number}</span>
                            {meta ? (
                              <>
                                <span className="text-neutral-500"> · {meta.friendly_name}</span>
                                {!meta.voice && <span className="text-red-400"> · no voice</span>}
                              </>
                            ) : (
                              <span className="text-neutral-400"> · {p.type}</span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : loadingTwilio ? (
                  <div className="text-xs text-neutral-500 flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> Loading numbers from Twilio…
                  </div>
                ) : (
                  <div className="text-xs text-neutral-500">
                    No numbers yet. Add one below or connect your Twilio account.
                  </div>
                )}

                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <Input placeholder="Add a number manually, e.g. +14155551200" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addFromNumber(); }} />
                  <Button variant="outline" onClick={addFromNumber}>
                    <Phone className="size-3.5 mr-1" /> Add
                  </Button>
                </div>
              </div>

              <Actions>
                <Button variant="ghost" onClick={() => setStep(2)}>
                  <ArrowLeft className="size-4 mr-2" /> Back
                </Button>
                <Button onClick={() => setStep(4)} disabled={!contacts.length || !phoneId}>
                  Continue <ArrowRight className="size-4 ml-2" />
                </Button>
              </Actions>
            </StepCard>
          )}

          {step === 4 && gen && (
            <StepCard
              title="Ready to launch"
              hint="One last look. Weekday 9am–6pm calling hours and 3 retries are set by default - tweak later from the campaign page."
            >
              <Field label="Campaign name">
                <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
              </Field>
              <Field label={`Pacing - up to ${cpm} calls per minute`}>
                <input type="range" min={1} max={60} value={cpm} onChange={(e) => setCpm(Number(e.target.value))} className="w-full accent-brand-primary" />
              </Field>

              <Checklist items={allChecks} hasRun={checks !== null} checking={checking} onRun={runPreflight} />

              <div className="flex items-center gap-2 mt-4">
                <input id="start-now" type="checkbox" checked={startImmediately} onChange={(e) => setStartImmediately(e.target.checked)} className="size-4 accent-brand-primary" />
                <label htmlFor="start-now" className="text-sm text-neutral-800">
                  Start dialing immediately after launch
                </label>
              </div>

              <Actions>
                <Button variant="ghost" onClick={() => setStep(3)}>
                  <ArrowLeft className="size-4 mr-2" /> Back
                </Button>
                <Button
                  onClick={launch}
                  disabled={launching || !canLaunch}
                  className="min-w-40"
                  title={!canLaunch ? (checks === null ? "Run preflight checks first" : "Resolve failing checks before launching") : undefined}
                >
                  {launching ? (
                    <><Loader2 className="size-4 mr-2 animate-spin" /> Launching…</>
                  ) : (
                    <><Rocket className="size-4 mr-2" /> {startImmediately ? "Launch campaign" : "Save as draft"}</>
                  )}
                </Button>
              </Actions>
            </StepCard>
          )}
        </div>

        {/* Persistent summary rail */}
        <SummaryRail
          brief={brief}
          gen={gen}
          contacts={validContactCount}
          totalContacts={contacts.length}
          phone={selectedPhone}
          campaignName={campaignName || gen?.suggested_campaign_name}
          step={step}
        />
      </div>
    </>
  );
}

// ============================================================
// UI helpers
// ============================================================

function Stepper({ current }: { current: Step }) {
  const items = ["Describe", "Review agent", "Contacts & number", "Launch"];
  return (
    <div className="flex items-center gap-2 mt-4 flex-wrap">
      {items.map((label, i) => {
        const n = (i + 1) as Step;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "size-6 rounded-full grid place-items-center text-xs font-semibold border transition-colors",
                done
                  ? "bg-brand-primary/20 border-brand-primary text-brand-primary"
                  : active
                    ? "bg-brand-primary text-primary-foreground border-brand-primary"
                    : "bg-surface-panel/60 border-surface-border text-neutral-500",
              )}
            >
              {done ? <Check className="size-3.5" /> : n}
            </div>
            <span className={cn("text-xs font-medium", active ? "text-neutral-900" : "text-neutral-500")}>
              {label}
            </span>
            {i < items.length - 1 && <div className="w-6 h-px bg-surface-border/60 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-surface-border/60 bg-surface-panel/40 p-6 space-y-5">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">{title}</h2>
        <p className="text-sm text-neutral-500 mt-1">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-neutral-800">{label}</Label>
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-surface-border/40">
      {children}
    </div>
  );
}

function ListField({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      <Label className="text-neutral-800">{label}</Label>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={it} onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }} />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400" aria-label="Remove">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onChange([...items, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(""); } }}>
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ImportReport({ info }: { info: { loaded: number; invalid: number; duplicates: number; headers: string[] } }) {
  return (
    <div className="rounded-md border border-surface-border/60 bg-surface-base/60 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <FileText className="size-4 text-brand-primary" />
        <span className="text-sm text-neutral-900">Last import</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
          +{info.loaded} loaded
        </Badge>
        {info.duplicates > 0 && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">
            {info.duplicates} duplicate{info.duplicates === 1 ? "" : "s"} skipped
          </Badge>
        )}
        {info.invalid > 0 && (
          <Badge variant="outline" className="bg-red-500/10 text-red-300 border-red-500/30">
            {info.invalid} invalid skipped
          </Badge>
        )}
      </div>
      {info.headers.length > 0 && (
        <div className="mt-2 text-[11px] text-neutral-500">
          Detected columns: <span className="font-mono text-neutral-600">{info.headers.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function SummaryRail({
  brief,
  gen,
  contacts,
  totalContacts,
  phone,
  campaignName,
  step,
}: {
  brief: string;
  gen: GeneratedAgent | null;
  contacts: number;
  totalContacts: number;
  phone: string | null;
  campaignName?: string;
  step: Step;
}) {
  return (
    <aside className="sticky top-4 rounded-lg border border-surface-border/60 bg-surface-panel/40 p-5 hidden lg:block">
      <div className="flex items-center gap-2 mb-3">
        <Rocket className="size-4 text-brand-primary" />
        <div className="text-sm font-medium text-neutral-900">Campaign summary</div>
      </div>
      <dl className="space-y-3 text-xs">
        <SummaryRow label="Name" value={campaignName || (brief ? "-" : "Not set yet")} placeholder={step < 2} />
        <SummaryRow label="Agent" value={gen?.name} placeholder={!gen} />
        <SummaryRow label="Voice" value={gen?.voice_name} placeholder={!gen} />
        <SummaryRow label="Objective" value={gen?.objective} placeholder={!gen} multiline />
        <SummaryRow
          label="Contacts"
          value={contacts ? `${contacts.toLocaleString()} valid${totalContacts !== contacts ? ` / ${totalContacts.toLocaleString()} total` : ""}` : undefined}
          placeholder={step < 3}
        />
        <SummaryRow label="From number" value={phone ?? undefined} placeholder={!phone} mono />
      </dl>
    </aside>
  );
}

function SummaryRow({
  label, value, placeholder, mono, multiline,
}: {
  label: string;
  value?: string;
  placeholder?: boolean;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-neutral-500 text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className={cn(
        "text-neutral-900 mt-0.5",
        mono && "font-mono",
        multiline ? "text-xs" : "text-xs truncate",
        placeholder && "text-neutral-400 italic",
      )}>
        {value || (placeholder ? "-" : "-")}
      </dd>
    </div>
  );
}

function Checklist({ items, hasRun, checking, onRun }: { items: CheckResult[]; hasRun: boolean; checking: boolean; onRun: () => void }) {
  const failing = items.filter((i) => i.status === "fail").length;
  const warning = items.filter((i) => i.status === "warn").length;
  return (
    <div className="rounded-md border border-surface-border/60 bg-surface-base/60 mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border/40">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-brand-primary" />
          <div>
            <div className="text-sm font-medium text-neutral-900">Launch preflight</div>
            <div className="text-xs text-neutral-500">
              {hasRun
                ? failing
                  ? `${failing} issue${failing === 1 ? "" : "s"} to fix${warning ? `, ${warning} warning${warning === 1 ? "" : "s"}` : ""}`
                  : warning
                    ? `All clear · ${warning} warning${warning === 1 ? "" : "s"}`
                    : "All systems go"
                : "Verify Twilio, bridge, contacts, and credits before dialing."}
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onRun} disabled={checking}>
          {checking ? (
            <><Loader2 className="size-3.5 mr-2 animate-spin" /> Checking…</>
          ) : hasRun ? "Re-run checks" : "Run checks"}
        </Button>
      </div>
      <ul className="divide-y divide-surface-border/40">
        {items.map((c, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <StatusIcon status={c.status} />
            <div className="min-w-0 flex-1">
              <div className="text-neutral-900 truncate">{c.label}</div>
              <div className="text-xs text-neutral-500">{c.detail}</div>
            </div>
          </li>
        ))}
        {!hasRun && (
          <li className="px-4 py-2.5 text-xs text-neutral-500 italic">
            Twilio, bridge, and AI-gateway checks run against your live secrets.
          </li>
        )}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: CheckResult["status"] }) {
  if (status === "pass") return <Check className="size-4 text-emerald-400 mt-0.5 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />;
  return <XCircle className="size-4 text-red-400 mt-0.5 shrink-0" />;
}
