import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/lib/api/store.server";
import { errorJson, json, preflight } from "@/lib/api/cors";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifyHmac(request: Request, raw: string): Promise<boolean> {
  const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
  if (!secret) return true;
  const given = request.headers.get("x-webhook-signature");
  if (!given) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(given.replace(/^sha256=/, ""), expected);
}

export const Route = createFileRoute("/api/public/webhooks/automations")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!(await verifyHmac(request, raw))) {
          return errorJson(401, "Invalid signature");
        }
        let body: { automation_id?: string; payload?: unknown };
        try {
          body = JSON.parse(raw);
        } catch {
          return errorJson(400, "Invalid JSON");
        }
        if (!body.automation_id) return errorJson(400, "automation_id required");

        const store = db();
        const a = store.automations.find((x) => x.id === body.automation_id);
        if (!a) return errorJson(404, "automation not found");
        if (!a.enabled) return errorJson(400, "automation disabled");

        // Forward to configured URL if action is webhook
        const url = (a.config as { url?: string })?.url;
        if (a.action === "webhook" && url) {
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "webhook",
              automation: a.id,
              payload: body.payload ?? {},
            }),
          }).catch(() => {});
        }
        return json({ ok: true, automation_id: a.id }, { status: 202 });
      },
    },
  },
});
