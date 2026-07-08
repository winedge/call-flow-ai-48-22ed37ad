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
        let body: { call_sid?: string; end_reason?: string; ended_at?: string };
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
          .select("id, status")
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

        const { error: updErr } = await supabaseAdmin
          .from("calls")
          .update(patch)
          .eq("id", existing.id);
        if (updErr) return errorJson(500, `db update: ${updErr.message}`);
        return json({ ok: true, updated: true });
      },
    },
  },
});
