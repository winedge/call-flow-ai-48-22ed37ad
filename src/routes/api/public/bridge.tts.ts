/**
 * Bridge → Lovable: synthesize one utterance via Kokoro.
 *
 * Body: { text, voice, language }
 * Returns: { audio_url } — Replicate WAV URL, valid for ~1h.
 *
 * The bridge fetches the URL, decodes the WAV, resamples 24k→8k, μ-law
 * encodes it, and streams 20ms frames back to Twilio.
 *
 * Auth: HMAC via BRIDGE_SHARED_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyBridge } from "@/lib/voice/bridge-auth";
import { errorJson, json, preflight } from "@/lib/api/cors";

const GATEWAY = "https://connector-gateway.lovable.dev/replicate/v1";
const MODEL = "jaaari/kokoro-82m";

const InputSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().min(1),
  language: z.string().default("en"),
});

export const Route = createFileRoute("/api/public/bridge/tts")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!(await verifyBridge(request, raw))) {
          return errorJson(401, "Invalid bridge signature");
        }
        let input: z.infer<typeof InputSchema>;
        try {
          input = InputSchema.parse(JSON.parse(raw));
        } catch (e) {
          return errorJson(400, e instanceof Error ? e.message : "bad input");
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        const replicateKey = process.env.REPLICATE_API_KEY;
        if (!lovableKey || !replicateKey) {
          return errorJson(500, "Replicate connector not linked");
        }
        const headers = {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": replicateKey,
          "Content-Type": "application/json",
        };

        const createRes = await fetch(`${GATEWAY}/models/${MODEL}/predictions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { text: input.text, voice: input.voice, speed: 1.0 },
          }),
        });
        if (!createRes.ok) {
          const t = await createRes.text().catch(() => "");
          return errorJson(createRes.status, `Replicate ${createRes.status}: ${t.slice(0, 200)}`);
        }
        const { id } = (await createRes.json()) as { id: string };

        const start = Date.now();
        let delay = 800;
        while (Date.now() - start < 45_000) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay + 300, 2500);
          const poll = await fetch(`${GATEWAY}/predictions/${id}`, { headers });
          if (!poll.ok) return errorJson(poll.status, `Replicate poll ${poll.status}`);
          const s = (await poll.json()) as {
            status: string;
            output?: string | string[];
            error?: string;
          };
          if (s.status === "succeeded") {
            const out = Array.isArray(s.output) ? s.output[0] : s.output;
            if (!out) return errorJson(502, "Kokoro returned no output");
            return json({ audio_url: out });
          }
          if (s.status === "failed" || s.status === "canceled") {
            return errorJson(502, s.error ?? `Kokoro ${s.status}`);
          }
        }
        return errorJson(504, "Kokoro timed out after 45s");
      },
    },
  },
});
