/**
 * Bridge → Lovable: report a lifecycle event for a live Twilio call.
 *
 * Body: { call_sid: string, end_reason?: string, ended_at?: string }
 *
 * end_reason is a canonical short code — see END_REASONS in
 * src/lib/voice/call-end-reasons.ts. We update the matching calls row
 * (matched by twilio_call_sid) with the reason, ended_at, and, if the row
 * is still "in_progress", flip status to "completed".
 *
 * Auth: HMAC via BRIDGE_SHARED_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyBridge } from "@/lib/voice/bridge-auth";
import { errorJson, json, preflight } from "@/lib/api/cors";

const KNOWN_REASONS = new Set([
  "agent_ended",
  "transfer",
  "max_duration",
  "silence_timeout",
  "caller_hangup",
  "voicemail_left",
  "voicemail_hangup",
  "bridge_error",
  "agent_config_error",
]);

export const Route = createFileRoute("/api/public/bridge/call-event")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!(await verifyBridge(request, raw))) {
          return errorJson(401, "Invalid bridge signature");
        }
        let body: {
          call_sid?: string;
          end_reason?: string;
          ended_at?: string;
          transcript?: { role: "user" | "assistant"; content: string }[];
        };
        try {
          body = JSON.parse(raw);
        } catch {
          return errorJson(400, "Invalid JSON");
        }
        const callSid = body.call_sid?.trim();
        if (!callSid) return errorJson(400, "call_sid required");

        const endReason =
          body.end_reason && KNOWN_REASONS.has(body.end_reason)
            ? body.end_reason
            : body.end_reason
              ? "other"
              : null;
        const endedAt = body.ended_at ?? new Date().toISOString();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing, error: readErr } = await supabaseAdmin
          .from("calls")
          .select("id, status, agent_id")
          .eq("twilio_call_sid", callSid)
          .maybeSingle();
        if (readErr) return errorJson(500, `db read: ${readErr.message}`);
        if (!existing) {
          // Nothing to update — happens if the call row hasn't been persisted
          // yet (e.g. purely inbound testing). Return 200 so the bridge
          // doesn't retry.
          return json({ ok: true, updated: false });
        }

        const patch: Record<string, unknown> = {
          ended_at: endedAt,
          updated_at: endedAt,
        };
        if (endReason) patch.end_reason = endReason;
        if (existing.status === "in_progress" || existing.status === "ringing") {
          patch.status = "completed";
        }
        const cleanTranscript =
          Array.isArray(body.transcript) && body.transcript.length > 0
            ? body.transcript.filter(
                (t) =>
                  t &&
                  (t.role === "user" || t.role === "assistant") &&
                  typeof t.content === "string",
              )
            : null;
        if (cleanTranscript && cleanTranscript.length > 0) {
          patch.transcript = cleanTranscript;
        }

        // Run structured field extraction if the agent has data_fields defined
        // and we have a transcript to work from.
        if (cleanTranscript && cleanTranscript.length > 0 && existing.agent_id) {
          const extracted = await extractCallData(
            supabaseAdmin,
            existing.agent_id as string,
            cleanTranscript,
          );
          if (extracted) patch.extracted_data = extracted;
        }

        const { error: updErr } = await supabaseAdmin
          .from("calls")
          // end_reason / extracted_data columns were added after types.ts was
          // generated; cast until the regeneration lands.
          .update(patch as never)
          .eq("id", existing.id);
        if (updErr) return errorJson(500, `db update: ${updErr.message}`);
        return json({ ok: true, updated: true });
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Per-agent structured extraction via Lovable AI Gateway.
// ---------------------------------------------------------------------------

type DataFieldSpec = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "number" | "date" | "boolean";
  required: boolean;
};

async function extractCallData(
  admin: Awaited<ReturnType<typeof import("@/integrations/supabase/client.server").then>>["supabaseAdmin"],
  agentId: string,
  transcript: { role: "user" | "assistant"; content: string }[],
): Promise<Record<string, string | number | boolean | null> | null> {
  const { data: agent, error } = await admin
    .from("agents")
    .select("data_fields")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !agent) return null;
  const fields = ((agent as { data_fields?: unknown }).data_fields ?? []) as DataFieldSpec[];
  if (!Array.isArray(fields) || fields.length === 0) return null;

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.warn("[bridge.call-event] LOVABLE_API_KEY missing — skipping extraction");
    return null;
  }

  const fieldSpec = fields
    .map(
      (f) =>
        `- ${f.key} (${f.type}${f.required ? ", required" : ""}): ${f.label || f.key}`,
    )
    .join("\n");
  const dialogue = transcript
    .map((t) => `${t.role === "assistant" ? "Agent" : "Caller"}: ${t.content}`)
    .join("\n");

  const systemPrompt = `You extract structured data from phone call transcripts. Return ONLY a JSON object whose keys are the field keys listed below and whose values are the extracted value in the correct type (text→string, email→string, phone→string in E.164 if possible, number→number, date→ISO 8601 string, boolean→true/false). If a value was not clearly stated in the call, use null. Do not invent values. Do not include keys that are not in the field list.`;
  const userPrompt = `Fields to extract:\n${fieldSpec}\n\nTranscript:\n${dialogue}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[bridge.call-event] extraction gateway error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("[bridge.call-event] extraction returned non-JSON");
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;

    // Whitelist to the fields the agent defined, and coerce each to its type.
    const out: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      const v = raw[f.key];
      if (v === null || v === undefined || v === "") {
        out[f.key] = null;
        continue;
      }
      switch (f.type) {
        case "number": {
          const n = typeof v === "number" ? v : Number(v);
          out[f.key] = Number.isFinite(n) ? n : null;
          break;
        }
        case "boolean":
          out[f.key] =
            typeof v === "boolean"
              ? v
              : typeof v === "string"
                ? /^(true|yes|1)$/i.test(v)
                : null;
          break;
        default:
          out[f.key] = typeof v === "string" ? v : String(v);
      }
    }
    return out;
  } catch (err) {
    console.error("[bridge.call-event] extraction failed", err);
    return null;
  }
}

