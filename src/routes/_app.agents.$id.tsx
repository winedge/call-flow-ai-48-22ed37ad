import { createFileRoute, useRouter, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, ArrowLeft, Play, Loader2, PhoneCall } from "lucide-react";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB, type AIAgent, type DataField, type DataFieldType } from "@/lib/data-store";
import {
  KOKORO_LANGUAGES,
  KOKORO_VOICES,
} from "@/lib/voice/tts/registry";
import { synthesizeSpeechKokoro } from "@/lib/voice/tts/kokoro.functions";
import { listElevenLabsVoices, previewElevenLabsVoice, type ElevenLabsVoice } from "@/lib/voice/tts/elevenlabs.functions";
import { initiateCall } from "@/lib/voice/telephony/twilio.functions";

export const Route = createFileRoute("/_app/agents/$id")({
  head: () => ({ meta: [{ title: "Edit agent — BulkCall AI" }] }),
  component: AgentEditor,
});

// Kokoro speaker presets — Apache-2.0, commercially licensed.
const VOICES = KOKORO_VOICES.map((v) => ({ id: v.id, name: v.label, language: v.language }));

type KokoroLang = keyof typeof KOKORO_LANGUAGES;
const LANGS = Object.entries(KOKORO_LANGUAGES) as Array<[KokoroLang, string]>;

const SAMPLE_LINES: Record<KokoroLang, string> = {
  en: "Hi, this is a quick voice sample so you can hear how I sound.",
  hi: "नमस्ते, यह आपकी आवाज़ का एक छोटा नमूना है।",
};

function blank(orgId: string): Omit<AIAgent, "id" | "created_at"> {
  const defaultVoice = VOICES[0];
  return {
    org_id: orgId,
    name: "",
    tts_engine: "kokoro",
    voice_id: defaultVoice.id,
    voice_name: defaultVoice.name,
    language: "en",
    greeting: "",
    system_prompt: "",
    prompt: "",
    business_knowledge: "",
    personality: "",
    temperature: 0.6,
    objective: "",
    qualification_questions: [],
    transfer_number: "",
    voicemail_handling: "leave_message",
    voicemail_message: "",
    end_call_conditions: [],
    max_retries: 3,
    retry_delay_minutes: 60,
    data_fields: [],
    voice_stability: 0.35,
    voice_similarity_boost: 0.8,
    voice_style: 0.45,
    voice_speaker_boost: true,
  };
}

