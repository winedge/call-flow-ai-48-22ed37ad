/**
 * Bridge → Lovable: run one LLM turn for a call.
 *
 * Body: { agent: AgentSummary, history: {role:"user"|"assistant",content:string}[] }
 * Returns: { reply: string, end_call: boolean, transfer: boolean }
 *
 * Control tokens the model may prepend to the reply:
 *   [END_CALL]  — hang up after speaking `reply`
 *   [TRANSFER]  — warm-transfer to agent.transfer_number after speaking `reply`
 *
 * Uses the Lovable AI Gateway (Gemini 3 Flash). Keeps LOVABLE_API_KEY server-side.
 * Auth: HMAC via BRIDGE_SHARED_SECRET (see bridge-auth.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyBridge } from "@/lib/voice/bridge-auth";
import { errorJson, json, preflight } from "@/lib/api/cors";

const MODEL = "google/gemini-3-flash-preview";

type DataField = { key: string; label: string; type?: string; required?: boolean };

type AgentSummary = {
  name?: string;
  greeting?: string;
  system_prompt?: string;
  prompt?: string;
  business_knowledge?: string;
  personality?: string;
  temperature?: number;
  objective?: string;
  qualification_questions?: string[];
  end_call_conditions?: string[];
  transfer_number?: string;
  data_fields?: DataField[];
};

type Turn = { role: "user" | "assistant"; content: string };

function describeField(f: DataField): string {
  const req = f.required ? " (required)" : "";
  const hint =
    f.type === "phone" ? " — collect the full phone number with country/area code, then confirm it slowly in 3-4 digit groups"
    : f.type === "email" ? " — spell it back to confirm"
    : "";
  return `${f.label} [${f.key}]${req}${hint}`;
}

function buildSystem(a: AgentSummary): string {
  const canTransfer = !!a.transfer_number?.trim();
  const fields = a.data_fields ?? [];
  const parts = [
    a.system_prompt?.trim(),
    a.name ? `Your name is ${a.name}. This is YOUR name, not the caller's name. Never address the caller by your own name. Do not use any name for the caller unless the caller has clearly told you their name during this call.` : "",
    a.personality ? `Personality: ${a.personality}` : "",
    a.objective ? `Objective: ${a.objective}` : "",
    a.prompt ? `Task: ${a.prompt}` : "",
    a.business_knowledge ? `Reference:\n${a.business_knowledge}` : "",
    fields.length
      ? `Information you MUST collect from the caller during this call (ask for these exact items, one at a time, and confirm each):\n- ${fields.map(describeField).join("\n- ")}\n\nDo NOT ask for any other personal detail (e.g. email, address) unless it is in the list above.`
      : "",
    a.qualification_questions?.length
      ? `Qualification questions:\n- ${a.qualification_questions.join("\n- ")}`
      : "",
    a.end_call_conditions?.length
      ? `End the call ONLY when: ${a.end_call_conditions.join("; ")}. When ending, first give a warm closing line (thank them, confirm next step, say goodbye) and prepend [END_CALL] to that closing reply. Never [END_CALL] on the same turn where you just received information — always confirm the info back, share the next step, and wait for the caller's goodbye first.`
      : `Only end the call after the caller clearly says goodbye or asks to end. Never hang up mid-flow. When ending, prepend [END_CALL] to a warm closing reply.`,
    canTransfer
      ? `If the caller asks for a human, a manager, sales, billing, or a topic clearly outside your scope, prepend [TRANSFER] to your reply (e.g. "[TRANSFER] Sure, connecting you now."). Do not use [TRANSFER] otherwise.`
      : `You cannot transfer this call. If a human is requested, apologize and offer to take a message.`,
    "CRITICAL — Control tokens [END_CALL] and [TRANSFER] are SILENT machine signals. They must appear as the very first characters of your reply, in square brackets. NEVER speak the words 'END CALL', 'END_CALL', 'TRANSFER', or read the brackets out loud. To end the call, prepend [END_CALL] to a natural goodbye sentence — never put those words in the sentence itself.",
    "Never use both [END_CALL] and [TRANSFER] in the same reply.",
    "Speak like a warm human on a live phone call: use contractions, brief acknowledgements ('mm-hm', 'got it', 'okay'), and natural punctuation for pauses. Vary your sentence length.",
    "Ask one question at a time. Do not rapid-fire confirmations or lists.",
    "When repeating a phone number back, ALWAYS format it in your reply with spaces or commas between small groups so it is read slowly, e.g. '2 1 2 ... 5 5 5 ... 0 1 2 3'. Never say a phone number as one continuous string.",
    "After collecting information, acknowledge it naturally and tell the caller the next step before asking anything else.",
    "Keep replies short — under 25 spoken words. Never break character. Never mention you are AI unless asked directly.",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export const Route = createFileRoute("/api/public/bridge/turn")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!(await verifyBridge(request, raw))) {
          return errorJson(401, "Invalid bridge signature");
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return errorJson(500, "LOVABLE_API_KEY not configured");

        let body: { agent: AgentSummary; history: Turn[] };
        try {
          body = JSON.parse(raw);
        } catch {
          return errorJson(400, "Invalid JSON");
        }
        if (!body.agent) return errorJson(400, "agent required");

        const messages = [
          { role: "system", content: buildSystem(body.agent) },
          ...(body.history ?? []).slice(-20),
        ];

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: body.agent.temperature ?? 0.6,
            max_tokens: 180,
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return errorJson(res.status, `AI Gateway ${res.status}: ${t.slice(0, 200)}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        let reply = data.choices?.[0]?.message?.content?.trim() ?? "";
        let endCall = false;
        let transfer = false;

        // Strip control tokens aggressively — models sometimes emit them
        // without brackets, with different casing, or mid-reply. Any form
        // must be treated as a control signal and never spoken.
        const tokenRe = /\[?\s*(END[_\s-]?CALL|TRANSFER)\s*\]?/gi;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(reply)) !== null) {
          const which = m[1].toUpperCase().replace(/[_\s-]/g, "");
          if (which === "ENDCALL") endCall = true;
          else if (which === "TRANSFER") transfer = true;
        }
        if (endCall || transfer) {
          reply = reply.replace(tokenRe, "").replace(/\s{2,}/g, " ").trim();
        }
        // Transfer wins over end_call if both were emitted.
        if (transfer) endCall = false;

        return json({ reply, end_call: endCall, transfer });
      },
    },
  },
});
