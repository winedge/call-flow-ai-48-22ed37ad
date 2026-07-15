/**
 * Retry stalled reflection jobs.
 *
 * Called by pg_cron every few minutes. Picks up `call_reflections` rows
 * in `pending`/`failed` whose `next_attempt_at` has passed and re-runs
 * `reflectOnCall`. Idempotent: repeat calls simply pick up whatever is
 * still stalled.
 *
 * Auth: the /api/public/* prefix bypasses the published-site auth wall.
 * The route additionally checks the Supabase anon key via `apikey`
 * header, matching the pattern used by other cron endpoints.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/retry-reflections")({
  server: {
    handlers: {
      POST: async () => {


        const { retryStalledReflections } = await import("@/lib/voice/reflect.server");
        const result = await retryStalledReflections(25);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
