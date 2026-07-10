/**
 * Self-improvement loop.
 *
 * After a call is marked "completed" we:
 *   1. Score the call from concrete signals (data collected, engagement,
 *      end-reason, sentiment). No LLM needed for the score - deterministic.
 *   2. Ask Gemini to analyze the transcript and produce structured learnings
 *      (what worked, what failed, objections encountered, key takeaways).
 *   3. Store those in `call_reflections` so the operator can review them.
 *   4. Ask Gemini to fold the new lessons into the agent's rolling
 *      "playbook" - a compact markdown doc of stable guidance the agent
 *      injects into every future call's system prompt.
 *
 * The whole thing is fire-and-forget from the call-event webhook so it
 * never blocks the caller-facing pipeline.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MODEL = "google/gemini-3.5-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const PLAYBOOK_MAX_CHARS = 3500;

type Transcript = { speaker: "ai" | "human"; text: string; at?: number }[];

type ReflectInput = {
  callId: string;
};

type CallRow = {
  id: string;
  user_id: string;
  agent_id: string | null;
  status: string;
  duration_sec: number | null;
  transcript: unknown;
  extracted_data: Record<string, unknown> | null;
  end_reason: string | null;
  sentiment: string | null;
  appointment_booked: boolean | null;
  outcome: string | null;
};

type AgentRow = {
  id: string;
  name: string | null;
  objective: string | null;
  system_prompt: string | null;
  data_fields: unknown;
  playbook: string | null;
  playbook_calls_analyzed: number | null;
};

type Reflection = {
  what_worked: string[];
  what_failed: string[];
  objections: string[];
  key_learnings: string[];
  summary: string;
};

// ---------------------------------------------------------------------------

function normalizeTranscript(v: unknown): Transcript {
  if (!Array.isArray(v)) return [];
  return v.flatMap((t): Transcript => {
    if (!t || typeof t !== "object") return [];
    const o = t as Record<string, unknown>;
    const speaker = o.speaker === "ai" || o.speaker === "human" ? o.speaker : null;
    const text = typeof o.text === "string" ? o.text : "";
    if (!speaker || !text) return [];
    return [{ speaker, text }];
  });
}

function computeSuccess(call: CallRow, agent: AgentRow): { score: number; label: string } {
  let s = 0;

  // Data completeness (weight: 45)
  const fields = Array.isArray(agent.data_fields) ? (agent.data_fields as { key: string; required?: boolean }[]) : [];
  const required = fields.filter((f) => f.required !== false);
  if (required.length > 0 && call.extracted_data) {
    const filled = required.filter((f) => {
      const v = call.extracted_data![f.key];
      if (v === null || v === undefined) return false;
      if (typeof v === "string") return v.trim().length > 0;
      return true;
    }).length;
    s += Math.round((filled / required.length) * 45);
  } else if (call.extracted_data) {
    const entries = Object.entries(call.extracted_data);
    const filled = entries.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").length;
    if (entries.length > 0) s += Math.round((filled / entries.length) * 25);
  }

  // Engagement (weight: 25)
  const turns = normalizeTranscript(call.transcript).length;
  if (turns >= 6) s += 6;
  if (turns >= 14) s += 8;
  if (turns >= 24) s += 6;
  if ((call.duration_sec ?? 0) >= 60) s += 3;
  if ((call.duration_sec ?? 0) >= 180) s += 2;

  // End reason (weight: ±20)
  const reason = (call.end_reason || "").toLowerCase();
  if (reason === "agent_ended") s += 12;
  else if (reason === "caller_hangup" && turns < 6) s -= 20;
  else if (["no_answer", "voicemail", "busy", "failed"].includes(reason)) s -= 15;

  // Sentiment / booking (weight: ±15)
  if (call.appointment_booked) s += 10;
  if (call.sentiment === "positive") s += 5;
  if (call.sentiment === "negative") s -= 8;

  const score = Math.max(0, Math.min(100, s));
  const label = score >= 70 ? "success" : score >= 40 ? "partial" : "failure";
  return { score, label };
}

async function callGeminiJSON<T>(system: string, user: string): Promise<T | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[reflect] gateway", res.status, await res.text().catch(() => ""));
      return null;
    }
    const p = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = p.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text) as T;
  } catch (e) {
    console.error("[reflect] llm failed", e);
    return null;
  }
}

async function callGeminiText(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const p = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return p.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

function toStringArray(v: unknown, cap = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function reflectOnCall({ callId }: ReflectInput): Promise<void> {
  const { data: callRaw, error: callErr } = await supabaseAdmin
    .from("calls")
    .select("id, user_id, agent_id, status, duration_sec, transcript, extracted_data, end_reason, sentiment, appointment_booked, outcome")
    .eq("id", callId)
    .maybeSingle();
  if (callErr || !callRaw) {
    console.warn("[reflect] call not found", callId);
    return;
  }
  const call = callRaw as unknown as CallRow;
  if (!call.agent_id || call.status !== "completed") return;

  const transcript = normalizeTranscript(call.transcript);
  if (transcript.length < 3) return; // nothing meaningful to learn from

  // Skip if already reflected (unique index would just fail loudly).
  const { data: existing } = await supabaseAdmin
    .from("call_reflections")
    .select("id")
    .eq("call_id", callId)
    .maybeSingle();
  if (existing) return;

  const { data: agentRaw, error: agentErr } = await supabaseAdmin
    .from("agents")
    .select("id, name, objective, system_prompt, data_fields, playbook, playbook_calls_analyzed")
    .eq("id", call.agent_id)
    .maybeSingle();
  if (agentErr || !agentRaw) return;
  const agent = agentRaw as unknown as AgentRow;

  const { score, label } = computeSuccess(call, agent);

  const dialogue = transcript
    .map((t) => `${t.speaker === "ai" ? "Agent" : "Caller"}: ${t.text}`)
    .join("\n");

  const requiredFields = Array.isArray(agent.data_fields)
    ? (agent.data_fields as { key: string; label?: string; required?: boolean }[])
        .filter((f) => f.required !== false)
        .map((f) => f.label || f.key)
    : [];

  const extractedSummary = call.extracted_data
    ? Object.entries(call.extracted_data)
        .map(([k, v]) => `${k}=${v === null || v === undefined ? "(missing)" : v}`)
        .join(", ")
    : "(none)";

  // ---- 1. Structured reflection --------------------------------------------

  const reflectionSystem = [
    "You are a sales-coaching analyst. Given ONE phone-call transcript plus its outcome, return JSON with concrete, agent-actionable lessons.",
    "Return ONLY this JSON shape:",
    `{
  "what_worked": string[],     // agent behaviors that moved the call forward (max 5, one sentence each)
  "what_failed": string[],     // agent mistakes or missed opportunities (max 5)
  "objections": string[],      // caller objections, hesitations, or friction (max 5)
  "key_learnings": string[],   // 1-3 crisp rules for future calls (imperative, e.g. "Ask about X before Y")
  "summary": string             // 1-2 sentence recap of the whole call
}`,
    "Rules: be specific (quote or paraphrase the moment), name techniques not vibes, no praise-only fluff, no generic advice. If nothing failed / no objections, return empty arrays.",
  ].join("\n\n");

  const reflectionUser = [
    `Agent name: ${agent.name || "(unnamed)"}`,
    agent.objective ? `Agent objective: ${agent.objective}` : "",
    requiredFields.length ? `Required fields to collect: ${requiredFields.join(", ")}` : "",
    `Call score: ${score}/100 (${label})`,
    `Duration: ${call.duration_sec ?? 0}s, End reason: ${call.end_reason ?? "unknown"}, Sentiment: ${call.sentiment ?? "unknown"}`,
    `Extracted data: ${extractedSummary}`,
    "",
    "Transcript:",
    dialogue,
  ]
    .filter(Boolean)
    .join("\n");

  const reflection = (await callGeminiJSON<Reflection>(reflectionSystem, reflectionUser)) ?? {
    what_worked: [],
    what_failed: [],
    objections: [],
    key_learnings: [],
    summary: "",
  };

  const cleaned: Reflection = {
    what_worked: toStringArray(reflection.what_worked),
    what_failed: toStringArray(reflection.what_failed),
    objections: toStringArray(reflection.objections),
    key_learnings: toStringArray(reflection.key_learnings, 3),
    summary: typeof reflection.summary === "string" ? reflection.summary.slice(0, 500) : "",
  };

  await supabaseAdmin.from("call_reflections").insert({
    user_id: call.user_id,
    agent_id: call.agent_id,
    call_id: call.id,
    success_score: score,
    success_label: label,
    what_worked: cleaned.what_worked,
    what_failed: cleaned.what_failed,
    objections: cleaned.objections,
    key_learnings: cleaned.key_learnings,
    summary: cleaned.summary,
  } as never);

  // ---- 2. Playbook update ---------------------------------------------------

  // Only fold learnings that actually add signal. Any call above 40 gives
  // some directional info; below 40 we mainly learn what NOT to do.
  const hasSignal = cleaned.key_learnings.length > 0 || cleaned.what_failed.length > 0 || cleaned.what_worked.length > 0;
  if (!hasSignal) return;

  const currentPlaybook = (agent.playbook ?? "").trim();

  const playbookSystem = [
    "You maintain a rolling PLAYBOOK for a voice AI sales/qualification agent.",
    "The playbook is compact markdown (headings + bullets) that will be pasted directly into the agent's system prompt on every future call.",
    "Your job: take the CURRENT playbook and the LATEST call's learnings, and return the UPDATED playbook.",
    "",
    "Hard rules:",
    "- Keep it under ~" + PLAYBOOK_MAX_CHARS + " characters. Prune ruthlessly - if two bullets say the same thing, keep the sharper one.",
    "- Sections MUST be exactly (in this order): `## What works`, `## What to avoid`, `## Objection playbook`, `## Style guardrails`. Omit a section only if truly empty.",
    "- Bullets are imperative, concrete, and phone-call-specific (\"Confirm the injury before asking for consent\", not \"Be empathetic\").",
    "- Reinforce items that show up repeatedly across calls; drop items contradicted by newer high-score calls.",
    "- Never add legal, compliance, or safety loosening. Never add scripted lies.",
    "- Return ONLY the updated markdown playbook. No preface, no code fences, no commentary.",
  ].join("\n");

  const playbookUser = [
    `Agent: ${agent.name || "(unnamed)"} - objective: ${agent.objective || "(none)"}`,
    `Calls analyzed so far: ${(agent.playbook_calls_analyzed ?? 0) + 1}`,
    "",
    "=== CURRENT PLAYBOOK ===",
    currentPlaybook || "(empty - this is the first call)",
    "",
    "=== LATEST CALL ===",
    `Score: ${score}/100 (${label})`,
    `Summary: ${cleaned.summary || "(none)"}`,
    `What worked: ${cleaned.what_worked.join(" | ") || "(none)"}`,
    `What failed: ${cleaned.what_failed.join(" | ") || "(none)"}`,
    `Objections: ${cleaned.objections.join(" | ") || "(none)"}`,
    `Key learnings: ${cleaned.key_learnings.join(" | ") || "(none)"}`,
  ].join("\n");

  const updated = await callGeminiText(playbookSystem, playbookUser);
  if (!updated) return;

  const trimmed = updated.replace(/^```(?:markdown|md)?\n?|```$/g, "").trim().slice(0, PLAYBOOK_MAX_CHARS);
  if (!trimmed) return;

  await supabaseAdmin
    .from("agents")
    .update({
      playbook: trimmed,
      playbook_calls_analyzed: (agent.playbook_calls_analyzed ?? 0) + 1,
      playbook_updated_at: new Date().toISOString(),
    } as never)
    .eq("id", agent.id);
}
