/**
 * Twilio Voice URL — returns TwiML that hands the call's audio to the
 * voice-bridge service via <Connect><Stream>.
 *
 * Handles BOTH:
 *   • Outbound calls we originated — Twilio invokes this URL with
 *     `?agent_id=…` (we pass it in initiateCall). The calls row already
 *     exists.
 *   • Inbound calls to your Twilio number — Twilio invokes this URL with
 *     no query params. We look up the phone_numbers row for the `To`
 *     number and use its `inbound_agent_id` (falling back to the user's
 *     first agent). A calls row is created on the fly so the same
 *     status/end-reason webhooks persist end-to-end.
 */
import { createFileRoute } from "@tanstack/react-router";

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  }[c]!));
}

function sayAndHangup(msg: string): Response {
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say voice="alice">${escapeXml(msg)}</Say><Hangup/></Response>`;
  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export const Route = createFileRoute("/api/public/twilio/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        let agentId = url.searchParams.get("agent_id") ?? "";
        const raw = await request.text().catch(() => "");
        const form = new URLSearchParams(raw);
        const callSid = form.get("CallSid") ?? "";
        const fromNumber = form.get("From") ?? "";
        const toNumber = form.get("To") ?? "";
        const direction = form.get("Direction") ?? "";
        const isInbound =
          !agentId && (direction === "inbound" || direction === "");

        const bridge = process.env.BRIDGE_URL;
        if (!bridge) {
          return sayAndHangup("The voice bridge is not configured. Goodbye.");
        }

        // Inbound routing: look up phone_numbers by "To" number to find the
        // owner + configured inbound agent, then insert a persisted call
        // row so status webhooks + end-reason updates land on it.
        if (isInbound) {
          if (!toNumber) return sayAndHangup("Missing destination number.");
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data: phone } = await supabaseAdmin
            .from("phone_numbers")
            .select("user_id, inbound_agent_id")
            .eq("number", toNumber)
            .maybeSingle<{ user_id: string; inbound_agent_id: string | null }>();
          if (!phone) {
            return sayAndHangup(
              "This number is not configured. Goodbye.",
            );
          }
          agentId = phone.inbound_agent_id ?? "";
          if (!agentId) {
            // Fallback: first agent owned by this user
            const { data: fallback } = await supabaseAdmin
              .from("agents")
              .select("id")
              .eq("user_id", phone.user_id)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle<{ id: string }>();
            agentId = fallback?.id ?? "";
          }
          if (!agentId) {
            return sayAndHangup(
              "No AI agent is assigned to this number. Goodbye.",
            );
          }
          // Persist a call row so twilio status callbacks + bridge events
          // can update it by twilio_call_sid.
          await supabaseAdmin.from("calls").insert({
            user_id: phone.user_id,
            agent_id: agentId,
            phone_from: fromNumber,
            phone_to: toNumber,
            twilio_call_sid: callSid,
            status: "in_progress",
          } as never);
        }

        // Media Streams URL: wss with query params on the configured bridge
        // path. Bridge validates on connect. We preserve BRIDGE_URL's path
        // (e.g. Supabase edge function `/voice-bridge`), only appending query.
        const stream = new URL(bridge);
        stream.searchParams.set("agent_id", agentId);
        stream.searchParams.set("call_sid", callSid);
        const wsUrl = escapeXml(stream.toString());

        // <Start><Record> runs a dual-channel recording in the background
        // and posts to our status webhook when it's ready. <Connect> then
        // hands audio to the bridge and holds the call open.
        const appUrl = process.env.PUBLIC_APP_URL ?? "";
        const recordingCb = appUrl
          ? escapeXml(`${appUrl.replace(/\/$/, "")}/api/public/webhooks/twilio`)
          : "";
        const recordTag = recordingCb
          ? `<Start><Record recordingStatusCallback="${recordingCb}" recordingStatusCallbackEvent="completed" recordingChannels="dual"/></Start>`
          : "";
        const twiml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Response>${recordTag}<Connect><Stream url="${wsUrl}"/></Connect></Response>`;
        return new Response(twiml, {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      },
    },
  },
});
