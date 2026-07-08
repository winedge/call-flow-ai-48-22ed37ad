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

const APP_URL = Deno.env.get("LOVABLE_APP_URL") ?? "";
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
async function reportCallEvent(callSid: string, endReason: string): Promise<void> {
  try {
    const body = JSON.stringify({
      call_sid: callSid,
      end_reason: endReason,
      ended_at: new Date().toISOString(),
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
): Promise<{ audio_url: string }> {
  const body = JSON.stringify({ text, voice, language });
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
  onFinal: (t: string) => void;
  onError: (e: unknown) => void;
}): DgHandle {
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("encoding", "mulaw");
  url.searchParams.set("sample_rate", "8000");
  url.searchParams.set("channels", "1");
  url.searchParams.set("model", "nova-2-phonecall");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("endpointing", "300");

  const ws = new WebSocket(url.toString(), ["token", DEEPGRAM_KEY]);
  let closed = false;

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "Results") {
        const t = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!t) return;
        if (msg.is_final || msg.speech_final) cb.onFinal(t);
        else cb.onInterim(t);
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
  agent: AgentConfig | null;
  dg: DgHandle | null;
  history: { role: "user" | "assistant"; content: string }[];
  speaking: boolean;
  turnLock: boolean;
  cancelSpeech: () => void;
  closed: boolean;
  lastUserAudioAt: number;
  timers: ReturnType<typeof setTimeout>[];
};

async function speak(s: Session, text: string) {
  if (!s.agent || !s.streamSid || s.closed) return;
  let cancelled = false;
  s.cancelSpeech = () => (cancelled = true);
  s.speaking = true;
  try {
    const { audio_url } = await synthTts(text, s.agent.voice_id, s.agent.language);
    if (cancelled || s.closed) return;
    const buf = await (await fetch(audio_url)).arrayBuffer();
    if (cancelled || s.closed) return;
    const { sampleRate, samples } = parseWav(buf);
    const pcm8k = downsampleTo8k(samples, sampleRate);
    const mu = pcm8kToMuLaw(pcm8k);
    const frames = chunk20ms(mu);
    for (const frame of frames) {
      if (cancelled || s.closed) break;
      // base64 encode without spreading huge arrays
      let bin = "";
      for (let i = 0; i < frame.length; i++) bin += String.fromCharCode(frame[i]);
      const payload = btoa(bin);
      s.twilio.send(JSON.stringify({
        event: "media",
        streamSid: s.streamSid,
        media: { payload },
      }));
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!cancelled && !s.closed) {
      s.twilio.send(JSON.stringify({
        event: "mark",
        streamSid: s.streamSid,
        mark: { name: "utterance-end" },
      }));
    }
  } catch (e) {
    console.error("tts failed", e);
  } finally {
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
          // Twilio will drop the <Stream> once it fetches new TwiML;
          // socket.onclose will run cleanup.
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
  s.closed = true;
  s.speaking = false;
  s.cancelSpeech();
  s.dg?.close();
  for (const t of s.timers) clearTimeout(t);
  s.timers = [];
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

  const agentId = url.searchParams.get("agent_id") ?? "";
  if (!agentId) return new Response("missing agent_id", { status: 400 });

  const { socket, response } = Deno.upgradeWebSocket(req);

  const session: Session = {
    twilio: socket,
    streamSid: null,
    callSid: url.searchParams.get("call_sid"),
    agent: null,
    dg: null,
    history: [],
    speaking: false,
    turnLock: false,
    cancelSpeech: () => {},
    closed: false,
    lastUserAudioAt: Date.now(),
    timers: [],
  };

  // Kick off agent fetch immediately.
  fetchAgent(agentId)
    .then((a) => {
      session.agent = a;
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

  socket.onmessage = async (ev) => {
    if (session.closed) return;
    let msg: {
      event: string;
      streamSid?: string;
      media?: { payload: string };
      start?: { streamSid: string; callSid: string };
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
      session.lastUserAudioAt = Date.now();
      for (let i = 0; i < 50 && !session.agent; i++) {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (!session.agent) {
        cleanup(session, "agent not loaded");
        return;
      }
      session.dg = openDeepgram({
        onInterim: (t) => {
          if (session.speaking && t.trim().length > 2) session.cancelSpeech();
        },
        onFinal: (t) => {
          const text = t.trim();
          if (text) void handleUserTurn(session, text);
        },
        onError: (e) => console.error("deepgram", e),
      });
      void speak(session, session.agent.greeting || "Hello, this is your AI assistant.");
    } else if (msg.event === "media" && session.dg && msg.media) {
      // base64 μ-law → bytes → forward to Deepgram
      const bin = atob(msg.media.payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      session.dg.send(bytes);
      session.lastUserAudioAt = Date.now();
    } else if (msg.event === "stop") {
      cleanup(session, "twilio stop");
    }
  };

  socket.onclose = () => cleanup(session, "socket closed");
  socket.onerror = (e) => {
    console.error("twilio ws error", e);
    cleanup(session, "socket error");
  };

  return response;
});
