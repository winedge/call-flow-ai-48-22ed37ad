import { createFileRoute } from "@tanstack/react-router";
import { list, create } from "@/lib/api/crud.server";
import { preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/agents")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => (requireApiKey(request) ?? (await list("agents"))),
      POST: async ({ request }) =>
        requireApiKey(request) ?? (await create("agents", request)),
    },
  },
});
