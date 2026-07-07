import { useShallow } from "zustand/react/shallow";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
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


export const Route = createFileRoute("/_app/launch")({
  head: () => ({
    meta: [
      { title: "Launch a campaign — BulkCall AI" },
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
  { id: "af_bella", name: "Bella — American Female, warm" },
  { id: "af_sarah", name: "Sarah — American Female, clear" },
  { id: "am_michael", name: "Michael — American Male, deep" },
  { id: "am_adam", name: "Adam — American Male, neutral" },
  { id: "bf_emma", name: "Emma — British Female" },
  { id: "bm_george", name: "George — British Male" },
];

type Step = 1 | 2 | 3 | 4;

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

  // Step 1 — brief
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [generating, setGenerating] = useState(false);

  // Step 2 — generated agent (editable)
  const [gen, setGen] = useState<GeneratedAgent | null>(null);

  // Step 3 — contacts + phone
  const [contacts, setContacts] = useState<
    Omit<Contact, "id" | "org_id" | "created_at">[]
  >([]);
  const [listName, setListName] = useState("");
  const [phoneId, setPhoneId] = useState<string>(phones[0]?.id ?? "");
  const [newPhone, setNewPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 4 — schedule + launch
  const [campaignName, setCampaignName] = useState("");
  const [startImmediately, setStartImmediately] = useState(true);
  const [cpm, setCpm] = useState(10);
  const [launching, setLaunching] = useState(false);

  // Preflight
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  const contactCheck = useMemo<CheckResult>(() => {
    if (!contacts.length) {
      return {
        id: "twilio",
        status: "fail",
        label: "Contacts",
        detail: "No contacts loaded — upload a CSV or add numbers manually.",
      } as CheckResult;
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
        detail: `${invalid} invalid phone number${invalid === 1 ? "" : "s"} — remove or fix them.`,
      } as CheckResult;
    }
    return {
      id: "twilio",
      status: dupes ? "warn" : "pass",
      label: `${seen.size.toLocaleString()} valid contact${seen.size === 1 ? "" : "s"}`,
      detail: dupes
        ? `${dupes} duplicate number${dupes === 1 ? "" : "s"} will be skipped.`
        : "All phone numbers are E.164-valid.",
    } as CheckResult;
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
  const canLaunch =
    checks !== null && !hasFail && contactCheck.status !== "fail";

  async function handleGenerate() {
    if (brief.trim().length < 8) {
      toast.error("Give me a bit more detail — 1–2 sentences is plenty.");

      return;
    }
    setGenerating(true);
    try {
      const g = await generateAgentFromBrief({
        data: { brief, audience, goal },
      });
      setGen(g);
      setListName(g.suggested_campaign_name + " — Contacts");
      setCampaignName(g.suggested_campaign_name);
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function handleCSV(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        let invalid = 0;
        const rows: typeof contacts = [];
        for (const row of res.data) {
          const phone = (row.phone ?? row.Phone ?? row.PHONE ?? "").trim();
          if (!PHONE_RE.test(phone)) {
            invalid++;
            continue;
          }
          rows.push({
            list_id: null,
            name: (row.name ?? row.Name ?? "").trim(),
            company: (row.company ?? row.Company ?? "").trim(),
            phone,
            email: (row.email ?? row.Email ?? "").trim(),
            custom_vars: {},
            tags: [],
            notes: "",
            status: "new",
          });
        }
        setContacts((prev) => [...prev, ...rows]);
        toast.success(
          `Loaded ${rows.length} contacts${invalid ? ` (${invalid} invalid skipped)` : ""}`,
        );
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

  async function launch() {
    if (!gen) return;
    if (!contacts.length) {
      toast.error("Add at least one contact.");
      return;
    }
    if (!phoneId) {
      toast.error("Pick or add a phone number.");
      return;
    }
    setLaunching(true);
    try {
      // 1. Create the AI agent
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
      });

      // 2. Create the contact list + load contacts
      const list = addList(
        listName || `${campaignName} — Contacts`,
        `Auto-created for ${campaignName}`,
      );
      const rows = contacts.map((c) => ({ ...c, list_id: list.id }));
      addContactsBulk(rows);

      // 3. Create the campaign
      const camp = addCampaign({
        name: campaignName || gen.suggested_campaign_name,
        agent_id: agent.id,
        list_id: list.id,
        phone_number_id: phoneId,
        timezone: "America/Los_Angeles",
        calling_hours: {
          start: "09:00",
          end: "18:00",
          days: [1, 2, 3, 4, 5],
        },
        calls_per_minute: cpm,
        retry_rules: { max_attempts: 3, gap_minutes: 60 },
        voicemail_rules: {
          action: gen.voicemail_message ? "leave" : "skip",
        },
      });

      if (startImmediately) setCampaignStatus(camp.id, "running");
      toast.success(
        startImmediately
          ? "Campaign launched — dialing now"
          : "Campaign saved as draft",
      );
      router.navigate({ to: "/campaigns/$id", params: { id: camp.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to launch");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Launch a campaign"
        description="Describe the call in plain English. We generate the agent, you upload contacts and pick a number."
        crumb={[{ label: "Launch", to: "/launch" }]}
      />

      <Stepper current={step} />

      <div className="max-w-3xl mt-8">
        {step === 1 && (
          <StepCard
            title="Describe your campaign"
            hint="Two or three sentences is enough. Include what you sell, who you're calling, and what a successful call looks like."
          >
            <Field label="Brief *">
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={5}
                placeholder="e.g. We're a solar installer in Austin. Call homeowners with roofs over 5 years old and book a free rooftop inspection this month. Mention our current $0-down promo."
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Target audience (optional)">
                <Input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="e.g. homeowners 35–65 in Texas"
                />
              </Field>
              <Field label="Success looks like (optional)">
                <Input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. an inspection booked on the calendar"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
              <Wand2 className="size-3.5" />
              Uses Lovable AI to draft a system prompt, greeting, personality and
              qualification questions. You'll review before it goes live.
            </div>
            <Actions>
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="min-w-40"
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" /> Generate agent
                  </>
                )}
              </Button>
            </Actions>
          </StepCard>
        )}

        {step === 2 && gen && (
          <StepCard
            title="Review your AI agent"
            hint="These are drafts. Edit anything — the system prompt is what the AI follows on every turn."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Agent name">
                <Input
                  value={gen.name}
                  onChange={(e) => setGen({ ...gen, name: e.target.value })}
                />
              </Field>
              <Field label="Voice">
                <Select
                  value={gen.voice_id}
                  onValueChange={(v) => {
                    const name = VOICES.find((x) => x.id === v)?.name ?? v;
                    setGen({ ...gen, voice_id: v, voice_name: name });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICES.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Opening line (the first thing the caller hears)">
              <Textarea
                rows={2}
                value={gen.greeting}
                onChange={(e) => setGen({ ...gen, greeting: e.target.value })}
              />
            </Field>
            <Field label="System prompt">
              <Textarea
                rows={6}
                value={gen.system_prompt}
                onChange={(e) =>
                  setGen({ ...gen, system_prompt: e.target.value })
                }
              />
            </Field>
            <Field label="Business knowledge base">
              <Textarea
                rows={5}
                value={gen.business_knowledge}
                onChange={(e) =>
                  setGen({ ...gen, business_knowledge: e.target.value })
                }
                placeholder="Facts, pricing, differentiators the agent may reference."
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Objective">
                <Input
                  value={gen.objective}
                  onChange={(e) => setGen({ ...gen, objective: e.target.value })}
                />
              </Field>
              <Field label="Personality">
                <Input
                  value={gen.personality}
                  onChange={(e) =>
                    setGen({ ...gen, personality: e.target.value })
                  }
                />
              </Field>
            </div>
            <ListField
              label="Qualification questions"
              items={gen.qualification_questions}
              onChange={(items) =>
                setGen({ ...gen, qualification_questions: items })
              }
              placeholder="e.g. Are you the decision-maker?"
            />
            <ListField
              label="End-call conditions"
              items={gen.end_call_conditions}
              onChange={(items) => setGen({ ...gen, end_call_conditions: items })}
              placeholder="e.g. Prospect books a demo"
            />
            <Field label="Voicemail message (leave blank to hang up on voicemail)">
              <Textarea
                rows={2}
                value={gen.voicemail_message}
                onChange={(e) =>
                  setGen({ ...gen, voicemail_message: e.target.value })
                }
              />
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
            hint="Upload a CSV with a phone column (E.164 format like +14155551234), or add numbers one by one."
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-zinc-300">
                  Contacts ({contacts.length})
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-3.5 mr-2" /> Upload CSV
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCSV(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-3">
                <Input
                  placeholder="Name (optional)"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
                <Input
                  placeholder="+14155551234"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                />
                <Button variant="outline" onClick={addManual}>
                  <Plus className="size-3.5 mr-1" /> Add
                </Button>
              </div>
              {contacts.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded border border-surface-border/60 bg-surface-panel/40 divide-y divide-surface-border/40">
                  {contacts.slice(0, 100).map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-1.5 text-xs"
                    >
                      <span className="text-zinc-200 truncate">
                        {c.name || "—"}
                      </span>
                      <span className="font-mono text-zinc-500">{c.phone}</span>
                      <button
                        onClick={() =>
                          setContacts((p) => p.filter((_, j) => j !== i))
                        }
                        className="text-zinc-600 hover:text-red-400"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {contacts.length > 100 && (
                    <div className="px-3 py-2 text-xs text-zinc-500">
                      +{contacts.length - 100} more…
                    </div>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-zinc-500">
                CSV headers accepted: <span className="font-mono">phone, name, email, company</span>.
                Phone is required.
              </p>
            </div>

            <div className="pt-4 border-t border-surface-border/40">
              <Label className="text-zinc-300 mb-2 block">
                Caller ID (the number the AI dials from)
              </Label>
              {phones.length > 0 && (
                <Select value={phoneId} onValueChange={setPhoneId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a number" />
                  </SelectTrigger>
                  <SelectContent>
                    {phones.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-mono">{p.number}</span> ·{" "}
                        {p.type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <Input
                  placeholder="Add a new Twilio number, e.g. +14155551200"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
                <Button variant="outline" onClick={addFromNumber}>
                  <Phone className="size-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>

            <Actions>
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ArrowLeft className="size-4 mr-2" /> Back
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={!contacts.length || !phoneId}
              >
                Continue <ArrowRight className="size-4 ml-2" />
              </Button>
            </Actions>
          </StepCard>
        )}

        {step === 4 && gen && (
          <StepCard
            title="Ready to launch"
            hint="One last look. Weekday 9am–6pm calling hours and 3 retries are set by default — tweak later from the campaign page."
          >
            <Field label="Campaign name">
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </Field>
            <Field label={`Pacing — up to ${cpm} calls per minute`}>
              <input
                type="range"
                min={1}
                max={60}
                value={cpm}
                onChange={(e) => setCpm(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </Field>

            <Summary
              agent={gen.name}
              voice={gen.voice_name}
              contactCount={contacts.length}
              phone={phones.find((p) => p.id === phoneId)?.number ?? "—"}
            />

            <div className="flex items-center gap-2 mt-4">
              <input
                id="start-now"
                type="checkbox"
                checked={startImmediately}
                onChange={(e) => setStartImmediately(e.target.checked)}
                className="size-4 accent-brand-primary"
              />
              <label htmlFor="start-now" className="text-sm text-zinc-300">
                Start dialing immediately after launch
              </label>
            </div>

            <Actions>
              <Button variant="ghost" onClick={() => setStep(3)}>
                <ArrowLeft className="size-4 mr-2" /> Back
              </Button>
              <Button onClick={launch} disabled={launching} className="min-w-40">
                {launching ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" /> Launching…
                  </>
                ) : (
                  <>
                    <Rocket className="size-4 mr-2" />
                    {startImmediately ? "Launch campaign" : "Save as draft"}
                  </>
                )}
              </Button>
            </Actions>
          </StepCard>
        )}
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
    <div className="flex items-center gap-2 mt-4">
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
                    : "bg-surface-panel/60 border-surface-border text-zinc-500",
              )}
            >
              {done ? <Check className="size-3.5" /> : n}
            </div>
            <span
              className={cn(
                "text-xs font-medium",
                active ? "text-zinc-100" : "text-zinc-500",
              )}
            >
              {label}
            </span>
            {i < items.length - 1 && (
              <div className="w-6 h-px bg-surface-border/60 mx-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-surface-border/60 bg-surface-panel/40 p-6 space-y-5">
      <div>
        <h2 className="text-lg font-medium text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-500 mt-1">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-zinc-300">{label}</Label>
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

function ListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      <Label className="text-zinc-300">{label}</Label>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={it}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-zinc-500 hover:text-red-400"
              aria-label="Remove"
            >
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft("");
            }
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function Summary({
  agent,
  voice,
  contactCount,
  phone,
}: {
  agent: string;
  voice: string;
  contactCount: number;
  phone: string;
}) {
  const rows = useMemo(
    () => [
      { k: "Agent", v: agent },
      { k: "Voice", v: voice },
      { k: "Contacts to call", v: contactCount.toLocaleString() },
      { k: "From number", v: phone },
      { k: "Hours", v: "Weekdays 9:00–18:00 PT" },
    ],
    [agent, voice, contactCount, phone],
  );
  return (
    <div className="rounded-md border border-surface-border/60 bg-surface-base/60 divide-y divide-surface-border/40">
      {rows.map((r) => (
        <div
          key={r.k}
          className="flex items-center justify-between px-4 py-2 text-sm"
        >
          <span className="text-zinc-500">{r.k}</span>
          <Badge variant="outline" className="font-mono">
            {r.v}
          </Badge>
        </div>
      ))}
    </div>
  );
}
