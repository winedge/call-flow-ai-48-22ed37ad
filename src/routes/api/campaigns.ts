import { createFileRoute } from "@tanstack/react-router";
import { list, create } from "@/lib/api/crud.server";
import { preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) =>
        requireApiKey(request) ?? (await list("campaigns")),
      POST: async ({ request }) =>
        requireApiKey(request) ?? (await create("campaigns", request)),
    },
  },
});
