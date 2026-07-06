import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/lib/api/store.server";
import { errorJson, json, preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/campaigns/$id/pause")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const unauth = requireApiKey(request);
        if (unauth) return unauth;
        const c = db().campaigns.find((x) => x.id === params.id);
        if (!c) return errorJson(404, "campaign not found");
        c.status = "paused";
        return json(c);
      },
    },
  },
});