function AgentEditor() {
  const router = useRouter();
  const { id } = Route.useParams();
  const orgId = useDB((s) => s.currentOrgId);
  const existing = useDB((s) => s.agents.find((a) => a.id === id));
  const updateAgent = useDB((s) => s.updateAgent);
  const addAgent = useDB((s) => s.addAgent);

  const isNew = id === "new";
  const [form, setForm] = useState<Omit<AIAgent, "id" | "created_at">>(
    isNew ? blank(orgId) : (existing ?? blank(orgId)),
  );

  useEffect(() => {
    if (!isNew && existing) setForm(existing);
  }, [existing, isNew]);

  if (!isNew && !existing) throw notFound();

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ---- Voice preview ----
  const synthKokoro = useServerFn(synthesizeSpeechKokoro);
  const loadVoices = useServerFn(listElevenLabsVoices);
  const previewEleven = useServerFn(previewElevenLabsVoice);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const [elVoices, setElVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [elLoading, setElLoading] = useState(false);
  const [elError, setElError] = useState<string | null>(null);

  useEffect(() => {
    if (form.tts_engine !== "elevenlabs" || elVoices !== null || elLoading) return;
    setElLoading(true);
    setElError(null);
    loadVoices()
      .then((res) => {
        if (res.ok) setElVoices(res.voices);
        else setElError(res.message);
      })
      .catch((e) => setElError(e instanceof Error ? e.message : "Failed to load voices"))
      .finally(() => setElLoading(false));
  }, [form.tts_engine, elVoices, elLoading, loadVoices]);

  async function previewVoice() {
    if (form.tts_engine === "elevenlabs") {
      if (!form.voice_id) {
        toast.error("Pick a voice first.");
        return;
      }
      const text = (form.greeting.trim() || "Hi, this is a quick voice sample so you can hear how I sound.").slice(0, 400);
      const cacheKey = `el|${form.voice_id}|${text}`;
      const cached = cacheRef.current.get(cacheKey);
      audioRef.current?.pause();
      if (cached) {
        const a = new Audio(cached);
        audioRef.current = a;
        a.play().catch(() => toast.error("Browser blocked audio playback."));
        return;
      }
      setPreviewing(true);
      try {
        const res = await previewEleven({ data: { voiceId: form.voice_id, text } });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        const url = `data:${res.mimeType};base64,${res.audioBase64}`;
        cacheRef.current.set(cacheKey, url);
        const a = new Audio(url);
        audioRef.current = a;
        await a.play();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Voice preview failed.");
      } finally {
        setPreviewing(false);
      }
      return;
    }

    // Kokoro path
    const lang = form.language as KokoroLang;
    if (!(lang in KOKORO_LANGUAGES)) {
      toast.error("Pick English or Hindi first.");
      return;
    }
    if (!VOICES.some((v) => v.id === form.voice_id)) {
      toast.error("Pick a voice preset first.");
      return;
    }
    const text = (form.greeting.trim() || SAMPLE_LINES[lang]).slice(0, 400);
    const cacheKey = `kokoro|${form.voice_id}|${lang}|${text}`;
    const cached = cacheRef.current.get(cacheKey);
    audioRef.current?.pause();
    if (cached) {
      const a = new Audio(cached);
      audioRef.current = a;
      a.play().catch(() => toast.error("Browser blocked audio playback."));
      return;
    }
    setPreviewing(true);
    try {
      const res = await synthKokoro({
        data: { text, language: lang, voice: form.voice_id },
      });
      cacheRef.current.set(cacheKey, res.audioUrl);
      const a = new Audio(res.audioUrl);
      audioRef.current = a;
      await a.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Voice preview failed.";
      toast.error(msg);
    } finally {
      setPreviewing(false);
    }
  }


  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (isNew) {
      const a = addAgent(form);
      toast.success("Agent created");
      router.navigate({ to: "/agents/$id", params: { id: a.id } });
    } else {
      updateAgent(id, form);
      toast.success("Saved");
    }
  }

  return (
    <>
      <PageHeader
        title={isNew ? "New AI Agent" : form.name || "Agent"}
        description="Define how this agent speaks, listens, and qualifies."
        crumb={[
          { label: "Agents", to: "/agents" },
          { label: isNew ? "New" : form.name || "Edit", to: "/agents/" + id },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/agents" })}>
              <ArrowLeft className="size-3.5 mr-1" /> Back
            </Button>
            <Button
              size="sm"
              onClick={save}
              className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
            >
              <Save className="size-3.5 mr-1" /> Save agent
            </Button>
          </div>
        }
      />

      <form onSubmit={save} className="max-w-4xl space-y-6">
        <Card title="Identity">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="Sarah-AI" required />
            </Field>
            <Field label="Objective">
              <Input value={form.objective} onChange={(e) => patch("objective", e.target.value)} placeholder="Book a 15-minute demo" />
            </Field>
          </div>
        </Card>

        <Card title="Voice & Language">
          <Field label="TTS engine">
            <Select
              value={form.tts_engine}
              onValueChange={(v) => {
                const engine = v as AIAgent["tts_engine"];
                if (engine === "kokoro") {
                  const dv = VOICES[0];
                  setForm((f) => ({ ...f, tts_engine: engine, voice_id: dv.id, voice_name: dv.name }));
                } else {
                  setForm((f) => ({ ...f, tts_engine: engine, voice_id: "", voice_name: "" }));
                }
              }}
            >
              <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kokoro">Kokoro-82M (Replicate)</SelectItem>
                <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Voice">
              <div className="flex gap-2">
                {form.tts_engine === "elevenlabs" ? (
                  <Select
                    value={form.voice_id}
                    onValueChange={(v) => {
                      const voice = elVoices?.find((x) => x.voice_id === v);
                      if (!voice) return;
                      setForm((f) => ({ ...f, voice_id: voice.voice_id, voice_name: voice.name }));
                    }}
                    disabled={elLoading || !!elError}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={elLoading ? "Loading voices…" : elError ? "Error loading voices" : "Select a voice"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(elVoices ?? []).map((v) => (
                        <SelectItem key={v.voice_id} value={v.voice_id}>
                          {v.name}
                          {v.labels?.accent ? ` · ${v.labels.accent}` : ""}
                          {v.category ? ` · ${v.category}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={form.voice_id}
                    onValueChange={(v) => {
                      const voice = VOICES.find((x) => x.id === v)!;
                      setForm((f) => ({ ...f, voice_id: voice.id, voice_name: voice.name }));
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VOICES.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={previewing || !form.voice_id}
                  onClick={previewVoice}
                  title="Play a preview using the greeting (or a sample line)"
                >
                  {previewing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  <span className="ml-1">Preview</span>
                </Button>
              </div>
            </Field>
            <Field label="Language">
              <Select value={form.language} onValueChange={(v) => patch("language", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGS.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {form.tts_engine === "elevenlabs" ? (
            <p className="text-[10px] text-zinc-500 font-mono pt-1">
              {elError
                ? `ElevenLabs: ${elError}`
                : `ElevenLabs · ${elVoices?.length ?? 0} voices loaded from your account. Uses eleven_multilingual_v2.`}
            </p>
          ) : (
            <p className="text-[10px] text-zinc-500 font-mono pt-1">
              Powered by Kokoro-82M via Replicate — Apache-2.0, commercially licensed.
            </p>
          )}
        </Card>


        <Card title="Prompting (OpenAI GPT)">
          <Field label="Greeting (spoken first)">
            <Textarea rows={2} value={form.greeting} onChange={(e) => patch("greeting", e.target.value)} />
          </Field>
          <Field label="System prompt">
            <Textarea rows={4} value={form.system_prompt} onChange={(e) => patch("system_prompt", e.target.value)} placeholder="You are..." />
          </Field>
          <Field label="Task prompt">
            <Textarea rows={3} value={form.prompt} onChange={(e) => patch("prompt", e.target.value)} />
          </Field>
          <Field label="Business knowledge">
            <Textarea rows={3} value={form.business_knowledge} onChange={(e) => patch("business_knowledge", e.target.value)} placeholder="Pricing, FAQ, etc." />
          </Field>
          <Field label="Personality">
            <Input value={form.personality} onChange={(e) => patch("personality", e.target.value)} placeholder="Warm, concise, professional" />
          </Field>
          <Field label={`Temperature: ${form.temperature.toFixed(2)}`}>
            <Slider
              value={[form.temperature]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => patch("temperature", v[0])}
            />
          </Field>
        </Card>

        <Card title="Qualification">
          <Field label="Qualification questions (one per line)">
            <Textarea
              rows={4}
              value={form.qualification_questions.join("\n")}
              onChange={(e) => patch("qualification_questions", e.target.value.split("\n").filter(Boolean))}
            />
          </Field>
        </Card>

        <Card title="Call control">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Transfer to">
              <Input value={form.transfer_number} onChange={(e) => patch("transfer_number", e.target.value)} placeholder="+15551234567" />
            </Field>
            <Field label="Voicemail handling">
              <Select value={form.voicemail_handling} onValueChange={(v) => patch("voicemail_handling", v as AIAgent["voicemail_handling"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave_message">Leave message</SelectItem>
                  <SelectItem value="hangup">Hang up</SelectItem>
                  <SelectItem value="retry">Retry later</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Voicemail message">
            <Textarea rows={2} value={form.voicemail_message} onChange={(e) => patch("voicemail_message", e.target.value)} />
          </Field>
          <Field label="End-call conditions (one per line)">
            <Textarea
              rows={3}
              value={form.end_call_conditions.join("\n")}
              onChange={(e) => patch("end_call_conditions", e.target.value.split("\n").filter(Boolean))}
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Max retries">
              <Input type="number" min={0} max={10} value={form.max_retries} onChange={(e) => patch("max_retries", +e.target.value)} />
            </Field>
            <Field label="Retry delay (minutes)">
              <Input type="number" min={5} max={1440} value={form.retry_delay_minutes} onChange={(e) => patch("retry_delay_minutes", +e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Data collection">
          <p className="text-[11px] text-zinc-500 mb-3">
            Define the fields this agent should collect from callers. After each call ends, the transcript is
            scanned for these fields and the values are saved on the call record.
          </p>
          <DataFieldsEditor value={form.data_fields} onChange={(v) => patch("data_fields", v)} />
        </Card>

        <TestCallCard agentId={id} isNew={isNew} />




        <div className="flex justify-end gap-2">
          <Button type="submit" className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            <Save className="size-3.5 mr-1" /> Save agent
          </Button>
        </div>
      </form>
    </>
  );
}

function TestCallCard({ agentId, isNew }: { agentId: string; isNew: boolean }) {
  const [to, setTo] = useState("");
  const [calling, setCalling] = useState(false);
  const [lastSid, setLastSid] = useState<string | null>(null);
  const dial = useServerFn(initiateCall);

  async function call() {
    if (isNew) {
      toast.error("Save the agent first.");
      return;
    }
    if (!/^\+\d{8,15}$/.test(to.trim())) {
      toast.error("Enter a phone number in E.164 format (e.g. +14155551234).");
      return;
    }
    setCalling(true);
    try {
      const { callSid } = await dial({ data: { to: to.trim(), agentId } });
      setLastSid(callSid);
      toast.success(`Call queued • ${callSid}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Call failed";
      toast.error(msg);
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 space-y-4">
      <h2 className="text-sm font-medium text-zinc-200 border-b border-surface-border/40 pb-3">
        Test call (live)
      </h2>
      <p className="text-xs text-zinc-400">
        Places a real outbound call via Twilio → voice bridge → Deepgram STT →
        Gemini → Kokoro TTS. Requires{" "}
        <code className="text-zinc-300">TWILIO_*</code>,{" "}
        <code className="text-zinc-300">PUBLIC_APP_URL</code>,{" "}
        <code className="text-zinc-300">BRIDGE_URL</code>, and{" "}
        <code className="text-zinc-300">REPLICATE_API_KEY</code> in admin secrets.
      </p>
      <div className="flex gap-2">
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="+14155551234"
          className="flex-1"
        />
        <Button
          type="button"
          onClick={call}
          disabled={calling || isNew}
          className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
        >
          {calling ? (
            <Loader2 className="size-3.5 animate-spin mr-1" />
          ) : (
            <PhoneCall className="size-3.5 mr-1" />
          )}
          Call now
        </Button>
      </div>
      {lastSid && (
        <p className="text-[11px] text-zinc-500 font-mono">Last CallSid: {lastSid}</p>
      )}
    </div>
  );
}


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 space-y-4">
      <h2 className="text-sm font-medium text-zinc-200 border-b border-surface-border/40 pb-3">{title}</h2>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">{label}</Label>
      {children}
    </div>
  );
}

const FIELD_TYPES: { value: DataFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
];

function slugKey(label: string) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `field_${Math.random().toString(36).slice(2, 6)}`;
}

function DataFieldsEditor({
  value,
  onChange,
}: {
  value: DataField[];
  onChange: (v: DataField[]) => void;
}) {
  function update(i: number, patch: Partial<DataField>) {
    onChange(value.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([
      ...value,
      { key: slugKey(`field_${value.length + 1}`), label: "", type: "text", required: false },
    ]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-[11px] text-zinc-500 italic">
          No fields yet. Add one — e.g. "Full name", "Email", "Preferred callback time".
        </p>
      )}
      {value.map((f, i) => (
        <div
          key={i}
          className="grid grid-cols-1 sm:grid-cols-[1fr_140px_110px_auto] gap-2 items-center bg-zinc-950/40 ring-1 ring-white/5 rounded-lg p-2"
        >
          <Input
            value={f.label}
            placeholder="Field label (e.g. Full name)"
            onChange={(e) => {
              const label = e.target.value;
              update(i, { label, key: f.key ? f.key : slugKey(label) });
            }}
            onBlur={(e) => {
              if (!f.key || f.key.startsWith("field_")) {
                update(i, { key: slugKey(e.target.value) });
              }
            }}
            className="h-8 text-xs"
          />
          <Select value={f.type} onValueChange={(v) => update(i, { type: v as DataFieldType })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => update(i, { required: e.target.checked })}
              className="accent-brand-primary"
            />
            Required
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove(i)}
            className="text-red-400 hover:text-red-300"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        + Add field
      </Button>
    </div>
  );
}
