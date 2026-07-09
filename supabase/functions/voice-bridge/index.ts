/**
 * voice-bridge — Deno edge function port of services/voice-bridge.
 *
 * Twilio Media Streams (μ-law/8k) <-> Deepgram STT <-> Lovable app
 * (Gemini turn + Kokoro TTS). Full-duplex over a single WebSocket that
 * Twilio holds open for the length of the call.
 *
 * NOTE ON DURATION: Supabase Edge Functions terminate long-running
 * requests after ~150s (free) to ~400s (paid). Calls longer than that
 * will be cut off. For unbounded calls, deploy services/voice-bridge/
 * to a VPS instead and repoint BRIDGE_URL.
 *
 * Required secrets:
 *   DEEPGRAM_API_KEY
 *   LOVABLE_APP_URL         e.g. https://<project>.lovable.app
 *   BRIDGE_SHARED_SECRET    matches PUBLIC_APP side
 */

// ---------- audio helpers ----------

function linearToMuLaw(sample: number): number {
  const MU = 0xff;
  const BIAS = 0x84;
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  if (sample > 32635) sample = 32635;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & MU;
}

function muLawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function rmsMuLaw(mu: Uint8Array): number {
  if (!mu.length) return 0;
  let sum = 0;
  for (let i = 0; i < mu.length; i++) {
    const s = muLawToLinear(mu[i]);
    sum += s * s;
  }
  return Math.sqrt(sum / mu.length);
}

function silenceFrame(size = 160): Uint8Array {
  return new Uint8Array(size).fill(0xff);
}

function downsampleTo8k(pcm: Int16Array, srcRate: number): Int16Array {
  if (srcRate === 8000) return pcm;
  const ratio = srcRate / 8000;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += pcm[j];
      n++;
    }
    out[i] = n ? Math.max(-32768, Math.min(32767, Math.round(sum / n))) : 0;
  }
  return out;
}

function pcm8kToMuLaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = linearToMuLaw(pcm[i]);
  return out;
}

function chunk20ms(mu: Uint8Array): Uint8Array[] {
  const size = 160;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < mu.length; i += size) {
    const end = Math.min(i + size, mu.length);
    if (end - i === size) {
      frames.push(mu.subarray(i, end));
    } else {
      const last = new Uint8Array(size).fill(0xff);
      last.set(mu.subarray(i, end));
      frames.push(last);
    }
  }
  return frames;
}

/**
 * Parse a mono 16-bit PCM WAV into {sampleRate, samples}.
 * Handles standard RIFF/WAVE with a `data` chunk (Kokoro output).
 */
