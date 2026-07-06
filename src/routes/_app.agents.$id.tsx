import { createFileRoute, useRouter, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, ArrowLeft, Play, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB, type AIAgent } from "@/lib/data-store";
import {
  XTTS_LANGUAGES,
  XTTS_SPEAKERS,
  synthesizeSpeech,
} from "@/lib/tts/xtts.functions";

export const Route = createFileRoute("/_app/agents/$id")({
  head: () => ({ meta: [{ title: "Edit agent — BulkCall AI" }] }),
  component: AgentEditor,
});

// XTTS speaker presets — voice-cloned from public reference WAVs.
const VOICES = Object.entries(XTTS_SPEAKERS).map(([id, s]) => ({
  id,
  name: s.label,
}));

// XTTS language codes: 2-letter (en, hi, ta, te).
type XttsLang = keyof typeof XTTS_LANGUAGES;
const LANGS = Object.entries(XTTS_LANGUAGES) as Array<[XttsLang, string]>;

const SAMPLE_LINES: Record<XttsLang, string> = {
  en: "Hi, this is a quick voice sample so you can hear how I sound.",
  hi: "नमस्ते, यह आपकी आवाज़ का एक छोटा नमूना है।",
  ta: "வணக்கம், இது ஒரு குறுகிய குரல் மாதிரி.",
  te: "నమస్తే, ఇది ఒక చిన్న వాయిస్ నమూనా.",
};

function blank(orgId: string): Omit<AIAgent, "id" | "created_at"> {
  return {
    org_id: orgId,
    name: "",
    voice_id: VOICES[0].id,
    voice_name: VOICES[0].name,
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

  // ---- Voice preview (XTTS via Replicate) ----
  const synth = useServerFn(synthesizeSpeech);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  async function previewVoice() {
    const lang = form.language as XttsLang;
    if (!(lang in XTTS_LANGUAGES)) {
      toast.error("Pick English, Hindi, Tamil or Telugu first.");
      return;
    }
    if (!(form.voice_id in XTTS_SPEAKERS)) {
      toast.error("Pick a voice preset first.");
      return;
    }
    const text = (form.greeting.trim() || SAMPLE_LINES[lang]).slice(0, 400);
    const cacheKey = `${form.voice_id}|${lang}|${text}`;
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
      const res = await synth({
        data: {
          text,
          language: lang,
          speaker: form.voice_id as keyof typeof XTTS_SPEAKERS,
        },
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

        <Card title="Voice & Language (Coqui XTTS v2)">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Voice">
              <div className="flex gap-2">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={previewing}
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
          <p className="text-[10px] text-zinc-500 font-mono pt-1">
            Powered by Coqui XTTS v2 via Replicate — non-commercial license (dev/eval only).
          </p>
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

        <div className="flex justify-end gap-2">
          <Button type="submit" className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            <Save className="size-3.5 mr-1" /> Save agent
          </Button>
        </div>
      </form>
    </>
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
