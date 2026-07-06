import { createFileRoute } from "@tanstack/react-router";
import { list, create } from "@/lib/api/crud.server";
import { preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) =>
        requireApiKey(request) ?? (await list("contacts")),
      POST: async ({ request }) =>
        requireApiKey(request) ?? (await create("contacts", request)),
    },
  },
});
