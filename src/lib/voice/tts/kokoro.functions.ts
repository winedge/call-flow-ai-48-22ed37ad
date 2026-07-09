/**
 * Kokoro-82M TTS via Replicate (Apache-2.0 - commercially usable).
 *
 * Server-only: all Replicate traffic goes through the Lovable connector
 * gateway so the API key never touches the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { TtsVoice } from "@/lib/voice/types";

const GATEWAY = "https://connector-gateway.lovable.dev/replicate/v1";
const MODEL = "jaaari/kokoro-82m"; // official model, uses /models/<owner>/<name>/predictions

/**
 * Kokoro speaker codes. Prefix encodes language + gender:
 *   a = American English, b = British English, h = Hindi
 *   f = female, m = male
 */
export const KOKORO_VOICES: readonly TtsVoice[] = [
  { id: "af_bella", label: "Bella (American Female, warm)", language: "en", group: "American Female" },
  { id: "af_sarah", label: "Sarah (American Female, bright)", language: "en", group: "American Female" },
  { id: "af_nicole", label: "Nicole (American Female, soft)", language: "en", group: "American Female" },
  { id: "am_michael", label: "Michael (American Male, deep)", language: "en", group: "American Male" },
  { id: "am_adam", label: "Adam (American Male, neutral)", language: "en", group: "American Male" },
  { id: "bf_emma", label: "Emma (British Female)", language: "en", group: "British Female" },
  { id: "bf_isabella", label: "Isabella (British Female)", language: "en", group: "British Female" },
  { id: "bm_lewis", label: "Lewis (British Male)", language: "en", group: "British Male" },
  { id: "bm_george", label: "George (British Male)", language: "en", group: "British Male" },
  { id: "hf_alpha", label: "Alpha (Hindi Female)", language: "hi", group: "Hindi Female" },
  { id: "hf_beta", label: "Beta (Hindi Female)", language: "hi", group: "Hindi Female" },
  { id: "hm_omega", label: "Omega (Hindi Male)", language: "hi", group: "Hindi Male" },
  { id: "hm_psi", label: "Psi (Hindi Male)", language: "hi", group: "Hindi Male" },
] as const;

export const KOKORO_LANGUAGES = {
  en: "English",
  hi: "हिन्दी (Hindi)",
} as const;

const InputSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(["en", "hi"]),
  voice: z.string().min(1),
});

export type SynthesizeKokoroInput = z.infer<typeof InputSchema>;
export type SynthesizeKokoroResult = { audioUrl: string };

export const synthesizeSpeechKokoro = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<SynthesizeKokoroResult> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const replicateKey = process.env.REPLICATE_API_KEY;
    if (!lovableKey || !replicateKey) {
      throw new Error(
        "Replicate connector isn't linked. Ask the operator to link Replicate in Connectors.",
      );
    }

    const voice = KOKORO_VOICES.find((v) => v.id === data.voice);
    if (!voice) throw new Error(`Unknown voice: ${data.voice}`);

    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": replicateKey,
      "Content-Type": "application/json",
    };

    // Create prediction against the official model endpoint.
    const createRes = await fetch(`${GATEWAY}/models/${MODEL}/predictions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: {
          text: data.text,
          voice: data.voice,
          speed: 1.0,
        },
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      if (createRes.status === 402) {
        throw new Error(
          "Replicate account is out of credit. Top up at replicate.com/account/billing.",
        );
      }
      if (createRes.status === 429) {
        throw new Error("Replicate rate limit hit - try again in a few seconds.");
      }
      throw new Error(`Replicate error ${createRes.status}: ${body.slice(0, 200)}`);
    }

    const created = (await createRes.json()) as { id: string };

    // Poll gateway (never use urls.get from payload).
    const startedAt = Date.now();
    const maxWaitMs = 60_000;
    let delay = 1000;
    while (Date.now() - startedAt < maxWaitMs) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay + 400, 3000);

      const pollRes = await fetch(`${GATEWAY}/predictions/${created.id}`, {
        headers,
      });
      if (!pollRes.ok) {
        throw new Error(`Replicate poll failed: ${pollRes.status}`);
      }
      const state = (await pollRes.json()) as {
        status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
        output?: string | string[] | null;
        error?: string | null;
      };
      if (state.status === "succeeded") {
        const out = Array.isArray(state.output) ? state.output[0] : state.output;
        if (!out) throw new Error("Kokoro returned no audio URL.");
        return { audioUrl: out };
      }
      if (state.status === "failed" || state.status === "canceled") {
        throw new Error(state.error ?? `Kokoro prediction ${state.status}.`);
      }
    }

    throw new Error("Voice preview timed out after 60s. Try again - cold starts can be slow.");
  });
