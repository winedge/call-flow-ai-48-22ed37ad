/**
 * Voice-bridge entry point.
 *
 * A single Bun server exposes:
 *   - GET /healthz             — liveness probe
 *   - WS  /twilio?agent_id&call_sid — Twilio Media Streams endpoint
 *
 * Per call we run a full-duplex loop:
 *   Twilio μ-law/8k → Deepgram STT → Gemini turn → Kokoro TTS →
 *   downsample+μ-law → Twilio.
 *
 * Env (all required):
 *   LOVABLE_APP_URL       https://<app>.lovable.app
 *   BRIDGE_SHARED_SECRET  matches Lovable
 *   DEEPGRAM_API_KEY      Deepgram Nova-2 key
 *   PORT                  defaults 8080
 */
import { WaveFile } from "wavefile";
import { openDeepgram } from "./deepgram";
import { chunk20ms, downsampleTo8k, pcm8kToMuLaw } from "./audio";
import { fetchAgent, runTurn, synthTts, type AgentConfig } from "./lovable";

const PORT = Number(process.env.PORT ?? 8080);
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY!;
if (!DEEPGRAM_KEY) throw new Error("DEEPGRAM_API_KEY is required");

type Twilio = {
  event: string;
  streamSid?: string;
  media?: { payload: string };
  start?: { streamSid: string; callSid: string };
};

type Session = {
  ws: import("bun").ServerWebSocket<Ctx>;
  streamSid: string | null;
  agent: AgentConfig | null;
  dg: ReturnType<typeof openDeepgram> | null;
  history: { role: "user" | "assistant"; content: string }[];
  speaking: boolean;      // TTS playback in progress
  pendingUser: string;    // latest interim; used only for barge-in
  turnLock: boolean;
  cancelSpeech: () => void;
  closed: boolean;
};

type Ctx = { agentId: string; callSid: string; session?: Session };

const server = Bun.serve<Ctx>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname === "/twilio") {
      const agentId = url.searchParams.get("agent_id") ?? "";
      const callSid = url.searchParams.get("call_sid") ?? "";
      const ok = srv.upgrade(req, { data: { agentId, callSid } });
      if (ok) return undefined as unknown as Response;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("voice-bridge", { status: 200 });
  },
  websocket: {
    open(ws) {
      const session: Session = {
        ws,
        streamSid: null,
        agent: null,
        dg: null,
        history: [],
        speaking: false,
        pendingUser: "",
        turnLock: false,
        cancelSpeech: () => {},
        closed: false,
      };
      ws.data.session = session;

      // Fetch agent config in the background — Twilio will send `start` shortly.
      if (ws.data.agentId) {
        fetchAgent(ws.data.agentId)
          .then((a) => {
            session.agent = a;
          })
          .catch((e) => {
            console.error("agent fetch failed", e);
            ws.close(1011, "agent config unavailable");
          });
      }
    },
    async message(ws, raw) {
      const session = ws.data.session!;
      if (session.closed) return;
      let msg: Twilio;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }

      if (msg.event === "start") {
        session.streamSid = msg.start!.streamSid;
        // Wait briefly for agent config if not yet loaded
        for (let i = 0; i < 50 && !session.agent; i++) {
          await new Promise((r) => setTimeout(r, 40));
        }
        if (!session.agent) {
          ws.close(1011, "agent not loaded");
          return;
        }
        // Open Deepgram
        session.dg = openDeepgram(DEEPGRAM_KEY, {
          onInterim: (t) => {
            session.pendingUser = t;
            // Barge-in: caller started talking while we speak → cut TTS.
            if (session.speaking && t.trim().length > 2) session.cancelSpeech();
          },
          onFinal: (t) => {
            const text = t.trim();
            if (!text) return;
            session.pendingUser = "";
            void handleUserTurn(session, text);
          },
          onClose: () => {},
          onError: (e) => console.error("deepgram error", e),
        });
        // Greet.
        void speak(session, session.agent.greeting || "Hello, this is your AI assistant.");
      } else if (msg.event === "media" && session.dg && msg.media) {
        // Twilio media payload is base64 μ-law bytes. Forward as-is.
        const bytes = Uint8Array.from(atob(msg.media.payload), (c) => c.charCodeAt(0));
        session.dg.send(bytes);
      } else if (msg.event === "stop") {
        cleanup(session);
      }
    },
    close(ws) {
      const s = ws.data.session;
      if (s) cleanup(s);
    },
  },
});

console.log(`voice-bridge listening on :${PORT}`);

// ---------- turn loop ----------

async function handleUserTurn(session: Session, userText: string) {
  if (!session.agent) return;
  if (session.turnLock) {
    // Queue by appending — the running turn will pick it up next round.
    session.history.push({ role: "user", content: userText });
    return;
  }
  session.turnLock = true;
  session.history.push({ role: "user", content: userText });
  try {
    const { reply, end_call } = await runTurn(session.agent, session.history);
    if (!reply) return;
    session.history.push({ role: "assistant", content: reply });
    await speak(session, reply);
    if (end_call) {
      await new Promise((r) => setTimeout(r, 400));
      hangup(session);
    }
  } catch (e) {
    console.error("turn failed", e);
    await speak(session, "Sorry, I had a technical issue. Could you say that again?");
  } finally {
    session.turnLock = false;
  }
}

async function speak(session: Session, text: string) {
  if (!session.agent || !session.streamSid || session.closed) return;
  let cancelled = false;
  session.cancelSpeech = () => {
    cancelled = true;
  };
  session.speaking = true;
  try {
    const { audio_url } = await synthTts(
      text,
      session.agent.voice_id,
      session.agent.language,
    );
    if (cancelled || session.closed) return;
    // Fetch WAV, decode with wavefile
    const buf = await fetch(audio_url).then((r) => r.arrayBuffer());
    if (cancelled || session.closed) return;
    const wav = new WaveFile(new Uint8Array(buf));
    wav.toBitDepth("16");
    const sampleRate = (wav.fmt as { sampleRate: number }).sampleRate;
    // getSamples with Float64 default; if stereo it returns [L, R]. Take L, coerce to Int16.
    const rawSamples = wav.getSamples(false) as Float64Array | Float64Array[];
    const mono = Array.isArray(rawSamples) ? rawSamples[0] : rawSamples;
    const pcm = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i];
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
    }
    const pcm8k = downsampleTo8k(pcm, sampleRate);
    const mu = pcm8kToMuLaw(pcm8k);
    const frames = chunk20ms(mu);

    // Send at ~20 ms cadence with a Twilio `mark` at the end so we can
    // reset barge-in state cleanly.
    for (const frame of frames) {
      if (cancelled || session.closed) break;
      const payload = btoa(String.fromCharCode(...frame));
      session.ws.send(
        JSON.stringify({
          event: "media",
          streamSid: session.streamSid,
          media: { payload },
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!cancelled && !session.closed) {
      session.ws.send(
        JSON.stringify({
          event: "mark",
          streamSid: session.streamSid,
          mark: { name: "utterance-end" },
        }),
      );
    }
  } catch (e) {
    console.error("tts failed", e);
  } finally {
    session.speaking = false;
    session.cancelSpeech = () => {};
  }
}

function hangup(session: Session) {
  try {
    session.ws.send(JSON.stringify({ event: "clear", streamSid: session.streamSid }));
  } catch {
    /* ignore */
  }
  session.ws.close(1000, "agent ended call");
  cleanup(session);
}

function cleanup(session: Session) {
  if (session.closed) return;
  session.closed = true;
  session.speaking = false;
  session.cancelSpeech();
  session.dg?.close();
}

// Suppress unused warning
void server;
