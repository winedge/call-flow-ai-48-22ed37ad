import { createFileRoute } from "@tanstack/react-router";
import { get, patch, remove } from "@/lib/api/crud.server";
import { preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/agents/$id")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request, params }) =>
        requireApiKey(request) ?? (await get("agents", params.id)),
      PATCH: async ({ request, params }) =>
        requireApiKey(request) ?? (await patch("agents", params.id, request)),
      DELETE: async ({ request, params }) =>
        requireApiKey(request) ?? (await remove("agents", params.id)),
    },
  },
});
