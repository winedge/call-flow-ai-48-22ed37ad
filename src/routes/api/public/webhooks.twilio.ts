import { createFileRoute } from "@tanstack/react-router";
import { db, newId, nowIso, type Call } from "@/lib/api/store.server";
import { errorJson, json, preflight } from "@/lib/api/cors";

// Twilio -> internal status map
const STATUS: Record<string, Call["status"]> = {
  queued: "queued",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  "no-answer": "no_answer",
  canceled: "failed",
};

async function readBody(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

/**
 * Verifies Twilio's HMAC-SHA1 X-Twilio-Signature.
 * Skipped when TWILIO_AUTH_TOKEN is not set (preview/dev).
 */
async function verifyTwilio(request: Request, raw: string): Promise<boolean> {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true;
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;
  const url = request.url;
  const params = new URLSearchParams(raw);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const payload = url + sorted.map(([k, v]) => k + v).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

export const Route = createFileRoute("/api/public/webhooks/twilio")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = await request.clone().text();
        if (!(await verifyTwilio(request, raw))) {
          return errorJson(401, "Invalid Twilio signature");
        }
        const body = await readBody(new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: raw,
        }));

        const sid = body.CallSid;
        if (!sid) return errorJson(400, "CallSid required");

        const status = STATUS[body.CallStatus] ?? "in_progress";
        const store = db();
        let call = store.calls.find((c) => c.provider_call_sid === sid);
        if (!call) {
          call = {
            id: newId(),
            campaign_id: null,
            contact_id: null,
            agent_id: null,
            from_number: body.From ?? "",
            to_number: body.To ?? "",
            status,
            outcome: null,
            duration_seconds: Number(body.CallDuration ?? 0),
            recording_url: body.RecordingUrl ?? null,
            transcript: [],
            provider_call_sid: sid,
            started_at: nowIso(),
            ended_at: null,
          };
          store.calls.push(call);
        } else {
          call.status = status;
          if (body.CallDuration) call.duration_seconds = Number(body.CallDuration);
          if (body.RecordingUrl) call.recording_url = body.RecordingUrl;
        }
        if (["completed", "failed", "no_answer", "busy"].includes(status)) {
          call.ended_at = nowIso();
          // Fire matching automations
          const trig =
            status === "completed"
              ? "call.completed"
              : status === "no_answer"
                ? "call.no_answer"
                : "call.failed";
          for (const a of store.automations.filter(
            (x) => x.enabled && x.trigger === trig,
          )) {
            // Fire-and-forget outbound webhook actions
            const url = (a.config as { url?: string })?.url;
            if (a.action === "webhook" && url) {
              fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event: trig, call, automation: a.id }),
              }).catch(() => {});
            }
          }
        }
        return json({ ok: true, call_id: call.id });
      },
    },
  },
});
