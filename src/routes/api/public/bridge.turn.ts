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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, "")
    .trim();
}

function callerExplicitlyGaveName(history: Turn[], agentName: string): boolean {
  if (!agentName) return false;
  const escaped = escapeRegex(agentName);
  const explicitNamePatterns = [
    new RegExp(`\\b(?:my name is|this is|i am|i'm|im|it's|its)\\s+${escaped}\\b`, "i"),
    new RegExp(`\\b(?:call me|you can call me)\\s+${escaped}\\b`, "i"),
  ];
  return history
    .filter((turn) => turn.role === "user")
    .some((turn) => explicitNamePatterns.some((pattern) => pattern.test(turn.content)));
}

// Deterministic pre-TTS post-processor: strip any assistant identity token
// from a customer-name (vocative) position in the reply. Runs unconditionally
// on every generated reply before it is handed to the TTS layer, so the
// caller never hears their name replaced by the agent's own name.
//
// "Customer-name position" = any vocative use of a token: comma-adjacent
// address ("..., Sarah, ..."), sentence-initial or sentence-final direct
// address ("Sarah, got it." / "Got it, Sarah."), or a name tacked onto a
// short acknowledgement ("thanks Sarah", "great Sarah!"). We remove those
// occurrences regardless of surrounding text. Non-vocative mentions
// (e.g. "This is Sarah from Acme") are left intact.
function stripIdentityTokenFromNamePosition(reply: string, token: string): string {
  const name = normalizeName(token);
  if (!name) return reply;
  const escaped = escapeRegex(name);

  // Acknowledgement/greeting words that commonly precede a vocative name.
  const ackWords =
    "hi|hello|hey|thanks|thank you|great|okay|ok|got it|sure|perfect|alright|" +
    "understood|noted|awesome|nice|good|excellent|wonderful|absolutely|" +
    "of course|no problem|welcome|glad to hear that|good to hear|nice to hear|" +
    "happy to hear|sounds good|will do";

  let cleaned = reply
    // "<ack>[,] <Name>[!.?]"  → "<ack><punct>"
    .replace(
      new RegExp(`\\b(${ackWords}),?\\s+${escaped}\\b(\\s*[!.?,])?`, "gi"),
      (_m, phrase: string, punct: string | undefined) => `${phrase}${punct ?? ""}`,
    )
    // Sentence-initial "Name, ..."  → "..."
    .replace(new RegExp(`(^|[.!?]\\s+)${escaped}\\s*[,!?-]+\\s*`, "gi"), "$1")
    // Mid/end vocative ", Name" before punctuation or end of string.
    .replace(new RegExp(`\\s*,\\s*${escaped}(?=\\s*[.!?,]|$)`, "gi"), "")
    // Standalone trailing "... Name!" / "... Name?" / "... Name."
    .replace(new RegExp(`\\s+${escaped}\\s*([!?])`, "g"), "$1")
    // Clean up doubled spaces / stranded punctuation created by removals.
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/([,;:])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || reply;
}

// Strip hallucinated "name coincidence" claims: any sentence in which the
// assistant asserts that the caller's name matches its own (e.g. "my name
// is Sarah too", "I'm Sarah as well", "what a coincidence, we have the
// same name", "we're both Sarah"). These arise when the model mirrors
// filler words like "too/also" from the caller and treats them as a name
// claim. Removing the whole sentence is safe — the assistant already
// introduced itself in the greeting and never needs to restate its name.
function stripNameCoincidenceClaims(reply: string, agentName: string | undefined): string {
  const name = normalizeName(agentName);
  if (!name) return reply;
  const escaped = escapeRegex(name);

  const nameClaim = new RegExp(
    `\\b(?:my name is|i(?:'m| am)|it'?s|this is|call me)\\s+${escaped}\\b\\s*(?:too|also|as well|either)?`,
    "i",
  );
  const coincidence = new RegExp(
    `\\b(?:what a coincidence|same name|(?:we(?:'re| are)|we both are)\\s+both\\s+${escaped}|we have the same name)\\b`,
    "i",
  );

  // Split into sentences, drop any that make a name-coincidence claim.
  const sentences = reply.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [reply];
  const kept = sentences.filter((s) => !nameClaim.test(s) && !coincidence.test(s));
  const cleaned = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return cleaned || reply;
}

function stripAgentNameAsCaller(reply: string, agentName: string | undefined, history: Turn[]): string {
  const name = normalizeName(agentName);
  if (!name) return reply;
  // Always strip name-coincidence claims — the caller saying "too" is filler,
  // not a name reveal, and the assistant must never claim their names match.
  let out = stripNameCoincidenceClaims(reply, name);
  // If the caller explicitly gave the same name as their own, leave vocatives alone.
  if (callerExplicitlyGaveName(history, name)) return out;
  return stripIdentityTokenFromNamePosition(out, name);
}

function latestUserTurn(history: Turn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return "";
}

function latestAssistantTurn(history: Turn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i].content;
  }
  return "";
}

