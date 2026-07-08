/**
 * Twilio Programmable Voice — outbound call initiation.
 *
 * Uses standard Twilio REST (Account SID + Auth Token, HTTP Basic).
 * On connect, Twilio hits our TwiML endpoint at
 *   POST {PUBLIC_APP_URL}/api/public/twilio/voice?agent_id=...
 * which returns `<Connect><Stream url="wss://{BRIDGE_URL}/twilio?..." />`.
 *
 * Persists a row in public.calls (as the signed-in user) BEFORE returning,
 * so every Twilio status callback and bridge event can update the row by
 * twilio_call_sid.
 *
 * Also enables Answering Machine Detection so voicemail systems get either
 * a hangup or the agent's voicemail script (handled by
 * /api/public/twilio/amd).
 *
 * Required env (set in Lovable admin secrets):
 *   TWILIO_ACCOUNT_SID     – ACxxxxxxxx
 *   TWILIO_AUTH_TOKEN      – 32-char token
 *   TWILIO_FROM_NUMBER     – +15551234567 (Twilio-owned)
 *   PUBLIC_APP_URL         – https://<your-app>.lovable.app (no trailing slash)
 *   BRIDGE_URL             – wss://<bridge-host> (no trailing slash)
 *   BRIDGE_SHARED_SECRET   – auto-generated; shared with the bridge
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  to: z.string().regex(/^\+\d{8,15}$/, "E.164 phone number required"),
  agentId: z.string().min(1),
  campaignId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});

export const initiateCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ callSid: string; callId: string }> => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    const publicUrl = process.env.PUBLIC_APP_URL;
    const bridgeUrl = process.env.BRIDGE_URL;
    const missing = [
      ["TWILIO_ACCOUNT_SID", sid],
      ["TWILIO_AUTH_TOKEN", token],
      ["TWILIO_FROM_NUMBER", from],
      ["PUBLIC_APP_URL", publicUrl],
      ["BRIDGE_URL", bridgeUrl],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(
        `Missing env vars: ${missing.join(", ")} — set them in the admin secrets.`,
      );
    }

    const voiceUrl = new URL(`${publicUrl}/api/public/twilio/voice`);
    voiceUrl.searchParams.set("agent_id", data.agentId);

    const statusUrl = `${publicUrl}/api/public/webhooks/twilio`;
    const amdUrl = new URL(`${publicUrl}/api/public/twilio/amd`);
    amdUrl.searchParams.set("agent_id", data.agentId);

    const body = new URLSearchParams({
      To: data.to,
      From: from!,
      Url: voiceUrl.toString(),
      Method: "POST",
      StatusCallback: statusUrl,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent: "initiated ringing answered completed",
      // Answering Machine Detection — Twilio waits until the greeting ends
      // so we can leave a full voicemail if the agent has one.
      MachineDetection: "DetectMessageEnd",
      AsyncAmd: "true",
      AsyncAmdStatusCallback: amdUrl.toString(),
      AsyncAmdStatusCallbackMethod: "POST",
      MachineDetectionTimeout: "30",
    });

    const basic = btoa(`${sid}:${token}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Twilio ${res.status}: ${txt.slice(0, 300)}`);
    }
    const twilioJson = (await res.json()) as { sid: string };
    const callSid = twilioJson.sid;

    // Persist the call row so status callbacks + bridge events can update it.
    const { data: inserted, error: insErr } = await context.supabase
      .from("calls")
      .insert({
        user_id: context.userId,
        agent_id: data.agentId,
        campaign_id: data.campaignId ?? null,
        contact_id: data.contactId ?? null,
        phone_from: from!,
        phone_to: data.to,
        twilio_call_sid: callSid,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) {
      // Don't fail the call — the Twilio dial already succeeded. Log and
      // continue; the row can still be reconciled later via the SID.
      console.error("[initiateCall] calls insert failed:", insErr.message);
      return { callSid, callId: "" };
    }
    return { callSid, callId: inserted.id };
  });
