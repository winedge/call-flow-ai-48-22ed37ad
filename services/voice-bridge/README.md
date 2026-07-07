# voice-bridge

Standalone Bun WebSocket service that bridges Twilio Media Streams to
Deepgram STT, the Lovable app's LLM turn endpoint (Gemini via Lovable AI
Gateway), and the Lovable app's Kokoro TTS endpoint.

## Why it lives outside the Lovable app

Cloudflare Workers (the Lovable runtime) can't hold a persistent WebSocket
open for a multi-minute phone call. This service does — one long-lived
socket per active call — and stays otherwise stateless so you can scale it
horizontally.

## Architecture

```text
+------------+   PSTN   +--------+    wss://    +----------------+
| callee     | <------> | Twilio | <==========> | voice-bridge   |
+------------+          +--------+              |  (this app)    |
                            ^                   +----------------+
                            |                    |    |    |
              status/voice  |            μ-law   |    |    | HTTPS
              webhooks      |            8 kHz   |    |    | (HMAC-signed)
                            v                    v    v    v
                    +------------------+    +---------+  +------------------+
                    | Lovable TSS app  |    | Deepgram|  | Lovable /bridge/*|
                    |  /api/public/... |    |  Nova-2 |  |  turn + tts      |
                    +------------------+    +---------+  +------------------+
```

Turn loop, per call:
1. Twilio streams caller audio (μ-law 8 kHz, 20 ms frames).
2. Bridge forwards raw bytes to Deepgram; receives interim + final transcripts.
3. Interims → detect barge-in (cut ongoing TTS).
4. Finals → POST `/api/public/bridge/turn` with agent + history → Gemini reply.
5. Bridge POSTs reply to `/api/public/bridge/tts` → Kokoro WAV URL.
6. Bridge decodes WAV, downsamples 24k→8k, μ-law encodes, 20 ms chunks it
   back to Twilio at real-time cadence with a `mark` at end-of-utterance.

## Environment

Required:

| Var | Value |
|---|---|
| `LOVABLE_APP_URL` | `https://<your-app>.lovable.app` |
| `BRIDGE_SHARED_SECRET` | same value stored in Lovable admin secrets |
| `DEEPGRAM_API_KEY` | Deepgram API key with streaming access |
| `PORT` | defaults `8080` |

## Local dev

```bash
cd services/voice-bridge
bun install
LOVABLE_APP_URL=https://your-app.lovable.app \
BRIDGE_SHARED_SECRET=... \
DEEPGRAM_API_KEY=... \
bun run dev
```

Point Twilio (via `BRIDGE_URL` in the Lovable app) at a tunnel to this
process (`ngrok http 8080` → `wss://<tunnel>`).

## Deploy on Fly.io (recommended)

```bash
cd services/voice-bridge
fly launch --no-deploy         # accept the fly.toml, pick app name
fly secrets set \
  LOVABLE_APP_URL=https://<your-app>.lovable.app \
  BRIDGE_SHARED_SECRET=<same-as-Lovable> \
  DEEPGRAM_API_KEY=<dg-key>
fly deploy
```

Then in the Lovable app admin secrets, set:

```
BRIDGE_URL=wss://<your-voice-bridge>.fly.dev
```

## Deploy on Railway / Render / a VM

Any host that runs a Docker container and keeps the process alive works.
`auto_stop_machines = false` matters — you don't want the runtime shutting
down mid-call. Provision at least one always-on instance.

## Scaling & cost

- One machine handles ~50 concurrent calls at 512 MB. Scale horizontally
  behind Fly's built-in load balancing (each ws session is stateless
  outside the machine that owns it).
- Bridge itself is free of per-call cost. Per-minute cost sits with
  Twilio ($0.014), Deepgram ($0.0043), Lovable AI (~$0.001), Kokoro
  (~$0.001–0.002).

## Security

All HTTP callbacks to Lovable carry
`X-Bridge-Timestamp` + `X-Bridge-Signature = HEX(HMAC-SHA256(BRIDGE_SHARED_SECRET, ts.body))`.
Lovable rejects timestamps skewed more than 5 minutes.

The `/twilio` WebSocket itself isn't secret-authenticated (Twilio can't
sign frames); the URL is generated per-call by the Lovable app with a
short-lived query string, and only Twilio's outbound IP is expected to
hit it. If you need stronger guarantees, put Cloudflare / Fly's proxy in
front and IP-allowlist Twilio's Media Streams source ranges.