function userAskedQuestion(history: Turn[]): boolean {
  const text = latestUserTurn(history).trim();
  return /\?|\b(?:what|why|how|when|where|who|which|can you|could you|would you|do you|are you|is it|tell me)\b/i.test(text);
}

function userTurnCount(history: Turn[]): number {
  return history.filter((turn) => turn.role === "user").length;
}

function stripUnpromptedSelfAnswer(reply: string, history: Turn[]): string {
  if (userAskedQuestion(history)) return reply;
  const cleaned = reply
    .replace(/\b(?:i(?:'m| am) doing (?:well|good|fine)|i(?:'m| am) (?:well|good|fine)),?\s*(?:thank you|thanks)(?: for asking)?[.!?]?\s*/gi, "")
    .replace(/\b(?:thank you|thanks) for asking[.!?]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || reply;
}

function callerShowsBookingIntent(history: Turn[]): boolean {
  // Only the caller can create booking/contact-collection intent. Assistant
  // words like "demo" or "schedule" must never self-authorize collecting
  // name/phone at the beginning of a call.
  const userDialogue = history
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join("\n");
  if (/\b(?:book|schedule|set up|demo|appointment|meeting|calendar|call me back|follow up|send me|sign me up|interested|let'?s do it|that works|sounds good)\b/i.test(userDialogue)) {
    return true;
  }

  const user = latestUserTurn(history);
  const assistant = latestAssistantTurn(history);
  return /\b(?:yes|yeah|yep|sure|okay|ok|please|sounds good|that works|let'?s do it)\b/i.test(user)
    && /\b(?:book|schedule|demo|appointment|meeting|calendar|follow up|send you|reach you|contact you)\b/i.test(assistant);
}

function asksForPersonalContactDetail(reply: string): boolean {
  return /\b(?:what(?:'s| is)|may i have|can i (?:get|have)|could i (?:get|have)|please (?:tell me|share|provide)|tell me|confirm)\b[^.!?]{0,100}\b(?:your full name|your name|full name|name|phone|mobile|cell|number|email|e-mail|best number|best phone)\b/i.test(reply)
    || /\b(?:your full name|full name|phone number|mobile number|cell number|best number|best phone|email address|e-mail address)\b/i.test(reply)
    || /\b(?:reach|contact|call|text|send)\s+you\s+(?:at|on|by)\b/i.test(reply)
    || /\bwhere should i send\b/i.test(reply);
}

function asksForContactField(reply: string, fields: DataField[]): boolean {
  if (!fields.length) return false;
  const lower = reply.toLowerCase();

  const asksForName = /\b(?:what(?:'s| is)|may i have|can i (?:get|have)|could i (?:get|have)|please (?:tell me|share|provide)|tell me|confirm)\b[^.!?]{0,80}\b(?:your full name|your name|full name|who (?:am i|is this)|who (?:am i|are we) speaking with|what should i call you)\b/i.test(reply)
    || /\b(?:your full name|full name)\b/i.test(reply)
    || /\b(?:name)\b[^.!?]{0,40}\b(?:reach you|contact you|book|appointment|demo)\b/i.test(reply);
  const asksForBusinessName = /\b(?:business|company|organization|practice)\s+name\b|\bname of (?:your|the) (?:business|company|organization|practice)\b/i.test(reply);
  const asksForPhone = /\b(?:phone|mobile|cell|contact)\s+(?:number|info|information)\b|\bbest\s+(?:number|phone)\b|\bnumber\s+to\s+(?:reach|contact|call)\s+you\b|\breach you at\b|\bcall you at\b/i.test(reply);
  const asksForEmail = /\b(?:email|e-mail)\b|\bwhere should i send\b/i.test(reply);

  const fieldLabels = fields
    .filter((field) => {
      const label = `${field.key} ${field.label} ${field.type ?? ""}`.toLowerCase();
      return /\b(name|phone|mobile|cell|email|e-mail|contact)\b/.test(label);
    })
    .some((field) => {
      const label = escapeRegex(field.label.toLowerCase()).replace(/\s+/g, "\\s+");
      return new RegExp(`\\b${label}\\b`).test(lower);
    });

  return ((asksForName && !asksForBusinessName) || asksForPhone || asksForEmail || fieldLabels);
}

function extractDiscoveryQuestion(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) return null;
  const lines = systemPrompt.split(/\r?\n/);
  let inDiscovery = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s+/.test(line)) inDiscovery = /discovery|qualif/i.test(line);
    if (!inDiscovery) continue;
    const match = line.match(/^-\s*(.+\?)\s*$/);
    if (match?.[1] && !/\b(?:name|phone|mobile|cell|email|e-mail|number)\b/i.test(match[1])) {
      return match[1].trim();
    }
  }
  return null;
}

function earlyConversationFallback(a: AgentSummary): string {
  const discovery = extractDiscoveryQuestion(a.system_prompt);
  if (discovery) return `Glad to hear that. ${discovery}`;
  if (/\b(?:call|calling|sales|demo|appointment|lead|customer|prospect)\b/i.test(`${a.objective ?? ""} ${a.system_prompt ?? ""}`)) {
    return "Glad to hear that. How are you currently handling customer calls right now?";
  }
  return "Glad to hear that. What would be most helpful to talk through first?";
}

function preventPrematureContactCollection(reply: string, a: AgentSummary, history: Turn[]): string {
  const fields = a.data_fields ?? [];
  const contactAsk = asksForPersonalContactDetail(reply) || asksForContactField(reply, fields);
  if (!contactAsk) return reply;
  if (callerShowsBookingIntent(history)) return reply;
  console.info("bridge prevented premature contact collection", {
    agentName: a.name ?? null,
    userTurns: userTurnCount(history),
  });
  return earlyConversationFallback(a);
}

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
    "Conversation flow priority: follow the configured system prompt's conversation order first. Do not treat required data fields as an opening script. In the opening and early discovery phase, acknowledge the caller and ask the next relevant discovery question from the system prompt. Never jump straight to collecting name, phone, email, or contact details unless the caller explicitly asks to book/schedule, agrees to a demo/appointment/follow-up, or volunteers contact details first.",
    a.system_prompt?.trim(),
    a.name ? `Your name is ${a.name}. This is YOUR name (the assistant's), NOT the caller's. NEVER address the caller as "${a.name}" or use "${a.name}" as if it were their name. The caller has NOT told you their name. Do NOT guess, assume, or invent a name for the caller. Address them neutrally ("you", "there") until they explicitly say their name in this conversation. If unsure, do not use any name at all.` : "You do not know the caller's name. Never invent or assume one. Address them neutrally until they say their name.",
    a.personality ? `Personality: ${a.personality}` : "",
    a.objective ? `Objective: ${a.objective}` : "",
    a.prompt ? `Task: ${a.prompt}` : "",
    a.business_knowledge ? `Reference:\n${a.business_knowledge}` : "",
    fields.length
      ? `Information to collect ONLY when it becomes contextually appropriate, such as after the caller asks to book, agrees to a demo/appointment, requests follow-up, or volunteers contact details. These fields are NOT the opening script and do NOT override the system prompt's discovery flow. Never ask for name, phone, email, or other contact details in the first exchange just because they are listed here. When collection is appropriate, ask one item at a time and confirm it:\n- ${fields.map(describeField).join("\n- ")}\n\nDo NOT ask for any other personal detail (e.g. email, address) unless it is in the list above.`
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
    "Speak like a warm, calm human on a live phone call: use contractions, brief acknowledgements ('mm-hm', 'got it', 'okay'), and natural punctuation for pauses. Vary your sentence length. Keep tone professional and grounded — do NOT sound overly excited, bubbly, or salesy, especially in the opening line. No exclamation marks. No 'so excited', 'amazing', 'awesome' filler.",
    "Ask one question at a time. Do not rapid-fire confirmations or lists.",
    "When repeating a phone number back, ALWAYS format it in your reply with spaces or commas between small groups so it is read slowly, e.g. '2 1 2 ... 5 5 5 ... 0 1 2 3'. Never say a phone number as one continuous string.",
    "After collecting information, acknowledge it naturally and tell the caller the next step before asking anything else.",
    "Early-call guardrail: if the caller has only answered how they are doing, greeted you, or made small talk, do not ask for their name, phone number, email, or contact details. Move into discovery from the system prompt instead.",
    "Never claim the caller said something they did not say. Never say 'thanks for asking', 'good question', or similar unless the caller actually asked you a question in their last message. If the caller only answered your question (e.g. you asked 'how are you' and they replied 'good'), acknowledge briefly ('glad to hear that', 'great') and move on — do NOT pretend they asked you back.",
    "Words like 'too', 'also', 'as well', 'either' from the caller are filler agreement, NEVER a name reveal or an identity claim. Do NOT interpret them as the caller sharing a name, and do NOT respond with any 'coincidence' or 'same name' remark. After the greeting, do NOT re-introduce yourself or restate your own name — never say 'my name is …', 'I'm … too', 'we have the same name', or similar. Your name was given once in the greeting and that is enough.",
    a.name ? `Name safety rule: "${a.name}" is the assistant's name only. If the caller has not explicitly said "my name is ${a.name}" or "call me ${a.name}" in this conversation, any reply that addresses the caller as "${a.name}" is wrong. Use no caller name instead.` : "Name safety rule: the caller's name is unknown unless they explicitly say it during this call. Use no caller name by default.",
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
          {
            role: "system",
            content: body.agent.name
              ? `Final name check before answering: your assistant name is "${body.agent.name}". Do not address the caller as "${body.agent.name}" unless the caller explicitly gave that as their own name. If no caller name was given, address them with no name.`
              : "Final name check before answering: no caller name is known. Address the caller with no name.",
          },
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
        reply = stripAgentNameAsCaller(reply, body.agent.name, body.history ?? []);
        reply = stripUnpromptedSelfAnswer(reply, body.history ?? []);
        reply = preventPrematureContactCollection(reply, body.agent, body.history ?? []);
        // Transfer wins over end_call if both were emitted.
        if (transfer) endCall = false;

        return json({ reply, end_call: endCall, transfer });
      },
    },
  },
});
