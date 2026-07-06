import { createFileRoute } from "@tanstack/react-router";
import { buildOpenApiSpec } from "@/lib/api/openapi";
import { CORS_HEADERS, preflight } from "@/lib/api/cors";

export const Route = createFileRoute("/api/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const spec = buildOpenApiSpec(`${url.protocol}//${url.host}`);
        return new Response(JSON.stringify(spec, null, 2), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      },
    },
  },
});
