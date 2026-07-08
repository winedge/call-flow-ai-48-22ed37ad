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

// ---------- Deepgram streaming STT ----------

type DgHandle = { send: (mu: Uint8Array) => void; close: () => void };

function openDeepgram(cb: {
  onInterim: (t: string) => void;
  onFinal: (t: string, speechFinal: boolean) => void;
  onUtteranceEnd: () => void;
  onSpeechStart: () => void;
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
  // 300ms is tight but reliable on phone audio; the utterance_end_ms
  // watchdog below covers cases where the model never marks speech_final.
  url.searchParams.set("endpointing", "300");
  // VAD events give us a hard UtteranceEnd signal — used to flush any
  // buffered finals when Deepgram doesn't emit speech_final in time.
  url.searchParams.set("vad_events", "true");
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
  ws.addEventListener("close", () => (closed = true));
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
  dg: DgHandle | null;
  history: { role: "user" | "assistant"; content: string }[];
  speaking: boolean;
  turnLock: boolean;
  cancelSpeech: () => void;
  closed: boolean;
  lastUserAudioAt: number;
  timers: ReturnType<typeof setTimeout>[];
  playbackMark: string | null;
  finishPlayback: () => void;
  greetingAudio: Promise<{ audio_url: string }> | null;
};

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
  try {
    // Reuse a preloaded audio promise (used for the greeting) when it
    // matches the text we're about to speak — cuts first-speak latency.
    // If prefetch failed, fall back to a fresh synth so the call isn't silent.
    const preload = s.greetingAudio;
    s.greetingAudio = null;
    let audio_url: string;
    try {
      audio_url = (await (preload ?? synthTts(text, s.agent.voice_id, s.agent.language, s.agent.tts_engine, s.agent.voice_settings))).audio_url;
    } catch (e) {
      if (preload) {
        console.warn("greeting prefetch rejected, falling back to fresh synth");
        audio_url = (await synthTts(text, s.agent.voice_id, s.agent.language, s.agent.tts_engine, s.agent.voice_settings)).audio_url;
      } else {
        throw e;
      }
    }
    if (cancelled || s.closed) return;

    // Fast path: ElevenLabs returns raw μ-law 8kHz encoded as a data URI —
    // no fetch, no WAV parse, no downsample, no encode. Twilio's wire format.
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

    const frames = chunk20ms(mu);
    for (let i = 0; i < frames.length; i++) {
      if (cancelled || s.closed) break;
      const frame = frames[i];
      let bin = "";
      for (let j = 0; j < frame.length; j++) bin += String.fromCharCode(frame[j]);
      const payload = btoa(bin);
      s.twilio.send(JSON.stringify({
        event: "media",
        streamSid: s.streamSid,
        media: { payload },
      }));
      if (i % 50 === 49) await Promise.resolve();
    }
    if (!cancelled && !s.closed) {
      s.twilio.send(JSON.stringify({
        event: "mark",
        streamSid: s.streamSid,
        mark: { name: markName },
      }));
      const fallback = setTimeout(finishPlayback, Math.max(500, frames.length * 20 + 750));
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
  if (!s.agent || s.turnLock) {
    if (s.agent) s.history.push({ role: "user", content: text });
    return;
  }
  s.turnLock = true;
  s.history.push({ role: "user", content: text });
  try {
    const { reply, end_call, transfer } = await runTurn(s.agent, s.history);
    if (!reply && !end_call && !transfer) return;
    if (reply) {
      s.history.push({ role: "assistant", content: reply });
      await speak(s, reply);
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
    await speak(s, "Sorry, I had a technical issue. Could you say that again?");
  } finally {
    s.turnLock = false;
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

  console.log("bridge websocket upgrade", {
    callSid: url.searchParams.get("call_sid"),
    agentId: initialAgentId || null,
    path: url.pathname,
  });

  const { socket, response } = Deno.upgradeWebSocket(req);

  const session: Session = {
    twilio: socket,
    streamSid: null,
    callSid: url.searchParams.get("call_sid"),
    agentId: initialAgentId || null,
    agent: null,
    dg: null,
    history: [],
    speaking: false,
    turnLock: false,
    cancelSpeech: () => {},
    closed: false,
    lastUserAudioAt: Date.now(),
    timers: [],
    playbackMark: null,
    finishPlayback: () => {},
    greetingAudio: null,
  };

  const loadAgent = (agentId: string) => fetchAgent(agentId)
    .then((a) => {
      session.agent = a;
      console.log("bridge agent loaded", {
        callSid: session.callSid,
        agentId: a.id,
        ttsEngine: a.tts_engine,
        voiceId: a.voice_id,
      });
      // Prefetch the greeting audio in parallel with the Twilio start
      // handshake — by the time speak() runs, TTS is already done.
      if (a.speak_first !== false) {
        const greeting = a.greeting || "Hello, this is your AI assistant.";
        session.greetingAudio = synthTts(greeting, a.voice_id, a.language, a.tts_engine, a.voice_settings)
          .catch((e) => {
            console.error("greeting prefetch failed", e);
            session.greetingAudio = null;
            throw e;
          });
      }
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
    })
    .catch((e) => {
      console.error("agent fetch failed", e);
      cleanup(session, "agent config unavailable");
    });

  // Backward compatibility for manual tests / old URLs. Real Twilio calls use
  // <Parameter> values delivered in the start frame because <Stream url> does
  // not support query strings.
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
      for (let i = 0; i < 50 && !session.agent; i++) {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (!session.agent) {
        cleanup(session, "agent not loaded");
        return;
      }
      const startListening = () => {
        if (session.dg || session.closed) return;
        // Aggregate final fragments across an utterance so we call the LLM
        // once per turn (Deepgram can emit several is_final chunks before
        // the caller actually stops). Commit on speech_final OR a
        // UtteranceEnd VAD event — whichever fires first.
        let pending = "";
        const commit = () => {
          const text = pending.trim();
          pending = "";
          if (text) void handleUserTurn(session, text);
        };
        session.dg = openDeepgram({
          onSpeechStart: () => {
            // Hard barge-in: caller began speaking. Kill any in-flight
            // playback immediately so the agent yields the floor.
            if (session.speaking) session.cancelSpeech();
          },
          onInterim: (t) => {
            // Soft barge-in guard: only cancel once we've heard real words,
            // not a stray cough / crosstalk detected by the VAD.
            if (session.speaking && t.trim().length > 2) session.cancelSpeech();
          },
          onFinal: (t, speechFinal) => {
            pending = (pending ? pending + " " : "") + t.trim();
            if (speechFinal) commit();
          },
          onUtteranceEnd: () => {
            // Deepgram's silence watchdog fired — flush anything buffered.
            if (pending) commit();
          },
          onError: (e) => console.error("deepgram", e),
        });
      };
      if (session.agent.speak_first !== false) {
        const greeting = session.agent.greeting || "Hello, this is your AI assistant.";
        session.history.push({ role: "assistant", content: greeting });
        void speak(session, greeting).finally(startListening);
      } else {
        startListening();
      }
    } else if (msg.event === "media" && session.dg && msg.media) {
      // base64 μ-law → bytes → forward to Deepgram
      const bin = atob(msg.media.payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      session.dg.send(bytes);
      session.lastUserAudioAt = Date.now();
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
