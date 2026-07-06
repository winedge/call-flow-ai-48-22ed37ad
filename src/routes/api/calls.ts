import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/lib/api/store.server";
import { json, preflight, requireApiKey } from "@/lib/api/cors";

export const Route = createFileRoute("/api/calls")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const unauth = requireApiKey(request);
        if (unauth) return unauth;
        const url = new URL(request.url);
        const campaignId = url.searchParams.get("campaign_id");
        const status = url.searchParams.get("status");
        const limit = Math.min(
          Number(url.searchParams.get("limit") ?? 50),
          500,
        );
        let rows = db().calls;
        if (campaignId) rows = rows.filter((c) => c.campaign_id === campaignId);
        if (status) rows = rows.filter((c) => c.status === status);
        rows = rows.slice(-limit).reverse();
        return json({ data: rows, count: rows.length });
      },
    },
  },
});
