/**
 * Bridge → Lovable: synthesize one utterance.
 *
 * Body: { text, voice, language, engine? }
 * Returns: { audio_url } — either a Replicate HTTP URL (Kokoro) or a
 * `data:audio/wav;base64,...` URL (ElevenLabs). Bridge handles both via
 * fetch(audio_url).arrayBuffer(), then parses WAV.
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
  engine: z.string().optional(),
});

/** Wrap raw 16-bit little-endian mono PCM in a minimal WAV header. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits/sample
  writeStr(36, "data");
  v.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array): string {
  // Buffer is available in the Worker/Node runtime; avoids stack overflow.
  return Buffer.from(bytes).toString("base64");
}

async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
): Promise<{ audio_url: string } | { error: string; status: number }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { error: "ElevenLabs not configured", status: 500 };

  // Request μ-law 8kHz directly — matches Twilio's wire format so the bridge
  // forwards bytes with zero resample/encode work. Biggest latency win and
  // eliminates the pitch drift that comes from off-rate playback.
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=ulaw_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/basic",
      },
      body: JSON.stringify({
        text,
        // flash_v2_5 is ElevenLabs' lowest-latency model (~75ms TTFB).
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { error: `ElevenLabs ${res.status}: ${t.slice(0, 200)}`, status: 502 };
  }
  const mulaw = new Uint8Array(await res.arrayBuffer());
  // Custom media type — the bridge detects this and skips WAV parsing.
  return { audio_url: `data:audio/mulaw;base64,${toBase64(mulaw)}` };
}

async function synthesizeKokoro(
  text: string,
  voice: string,
): Promise<{ audio_url: string } | { error: string; status: number }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const replicateKey = process.env.REPLICATE_API_KEY;
  if (!lovableKey || !replicateKey) {
    return { error: "Replicate connector not linked", status: 500 };
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
      input: { text, voice, speed: 1.0 },
    }),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    return { error: `Replicate ${createRes.status}: ${t.slice(0, 200)}`, status: createRes.status };
  }
  const { id } = (await createRes.json()) as { id: string };
  const start = Date.now();
  let delay = 800;
  while (Date.now() - start < 45_000) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 300, 2500);
    const poll = await fetch(`${GATEWAY}/predictions/${id}`, { headers });
    if (!poll.ok) return { error: `Replicate poll ${poll.status}`, status: poll.status };
    const s = (await poll.json()) as {
      status: string;
      output?: string | string[];
      error?: string;
    };
    if (s.status === "succeeded") {
      const out = Array.isArray(s.output) ? s.output[0] : s.output;
      if (!out) return { error: "Kokoro returned no output", status: 502 };
      return { audio_url: out };
    }
    if (s.status === "failed" || s.status === "canceled") {
      return { error: s.error ?? `Kokoro ${s.status}`, status: 502 };
    }
  }
  return { error: "Kokoro timed out after 45s", status: 504 };
}

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

        const result =
          input.engine === "elevenlabs"
            ? await synthesizeElevenLabs(input.text, input.voice)
            : await synthesizeKokoro(input.text, input.voice);

        if ("error" in result) return errorJson(result.status, result.error);
        return json({ audio_url: result.audio_url });
      },
    },
  },
});