function parseWav(buf: ArrayBuffer): { sampleRate: number; samples: Int16Array } {
  const view = new DataView(buf);
  const td = new TextDecoder();
  if (td.decode(new Uint8Array(buf, 0, 4)) !== "RIFF") throw new Error("not RIFF");
  if (td.decode(new Uint8Array(buf, 8, 4)) !== "WAVE") throw new Error("not WAVE");
  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 16;
  let numChannels = 1;
  let dataOffset = 0;
  let dataLen = 0;
  while (offset < view.byteLength - 8) {
    const id = td.decode(new Uint8Array(buf, offset, 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (!sampleRate || !dataOffset) throw new Error("wav parse: missing fmt/data");
  if (bitsPerSample !== 16) throw new Error(`wav: unsupported ${bitsPerSample}-bit`);
  const total = dataLen / 2;
  const src = new Int16Array(buf, dataOffset, total);
  if (numChannels === 1) return { sampleRate, samples: new Int16Array(src) };
  // Downmix stereo to mono
  const mono = new Int16Array(total / numChannels);
  for (let i = 0, j = 0; j < mono.length; i += numChannels, j++) {
    let sum = 0;
    for (let c = 0; c < numChannels; c++) sum += src[i + c];
    mono[j] = Math.round(sum / numChannels);
  }
  return { sampleRate, samples: mono };
}

// ---------- HMAC signer to the Lovable app ----------

const APP_URL = Deno.env.get("APP_URL") ?? Deno.env.get("LOVABLE_APP_URL") ?? Deno.env.get("PUBLIC_APP_URL") ?? "";
const SHARED_SECRET = Deno.env.get("BRIDGE_SHARED_SECRET") ?? "";
const DEEPGRAM_KEY = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";

const enc = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(SHARED_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string): Promise<{ ts: string; sig: string }> {
  const ts = Date.now().toString();
  const key = await hmacKey();
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return { ts, sig: hex };
}

type AgentConfig = {
  id: string;
  name: string;
  voice_id: string;
  language: string;
  greeting: string;
  system_prompt: string;
  temperature: number;
  transfer_number?: string;
  end_call_conditions?: string[];
  voicemail_handling?: string;
  voicemail_message?: string;
  max_call_seconds?: number;
  silence_timeout_seconds?: number;
  tts_engine?: string;
  speak_first?: boolean;
  voice_settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
};

const DIGIT_WORDS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

function digitWords(value: string): string {
  return [...value].map((d) => DIGIT_WORDS[d] ?? d).join(" ");
}

function chunkPhoneDigits(digits: string): string[] {
  if (digits.length <= 4) return [digits];
  if (digits.length === 10) return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  if (digits.length === 11 && digits.startsWith("1")) return [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7)];
  const chunks: string[] = [];
  let i = 0;
  if (digits.length > 10) {
    const countryLen = digits.length === 11 ? 1 : 2;
    chunks.push(digits.slice(0, countryLen));
    i = countryLen;
  }
  while (i < digits.length) {
    const remaining = digits.length - i;
    const size = remaining === 4 ? 4 : Math.min(3, remaining);
    chunks.push(digits.slice(i, i + size));
    i += size;
  }
  return chunks;
}

function prepareSpeechText(text: string): string {
  return text
    .replace(/(^|[^\w])(\+?\d[\d\s().-]{6,}\d)(?=$|[^\w])/g, (_all, prefix: string, phone: string) => {
      const hasPlus = phone.trim().startsWith("+");
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return `${prefix}${phone}`;
      const spoken = chunkPhoneDigits(digits).map(digitWords).join("... ");
      return `${prefix}${hasPlus ? `plus... ${spoken}` : spoken}`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAgent(id: string): Promise<AgentConfig> {
  const path = `/api/public/bridge/agent?id=${encodeURIComponent(id)}`;
  const { ts, sig } = await sign(path);
  const res = await fetch(`${APP_URL}${path}`, {
    headers: { "X-Bridge-Timestamp": ts, "X-Bridge-Signature": sig },
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function runTurn(
  agent: AgentConfig,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ reply: string; end_call: boolean; transfer: boolean }> {
  const body = JSON.stringify({ agent, history });
  const { ts, sig } = await sign(body);
  const res = await fetch(`${APP_URL}/api/public/bridge/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Timestamp": ts,
      "X-Bridge-Signature": sig,
    },
    body,
  });
  if (!res.ok) throw new Error(`turn ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function requestTransfer(callSid: string, to: string): Promise<void> {
  const body = JSON.stringify({ call_sid: callSid, transfer_number: to });
  const { ts, sig } = await sign(body);
  const res = await fetch(`${APP_URL}/api/public/bridge/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Timestamp": ts,
      "X-Bridge-Signature": sig,
    },
    body,
  });
  if (!res.ok) throw new Error(`transfer ${res.status}: ${await res.text()}`);
}

/**
 * Fire-and-forget: tell the app why this call ended so the UI can show it.
 * Never throws — we're mid-cleanup and can't afford to interrupt.
 */
async function reportCallEvent(
  callSid: string,
  endReason: string,
  transcript?: { role: "user" | "assistant"; content: string }[],
): Promise<void> {
  try {
    const body = JSON.stringify({
      call_sid: callSid,
      end_reason: endReason,
      ended_at: new Date().toISOString(),
      transcript,
    });
    const { ts, sig } = await sign(body);
    await fetch(`${APP_URL}/api/public/bridge/call-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Timestamp": ts,
        "X-Bridge-Signature": sig,
      },
      body,
    });
  } catch (e) {
    console.error("call-event report failed", e);
  }
}

/**
 * Map internal cleanup reasons to the canonical end_reason vocabulary
 * used by the UI (see src/lib/voice/call-end-reasons.ts).
 */
function classifyEndReason(raw: string): string {
  const r = raw.toLowerCase();
  if (r.startsWith("agent ended")) return "agent_ended";
  if (r.startsWith("transfer")) return "transfer";
  if (r.startsWith("max duration")) return "max_duration";
  if (r.startsWith("silence")) return "silence_timeout";
  if (r === "twilio stop" || r.startsWith("socket closed")) return "caller_hangup";
  if (r.startsWith("agent config") || r.startsWith("agent not loaded")) return "agent_config_error";
  if (r.startsWith("socket error")) return "bridge_error";
  return "other";
}

async function synthTts(
  text: string,
  voice: string,
  language: string,
  engine?: string,
  voice_settings?: AgentConfig["voice_settings"],
): Promise<{ audio_url: string }> {
  const body = JSON.stringify({ text, voice, language, engine, voice_settings });
  const { ts, sig } = await sign(body);
  const res = await fetch(`${APP_URL}/api/public/bridge/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Timestamp": ts,
      "X-Bridge-Signature": sig,
    },
    body,
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function synthElevenLabsMulaw(
  text: string,
  voice: string,
  voice_settings?: AgentConfig["voice_settings"],
): Promise<Uint8Array> {
  if (!ELEVENLABS_KEY) throw new Error("ElevenLabs not configured on bridge");
  const settings = {
    stability: voice_settings?.stability ?? 0.65,
    similarity_boost: voice_settings?.similarity_boost ?? 0.78,
    style: voice_settings?.style ?? 0.0,
    use_speaker_boost: voice_settings?.use_speaker_boost ?? true,
    speed: 0.94,
  };
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "Content-Type": "application/json",
        Accept: "audio/basic",
      },
      body: JSON.stringify({
        text: prepareSpeechText(text),
        model_id: "eleven_turbo_v2_5",
        voice_settings: settings,
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => "")}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function openElevenLabsMulawStream(
  text: string,
  voice: string,
  voice_settings?: AgentConfig["voice_settings"],
): Promise<ReadableStream<Uint8Array>> {
  if (!ELEVENLABS_KEY) throw new Error("ElevenLabs not configured on bridge");
  const settings = {
    stability: voice_settings?.stability ?? 0.65,
    similarity_boost: voice_settings?.similarity_boost ?? 0.78,
    style: voice_settings?.style ?? 0.0,
    use_speaker_boost: voice_settings?.use_speaker_boost ?? true,
    speed: 0.94,
  };
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "Content-Type": "application/json",
        Accept: "audio/basic",
      },
      body: JSON.stringify({
        text: prepareSpeechText(text),
        model_id: "eleven_turbo_v2_5",
        voice_settings: settings,
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => "")}`);
  if (!res.body) throw new Error("ElevenLabs stream returned no body");
  return res.body;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function sendMulawFrame(s: Session, frame: Uint8Array) {
  let bin = "";
  for (let j = 0; j < frame.length; j++) bin += String.fromCharCode(frame[j]);
  s.twilio.send(JSON.stringify({
    event: "media",
    streamSid: s.streamSid,
    media: { payload: btoa(bin) },
  }));
}

async function awaitBriefly<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- Deepgram streaming STT ----------

type DgHandle = { send: (mu: Uint8Array) => void; close: () => void };

function openDeepgram(cb: {
  onOpen: () => void;
  onInterim: (t: string) => void;
  onFinal: (t: string, speechFinal: boolean) => void;
  onUtteranceEnd: () => void;
  onSpeechStart: () => void;
  onClose: (ev: CloseEvent) => void;
  onError: (e: unknown) => void;
}): DgHandle {
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("encoding", "mulaw");
  url.searchParams.set("sample_rate", "8000");
  url.searchParams.set("channels", "1");
  url.searchParams.set("model", "nova-2-phonecall");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  // Endpointing: silence (ms) before Deepgram commits a `speech_final`.
  // Keep this tight; our local noise gate prevents background office noise
  // from becoming speech while still letting real callers finish naturally.
  // watchdog below covers cases where the model never marks speech_final.
  url.searchParams.set("endpointing", "180");
  // VAD events give us a hard UtteranceEnd signal — used to flush any
  // buffered finals when Deepgram doesn't emit speech_final in time.
  url.searchParams.set("vad_events", "true");
  // Deepgram currently rejects values under 1000ms with HTTP 400. Keep this
  // at the supported minimum and rely on endpointing + local timers for speed.
  url.searchParams.set("utterance_end_ms", "1000");

  const ws = new WebSocket(url.toString(), ["token", DEEPGRAM_KEY]);
  let closed = false;

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "Results") {
        const t = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!t) return;
        if (msg.is_final || msg.speech_final) cb.onFinal(t, !!msg.speech_final);
        else cb.onInterim(t);
      } else if (msg.type === "UtteranceEnd") {
        cb.onUtteranceEnd();
      } else if (msg.type === "SpeechStarted") {
        cb.onSpeechStart();
      }
    } catch (e) {
      cb.onError(e);
    }
  });
  ws.addEventListener("open", () => cb.onOpen());
  ws.addEventListener("close", (ev) => {
    closed = true;
    cb.onClose(ev);
  });
  ws.addEventListener("error", (e) => cb.onError(e));

  return {
    send: (mu) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(mu);
    },
    close: () => {
      if (closed) return;
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch { /* ignore */ }
      ws.close();
    },
  };
}

// ---------- session ----------

type Session = {
  twilio: WebSocket;
  streamSid: string | null;
  callSid: string | null;
  agentId: string | null;
  agent: AgentConfig | null;
  agentReady: boolean;
  dg: DgHandle | null;
  dgReconnects: number;
  history: { role: "user" | "assistant"; content: string }[];
  speaking: boolean;
  greeted: boolean;
  turnLock: boolean;
  cancelSpeech: () => void;
  closed: boolean;
  lastUserAudioAt: number;
  timers: ReturnType<typeof setTimeout>[];
  playbackMark: string | null;
  finishPlayback: () => void;
  greetingAudio: { text: string; buffered: Uint8Array[]; done: boolean; error: unknown; waiters: Array<() => void> } | null;
  queuedUserText: string;
  activeTurnInterrupted: boolean;
  noiseGate: {
    noiseFloor: number;
    speechFrames: number;
    silenceFrames: number;
    inSpeech: boolean;
    preRoll: Uint8Array[];
    voiceMsSinceCommit: number;
    lastVoiceAt: number;
  };
};

function gateInboundAudio(s: Session, bytes: Uint8Array): Uint8Array[] {
  const g = s.noiseGate;
  const rms = rmsMuLaw(bytes);
  const openThreshold = Math.max(650, g.noiseFloor * 3.1);
  const keepOpenThreshold = Math.max(420, g.noiseFloor * 1.75);
  const loud = g.inSpeech ? rms > keepOpenThreshold : rms > openThreshold;

  if (!g.inSpeech) {
    g.preRoll.push(bytes);
    while (g.preRoll.length > 5) g.preRoll.shift();

    if (!loud) {
      g.speechFrames = 0;
      g.noiseFloor = g.noiseFloor * 0.95 + rms * 0.05;
      return [silenceFrame(bytes.length)];
    }

    g.speechFrames++;
    // Require either two consecutive loud frames or one very clear speech
    // frame. This rejects keyboard/room spikes without clipping real speech.
    if (g.speechFrames < 2 && rms < openThreshold * 1.55) {
      return [silenceFrame(bytes.length)];
    }

    g.inSpeech = true;
    g.silenceFrames = 0;
    g.lastVoiceAt = Date.now();
    g.voiceMsSinceCommit += g.speechFrames * 20;
    const out = g.preRoll;
    g.preRoll = [];
    return out;
  }

  if (loud) {
    g.silenceFrames = 0;
    g.lastVoiceAt = Date.now();
    g.voiceMsSinceCommit += 20;
    return [bytes];
  }

  g.silenceFrames++;
  if (g.silenceFrames >= 12) {
    g.inSpeech = false;
    g.speechFrames = 0;
    g.preRoll = [];
    g.noiseFloor = g.noiseFloor * 0.98 + rms * 0.02;
  }
  return [silenceFrame(bytes.length)];
}

function decodeBootstrap(raw?: string): Partial<AgentConfig> | null {
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as Partial<AgentConfig>;
  } catch {
    return null;
  }
}

function initialPathMetadata(pathname: string): { agentId: string | null; callSid: string | null; bootstrap: Partial<AgentConfig> | null } {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const idx = parts.findIndex((p) => p === "voice-bridge");
  if (idx < 0) return { agentId: null, callSid: null, bootstrap: null };
  const agentId = parts[idx + 1] && parts[idx + 1] !== "healthz" ? parts[idx + 1] : null;
  const callSid = parts[idx + 2] && parts[idx + 2] !== "unknown" ? parts[idx + 2] : null;
  const bootstrap = decodeBootstrap(parts[idx + 3]);
  return { agentId, callSid, bootstrap };
}

function bootstrapAgent(agentId: string | null, bootstrap: Partial<AgentConfig> | null): AgentConfig | null {
  if (!agentId || !bootstrap) return null;
  return {
    id: agentId,
    name: bootstrap.name ?? "",
    voice_id: bootstrap.voice_id || "af_bella",
    language: bootstrap.language || "en",
    greeting: bootstrap.greeting || "Hello, this is your AI assistant.",
    system_prompt: "",
    temperature: 0.6,
    tts_engine: bootstrap.tts_engine || "elevenlabs",
    speak_first: bootstrap.speak_first ?? true,
    voice_settings: bootstrap.voice_settings,
  };
}

function primeGreeting(s: Session, a: AgentConfig) {
  if (s.greeted || a.speak_first === false || s.greetingAudio) return;
  if (a.tts_engine !== "elevenlabs" || !ELEVENLABS_KEY) return;
  const greeting = a.greeting || "Hello, this is your AI assistant.";
  const state: NonNullable<Session["greetingAudio"]> = {
    text: greeting,
    buffered: [],
    done: false,
    error: null,
    waiters: [],
  };
  s.greetingAudio = state;
  const notify = () => {
    const ws = state.waiters.splice(0);
    for (const w of ws) w();
  };
  (async () => {
    try {
      const stream = await openElevenLabsMulawStream(greeting, a.voice_id, a.voice_settings);
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) {
            state.buffered.push(value);
            notify();
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
    } catch (e) {
      state.error = e;
      console.error("greeting prefetch failed", e);
    } finally {
      state.done = true;
      notify();
    }
  })();
}

function looksLikeSpeech(text: string, voiceMs: number): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 2 || voiceMs < 100) return false;
  if (/^(uh+|um+|hm+|hmm+|ah+|er+|mm+|noise|background|music|cough|laugh)$/.test(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length >= 2) return true;

  const shortAnswers = new Set([
    "yes", "yeah", "yep", "no", "nope", "okay", "ok", "sure", "hello", "hi", "thanks", "bye", "correct", "right",
  ]);
  return normalized.length >= 4 || shortAnswers.has(normalized);
}

