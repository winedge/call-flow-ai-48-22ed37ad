/**
 * Bridge → Lovable: fetch a redacted agent config by id.
 *
 * Auth: HMAC via BRIDGE_SHARED_SECRET (empty body).
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyBridge } from "@/lib/voice/bridge-auth";
import { db } from "@/lib/api/store.server";
import { errorJson, json, preflight } from "@/lib/api/cors";

export const Route = createFileRoute("/api/public/bridge/agent")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        // For GET we sign the URL path+query as the "body".
        const url = new URL(request.url);
        if (!(await verifyBridge(request, url.pathname + url.search))) {
          return errorJson(401, "Invalid bridge signature");
        }
        const id = url.searchParams.get("id");
        if (!id) return errorJson(400, "id required");
        const store = db();
        const a = store.agents.find((x) => x.id === id);
        if (!a) return errorJson(404, "agent not found");
        // Strip fields the bridge doesn't need
        return json({
          id: a.id,
          name: a.name,
          voice_id: (a as unknown as { voice_id?: string }).voice_id ?? "af_bella",
          language: a.language,
          greeting: a.greeting,
          system_prompt: a.system_prompt,
          temperature: a.temperature,
        });
      },
    },
  },
});
