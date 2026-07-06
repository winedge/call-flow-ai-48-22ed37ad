import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/lib/api/store.server";
import { errorJson, json, preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/calls/$id")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) => {
        const unauth = requireApiKey(request);
        if (unauth) return unauth;
        const row = db().calls.find((c) => c.id === params.id);
        if (!row) return errorJson(404, "call not found");
        return json(row);
      },
    },
  },
});