async function speak(s: Session, text: string) {
  if (!s.agent || !s.streamSid || s.closed) return;
  let cancelled = false;
  const markName = `utterance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let finishPlayback = () => {};
  const playbackDone = new Promise<void>((resolve) => {
    finishPlayback = resolve;
  });
  s.playbackMark = markName;
  s.finishPlayback = finishPlayback;
  s.cancelSpeech = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      s.twilio.send(JSON.stringify({ event: "clear", streamSid: s.streamSid }));
    } catch { /* ignore */ }
    finishPlayback();
  };
  s.speaking = true;
  let sentFrames = 0;
  try {
    if (s.agent.tts_engine === "elevenlabs" && ELEVENLABS_KEY) {
      const preload = s.greetingAudio?.text === text ? s.greetingAudio : null;
      if (preload) s.greetingAudio = null;
      if (preload) {
        let carry = new Uint8Array(0);
        let idx = 0;
        while (!cancelled && !s.closed) {
          if (idx >= preload.buffered.length) {
            if (preload.done) break;
            await new Promise<void>((resolve) => preload.waiters.push(resolve));
            continue;
          }
          const chunk = preload.buffered[idx++];
          const buf = concatBytes(carry, chunk);
          const frameable = Math.floor(buf.length / 160) * 160;
          for (let i = 0; i < frameable; i += 160) {
            if (cancelled || s.closed) break;
            sendMulawFrame(s, buf.subarray(i, i + 160));
            sentFrames++;
          }
          carry = buf.subarray(frameable);
        }
        if (preload.error && sentFrames === 0) {
          // Prefetch failed before any bytes; fall back to a fresh stream.
          const stream = await openElevenLabsMulawStream(text, s.agent.voice_id, s.agent.voice_settings);
          const reader = stream.getReader();
          let carry2 = new Uint8Array(0);
          try {
            while (!cancelled && !s.closed) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value?.length) continue;
              const buf = concatBytes(carry2, value);
              const frameable = Math.floor(buf.length / 160) * 160;
              for (let i = 0; i < frameable; i += 160) {
                if (cancelled || s.closed) break;
                sendMulawFrame(s, buf.subarray(i, i + 160));
                sentFrames++;
              }
              carry2 = buf.subarray(frameable);
            }
          } finally {
            try { reader.releaseLock(); } catch { /* ignore */ }
          }
          if (!cancelled && !s.closed && carry2.length) {
            const last = new Uint8Array(160).fill(0xff);
            last.set(carry2.subarray(0, Math.min(160, carry2.length)));
            sendMulawFrame(s, last);
            sentFrames++;
          }
        } else if (!cancelled && !s.closed && carry.length) {
          const last = new Uint8Array(160).fill(0xff);
          last.set(carry.subarray(0, Math.min(160, carry.length)));
          sendMulawFrame(s, last);
          sentFrames++;
        }
      } else {
        const stream = await openElevenLabsMulawStream(text, s.agent.voice_id, s.agent.voice_settings);
        const reader = stream.getReader();
        let carry = new Uint8Array(0);
        try {
          while (!cancelled && !s.closed) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value?.length) continue;
            const buf = concatBytes(carry, value);
            const frameable = Math.floor(buf.length / 160) * 160;
            for (let i = 0; i < frameable; i += 160) {
              if (cancelled || s.closed) break;
              sendMulawFrame(s, buf.subarray(i, i + 160));
              sentFrames++;
            }
            carry = buf.subarray(frameable);
          }
        } finally {
          try { reader.releaseLock(); } catch { /* ignore */ }
        }
        if (!cancelled && !s.closed && carry.length) {
          const last = new Uint8Array(160).fill(0xff);
          last.set(carry.subarray(0, 160));
          sendMulawFrame(s, last);
          sentFrames++;
        }
      }
    } else {
      const { audio_url } = await synthTts(text, s.agent.voice_id, s.agent.language, s.agent.tts_engine, s.agent.voice_settings);
      if (cancelled || s.closed) return;
      let mu: Uint8Array;
      if (audio_url.startsWith("data:audio/mulaw;base64,")) {
        const b64 = audio_url.slice("data:audio/mulaw;base64,".length);
        const bin = atob(b64);
        mu = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) mu[i] = bin.charCodeAt(i);
      } else {
        const buf = await (await fetch(audio_url)).arrayBuffer();
        if (cancelled || s.closed) return;
        const { sampleRate, samples } = parseWav(buf);
        const pcm8k = downsampleTo8k(samples, sampleRate);
        mu = pcm8kToMuLaw(pcm8k);
      }
      for (const frame of chunk20ms(mu)) {
        if (cancelled || s.closed) break;
        sendMulawFrame(s, frame);
        sentFrames++;
      }
    }
    if (!cancelled && !s.closed) {
      s.twilio.send(JSON.stringify({
        event: "mark",
        streamSid: s.streamSid,
        mark: { name: markName },
      }));
      const fallback = setTimeout(finishPlayback, Math.max(500, sentFrames * 20 + 750));
      await playbackDone.finally(() => clearTimeout(fallback));
    }
  } catch (e) {
    console.error("tts failed", e);
  } finally {
    if (s.playbackMark === markName) {
      s.playbackMark = null;
      s.finishPlayback = () => {};
    }
    s.speaking = false;
    s.cancelSpeech = () => {};
  }
}

async function handleUserTurn(s: Session, text: string) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) return;
  if (!s.agentReady || !s.agent || s.turnLock) {
    s.queuedUserText = s.queuedUserText ? `${s.queuedUserText} ${cleanText}` : cleanText;
    if (s.agentReady && s.agent) s.activeTurnInterrupted = true;
    return;
  }
  s.turnLock = true;
  s.activeTurnInterrupted = false;
  s.history.push({ role: "user", content: cleanText });
  try {
    const { reply, end_call, transfer } = await runTurn(s.agent, s.history);
    if (s.activeTurnInterrupted || s.queuedUserText) return;
    if (!reply && !end_call && !transfer) return;
    if (reply) {
      s.history.push({ role: "assistant", content: reply });
      await speak(s, reply);
      if (s.activeTurnInterrupted || s.queuedUserText) return;
    }
    if (transfer) {
      const to = s.agent.transfer_number?.trim();
      if (to && s.callSid) {
        await new Promise((r) => setTimeout(r, 300));
        try {
          await requestTransfer(s.callSid, to);
          // Report the transfer up front — Twilio will drop the <Stream>
          // as soon as it fetches new TwiML, and socket.onclose fires
          // cleanup with "socket closed" which would otherwise be
          // (mis)classified as caller_hangup.
          void reportCallEvent(s.callSid, "transfer", s.history);
          s.callSid = null; // suppress duplicate report from cleanup
        } catch (e) {
          console.error("transfer failed", e);
          await speak(s, "I couldn't complete the transfer. Let me take a message instead.");
        }
      } else {
        console.warn("transfer requested but no target or call_sid");
      }
      return;
    }
    if (end_call) {
      await new Promise((r) => setTimeout(r, 400));
      cleanup(s, "agent ended call");
    }
  } catch (e) {
    console.error("turn failed", e);
    if (!s.activeTurnInterrupted && !s.queuedUserText) {
      await speak(s, "Sorry, I had a technical issue. Could you say that again?");
    }
  } finally {
    s.turnLock = false;
    const queued = s.queuedUserText.trim();
    s.queuedUserText = "";
    s.activeTurnInterrupted = false;
    if (queued && !s.closed) void handleUserTurn(s, queued);
  }
}

function cleanup(s: Session, reason: string) {
  if (s.closed) return;
  console.log("bridge cleanup", {
    callSid: s.callSid,
    streamSid: s.streamSid,
    reason,
    hasAgent: !!s.agent,
    hasDeepgram: !!s.dg,
    turns: s.history.length,
  });
  s.closed = true;
  s.speaking = false;
  s.cancelSpeech();
  s.dg?.close();
  for (const t of s.timers) clearTimeout(t);
  s.timers = [];
  if (s.callSid) {
    void reportCallEvent(s.callSid, classifyEndReason(reason), s.history);
  }
  try { s.twilio.close(1000, reason); } catch { /* ignore */ }
}

// ---------- HTTP entrypoint ----------

Deno.serve((req) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith("/healthz")) {
    return new Response(
      JSON.stringify({
        ok: true,
        has_deepgram: !!DEEPGRAM_KEY,
        has_app_url: !!APP_URL,
        has_secret: !!SHARED_SECRET,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("voice-bridge (upgrade required)", { status: 426 });
  }

  if (!DEEPGRAM_KEY || !APP_URL || !SHARED_SECRET) {
    return new Response("bridge misconfigured", { status: 500 });
  }

  const initialAgentId = url.searchParams.get("agent_id") ?? "";
  const pathMetadata = initialPathMetadata(url.pathname);

  console.log("bridge websocket upgrade", {
    callSid: url.searchParams.get("call_sid"),
    agentId: initialAgentId || pathMetadata.agentId || null,
    path: url.pathname,
  });

  const { socket, response } = Deno.upgradeWebSocket(req);

  const session: Session = {
    twilio: socket,
    streamSid: null,
    callSid: url.searchParams.get("call_sid") || pathMetadata.callSid,
    agentId: initialAgentId || pathMetadata.agentId,
    agent: bootstrapAgent(initialAgentId || pathMetadata.agentId, pathMetadata.bootstrap),
    agentReady: false,
    dg: null,
    dgReconnects: 0,
    history: [],
    speaking: false,
    greeted: false,
    turnLock: false,
    cancelSpeech: () => {},
    closed: false,
    lastUserAudioAt: Date.now(),
    timers: [],
    playbackMark: null,
    finishPlayback: () => {},
    greetingAudio: null,
    queuedUserText: "",
    activeTurnInterrupted: false,
    noiseGate: {
      noiseFloor: 180,
      speechFrames: 0,
      silenceFrames: 0,
      inSpeech: false,
      preRoll: [],
      voiceMsSinceCommit: 0,
      lastVoiceAt: 0,
    },
  };

  const loadAgent = (agentId: string) => fetchAgent(agentId)
    .then((a) => {
      session.agent = a;
      session.agentReady = true;
      console.log("bridge agent loaded", {
        callSid: session.callSid,
        agentId: a.id,
        ttsEngine: a.tts_engine,
        voiceId: a.voice_id,
      });
      // Prefetch the greeting audio in parallel with the Twilio start
      // handshake — by the time speak() runs, TTS is already done.
      primeGreeting(session, a);
      // Hard call-duration cap. Default 15min if agent doesn't specify.
      const maxSec = Math.max(30, Math.min(3600, a.max_call_seconds ?? 900));
      session.timers.push(
        setTimeout(() => cleanup(session, `max duration ${maxSec}s`), maxSec * 1000),
      );
      // Silence watchdog: if no user audio for N seconds and we aren't
      // mid-utterance, hang up. Default 30s.
      const silenceMs = Math.max(5000, (a.silence_timeout_seconds ?? 30) * 1000);
      const tick = () => {
        if (session.closed) return;
        const idle = Date.now() - session.lastUserAudioAt;
        if (idle > silenceMs && !session.speaking && !session.turnLock) {
          cleanup(session, `silence ${Math.round(idle / 1000)}s`);
          return;
        }
        session.timers.push(setTimeout(tick, 5000));
      };
      session.timers.push(setTimeout(tick, 5000));
      const queued = session.queuedUserText.trim();
      if (queued && !session.turnLock && !session.closed) {
        session.queuedUserText = "";
        void handleUserTurn(session, queued);
      }
    })
    .catch((e) => {
      console.error("agent fetch failed", e);
      cleanup(session, "agent config unavailable");
    });

  // Backward compatibility for manual tests / old URLs. Real Twilio calls use
  // <Parameter> values delivered in the start frame because <Stream url> does
  // not support query strings.
  if (session.agent) primeGreeting(session, session.agent);
  if (session.agentId) void loadAgent(session.agentId);

  socket.onmessage = async (ev) => {
    if (session.closed) return;
    let msg: {
      event: string;
      streamSid?: string;
      media?: { payload: string };
      start?: {
        streamSid: string;
        callSid: string;
        customParameters?: Record<string, string>;
      };
    };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
    } catch {
      return;
    }

    if (msg.event === "start") {
      session.streamSid = msg.start!.streamSid;
      // Prefer the authoritative call_sid from Twilio's start frame.
      if (msg.start?.callSid) session.callSid = msg.start.callSid;
      const params = msg.start?.customParameters ?? {};
      if (params.call_sid) session.callSid = params.call_sid;
      if (params.agent_id && !session.agentId) {
        session.agentId = params.agent_id;
        void loadAgent(params.agent_id);
      }
      console.log("bridge stream started", {
        callSid: session.callSid,
        streamSid: session.streamSid,
        agentId: session.agentId,
      });
      session.lastUserAudioAt = Date.now();
      const startListening = () => {
        if (session.dg || session.closed) return;
        // Aggregate final fragments across an utterance so we call the LLM
        // once per turn (Deepgram can emit several is_final chunks before
        // the caller actually stops). Commit on speech_final OR a
        // UtteranceEnd VAD event — whichever fires first.
        let pending = "";
        let latestInterim = "";
        let commitTimer: ReturnType<typeof setTimeout> | null = null;
        let lastCommitAt = 0;
        const clearCommitTimer = () => {
          if (commitTimer) clearTimeout(commitTimer);
          commitTimer = null;
        };
        const commit = (allowInterim = false) => {
          clearCommitTimer();
          const text = (pending.trim() || (allowInterim ? latestInterim.trim() : ""));
          const voiceMs = session.noiseGate.voiceMsSinceCommit;
          session.noiseGate.voiceMsSinceCommit = 0;
          pending = "";
          latestInterim = "";
          if (!text || Date.now() - lastCommitAt < 180) return;
          if (!looksLikeSpeech(text, voiceMs)) {
            console.log("bridge ignored non-speech transcript", { text, voiceMs });
            return;
          }
          lastCommitAt = Date.now();
          void handleUserTurn(session, text);
        };
        const scheduleCommit = (ms: number, allowInterim = false) => {
          clearCommitTimer();
          commitTimer = setTimeout(() => commit(allowInterim), ms);
        };
        session.dg = openDeepgram({
          onOpen: () => {
            session.dgReconnects = 0;
            console.log("deepgram open", { callSid: session.callSid });
          },
          onSpeechStart: () => {
            // Barge-in only when our local audio gate recently saw real
            // caller voice; this prevents room noise from cutting off TTS.
            if (session.speaking && Date.now() - session.noiseGate.lastVoiceAt < 350) session.cancelSpeech();
          },
          onInterim: (t) => {
            latestInterim = t.trim();
            const voiceMs = session.noiseGate.voiceMsSinceCommit;
            // Soft barge-in guard: only cancel once we've heard meaningful
            // words backed by gated caller audio, not stray background noise.
            if (session.speaking && looksLikeSpeech(latestInterim, voiceMs)) session.cancelSpeech();
            scheduleCommit(520, true);
          },
          onFinal: (t, speechFinal) => {
            pending = (pending ? pending + " " : "") + t.trim();
            latestInterim = "";
            if (speechFinal) commit();
            else scheduleCommit(260);
          },
          onUtteranceEnd: () => {
            // Deepgram's silence watchdog fired — flush anything buffered.
            if (pending) commit();
            else if (latestInterim) commit(true);
          },
          onClose: (ev) => {
            clearCommitTimer();
            if (session.closed) return;
            session.dg = null;
            const attempt = session.dgReconnects + 1;
            session.dgReconnects = attempt;
            console.warn("deepgram closed", { callSid: session.callSid, code: ev.code, reason: ev.reason, attempt });
            if (attempt > 3) {
              cleanup(session, "speech recognition unavailable");
              return;
            }
            session.timers.push(setTimeout(startListening, Math.min(1200, 150 * attempt)));
          },
          onError: (e) => console.error("deepgram", e),
        });
      };
      // Start recognition immediately. If the caller answers while the agent
      // config is still loading, their speech is queued instead of dropped.
      startListening();
      for (let i = 0; i < 50 && !session.agent; i++) {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (!session.agent) {
        cleanup(session, "agent not loaded");
        return;
      }
      if (session.agent.speak_first !== false) {
        const greeting = session.agent.greeting || "Hello, this is your AI assistant.";
        session.history.push({ role: "assistant", content: greeting });
        session.greeted = true;
        void speak(session, greeting);
      } else {
        // Listening already started above.
      }
    } else if (msg.event === "media" && session.dg && msg.media) {
      // base64 μ-law → bytes → forward to Deepgram
      const bin = atob(msg.media.payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const gatedFrames = gateInboundAudio(session, bytes);
      for (const frame of gatedFrames) session.dg.send(frame);
      if (Date.now() - session.noiseGate.lastVoiceAt < 80) {
        session.lastUserAudioAt = session.noiseGate.lastVoiceAt;
      }
    } else if (msg.event === "mark") {
      const name = (msg as { mark?: { name?: string } }).mark?.name;
      if (name && name === session.playbackMark) session.finishPlayback();
    } else if (msg.event === "stop") {
      console.log("bridge twilio stop", { callSid: session.callSid, streamSid: session.streamSid });
      cleanup(session, "twilio stop");
    }
  };

  socket.onclose = (ev) => {
    console.log("bridge socket closed", {
      callSid: session.callSid,
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
    });
    cleanup(session, "socket closed");
  };
  socket.onerror = (e) => {
    console.error("twilio ws error", e);
    cleanup(session, "socket error");
  };

  return response;
});
