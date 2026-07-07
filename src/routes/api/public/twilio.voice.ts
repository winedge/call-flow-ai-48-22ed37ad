/**
 * Twilio Voice URL — returns TwiML that hands the call's audio to the
 * voice-bridge service via <Connect><Stream>.
 *
 * Twilio POSTs `application/x-www-form-urlencoded` with CallSid, From, To.
 * We pass the agent_id + call SID to the bridge as query params so it can
 * fetch the agent config and open a Deepgram stream tagged by call.
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

export const Route = createFileRoute("/api/public/twilio/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agent_id") ?? "";
        const raw = await request.text().catch(() => "");
        const form = new URLSearchParams(raw);
        const callSid = form.get("CallSid") ?? "";

        const bridge = process.env.BRIDGE_URL;
        if (!bridge) {
          const twiml =
            `<?xml version="1.0" encoding="UTF-8"?>` +
            `<Response><Say voice="alice">The voice bridge is not configured. Goodbye.</Say><Hangup/></Response>`;
          return new Response(twiml, {
            status: 200,
            headers: { "Content-Type": "text/xml" },
          });
        }

        // Media Streams URL: wss with query params. Bridge validates on connect.
        const stream = new URL(bridge);
        stream.pathname = "/twilio";
        stream.searchParams.set("agent_id", agentId);
        stream.searchParams.set("call_sid", callSid);
        const wsUrl = escapeXml(stream.toString());

        // <Connect> gives the bridge full-duplex audio and holds the call open
        // until it closes the socket or Twilio times out.
        const twiml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Response><Connect><Stream url="${wsUrl}"/></Connect></Response>`;
        return new Response(twiml, {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      },
    },
  },
});
