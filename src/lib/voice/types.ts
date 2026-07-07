/**
 * Shared engine interfaces for the voice stack.
 * Concrete engines (Kokoro, Deepgram, Twilio…) implement these and are
 * resolved through registries so the app never hard-codes a vendor.
 */

export type TtsLanguageCode = string;

export type TtsVoice = {
  /** Stable identifier stored on the agent (e.g. "af_bella"). */
  id: string;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** ISO-ish language code this voice speaks natively. */
  language: TtsLanguageCode;
  /** Optional grouping (e.g. "American Female"). */
  group?: string;
};

export type TtsSynthesizeInput = {
  text: string;
  language: TtsLanguageCode;
  voice: string;
};

export type TtsSynthesizeResult = {
  audioUrl: string;
};

export type TtsEngine = {
  /** Stable engine key ("kokoro", "xtts", …). */
  id: string;
  /** Human-friendly label. */
  label: string;
  /** Licensing note surfaced in the UI. */
  license: string;
  voices: readonly TtsVoice[];
  languages: Readonly<Record<TtsLanguageCode, string>>;
  synthesize: (input: TtsSynthesizeInput) => Promise<TtsSynthesizeResult>;
};

// ---------- STT ----------
export type SttEngine = {
  id: string;
  label: string;
  /** Streaming transcription — implementations differ; Phase B fills this in. */
  transcribeStream: (audio: ReadableStream<Uint8Array>) => AsyncIterable<string>;
};

// ---------- Telephony ----------
export type PlaceCallInput = {
  to: string;
  from: string;
  agentId: string;
};

export type TelephonyProvider = {
  id: string;
  label: string;
  /** Approx US outbound cost per minute, used for cost math in the UI. */
  costPerMinuteUsd: number;
  placeCall: (input: PlaceCallInput) => Promise<{ callId: string }>;
};
