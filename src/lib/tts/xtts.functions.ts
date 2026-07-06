/**
 * Coqui XTTS v2 via Replicate — non-commercial (dev/eval use).
 *
 * Server-only: all Replicate traffic goes through the Lovable connector
 * gateway so the API key never touches the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MODEL_VERSION =
  "684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e";

const GATEWAY = "https://connector-gateway.lovable.dev/replicate/v1";

/**
 * Public reference WAV URLs Replicate can fetch. Each maps to a stylistic
 * "speaker preset". XTTS voice-clones from these — same speaker across
 * every language, so English/Hindi/Tamil/Telugu all come out in a
 * consistent voice.
 */
export const XTTS_SPEAKERS: Record<string, { label: string; wav: string }> = {
  female_warm: {
    label: "Warm Female",
    wav: "https://huggingface.co/spaces/coqui/xtts/resolve/main/examples/female.wav",
  },
  male_deep: {
    label: "Deep Male",
    wav: "https://huggingface.co/spaces/coqui/xtts/resolve/main/examples/male.wav",
  },
  neutral_narrator: {
    label: "Neutral Narrator",
    wav: "https://github.com/coqui-ai/TTS/raw/dev/tests/data/ljspeech/wavs/LJ001-0001.wav",
  },
};

export const XTTS_LANGUAGES = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  ta: "தமிழ் (Tamil)",
  te: "తెలుగు (Telugu)",
} as const;

const InputSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(["en", "hi", "ta", "te"]),
  speaker: z.enum(["female_warm", "male_deep", "neutral_narrator"]),
});

export type SynthesizeInput = z.infer<typeof InputSchema>;
export type SynthesizeResult = { audioUrl: string };

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<SynthesizeResult> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const replicateKey = process.env.REPLICATE_API_KEY;
    if (!lovableKey || !replicateKey) {
      throw new Error(
        "Replicate connector isn't linked. Ask the operator to link Replicate in Connectors.",
      );
    }

    const speaker = XTTS_SPEAKERS[data.speaker];
    if (!speaker) throw new Error(`Unknown speaker: ${data.speaker}`);

    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": replicateKey,
      "Content-Type": "application/json",
    };

    // 1. Create prediction
    const createRes = await fetch(`${GATEWAY}/predictions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        version: MODEL_VERSION,
        input: {
          text: data.text,
          language: data.language,
          speaker: speaker.wav,
          cleanup_voice: false,
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
        throw new Error("Replicate rate limit hit — try again in a few seconds.");
      }
      throw new Error(`Replicate error ${createRes.status}: ${body.slice(0, 200)}`);
    }

    const created = (await createRes.json()) as { id: string; status: string };
    const predictionId = created.id;

    // 2. Poll (gateway URL — never use urls.get from the payload)
    const startedAt = Date.now();
    const maxWaitMs = 60_000;
    let delay = 1200;
    while (Date.now() - startedAt < maxWaitMs) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay + 400, 3000);

      const pollRes = await fetch(`${GATEWAY}/predictions/${predictionId}`, {
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
        if (!out) throw new Error("Replicate returned no audio URL.");
        return { audioUrl: out };
      }
      if (state.status === "failed" || state.status === "canceled") {
        throw new Error(state.error ?? `Replicate prediction ${state.status}.`);
      }
    }

    throw new Error("Voice preview timed out after 60s. Try again — cold starts can be slow.");
  });
