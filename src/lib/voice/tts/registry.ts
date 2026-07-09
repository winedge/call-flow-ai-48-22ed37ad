/**
 * TTS engine registry. Resolves an engine key stored on an agent to its
 * voices, languages, and synthesize function. New engines (ElevenLabs,
 * Cartesia, …) drop in as new modules + one entry here - no UI changes.
 */
import type { TtsEngine } from "@/lib/voice/types";
import {
  KOKORO_LANGUAGES,
  KOKORO_VOICES,
  synthesizeSpeechKokoro,
} from "@/lib/voice/tts/kokoro.functions";

export type TtsEngineKey = "kokoro";

export const DEFAULT_TTS_ENGINE: TtsEngineKey = "kokoro";

const KOKORO: TtsEngine = {
  id: "kokoro",
  label: "Kokoro-82M",
  license: "Apache-2.0 - commercially licensed",
  voices: KOKORO_VOICES,
  languages: KOKORO_LANGUAGES,
  synthesize: async (input) => {
    // Called via useServerFn on the client - this direct binding is used
    // only from server contexts. The route uses useServerFn(synthesizeSpeechKokoro).
    const res = await synthesizeSpeechKokoro({
      data: {
        text: input.text,
        language: input.language as "en" | "hi",
        voice: input.voice,
      },
    });
    return { audioUrl: res.audioUrl };
  },
};

const REGISTRY: Record<TtsEngineKey, TtsEngine> = {
  kokoro: KOKORO,
};

export function getTtsEngine(key: TtsEngineKey | string | undefined): TtsEngine {
  if (key && key in REGISTRY) return REGISTRY[key as TtsEngineKey];
  return REGISTRY[DEFAULT_TTS_ENGINE];
}

export { KOKORO_LANGUAGES, KOKORO_VOICES };
