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
  name: string;
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
    f.type === "phone" ? " — collect the full phone number with country/area code, read it back to confirm"
    : f.type === "email" ? " — spell it back to confirm"
    : "";
  return `${f.label} [${f.key}]${req}${hint}`;
}

function buildSystem(a: AgentSummary): string {
  const canTransfer = !!a.transfer_number?.trim();
  const fields = a.data_fields ?? [];
  const parts = [
    a.system_prompt?.trim(),
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
    "Never use both [END_CALL] and [TRANSFER] in the same reply.",
    "Keep replies under 25 spoken words. Never break character. Never mention you are AI unless asked directly.",
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
            max_tokens: 120,
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

        // Strip control tokens (case-insensitive, in either order).
        for (let i = 0; i < 2; i++) {
          const m = reply.match(/^\s*\[(END_CALL|TRANSFER)\]\s*/i);
          if (!m) break;
          if (m[1].toUpperCase() === "END_CALL") endCall = true;
          else transfer = true;
          reply = reply.slice(m[0].length);
        }
        // Transfer wins over end_call if both were emitted.
        if (transfer) endCall = false;

        return json({ reply, end_call: endCall, transfer });
      },
    },
  },
});
