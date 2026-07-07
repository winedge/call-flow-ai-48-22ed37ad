# Cost architecture

Target band: **$0.021–0.023/min all-in** (US outbound), using standard
Twilio Programmable Voice + Media Streams — no SIP trunking, no FreeSWITCH.

## Per-minute breakdown

| Layer | Provider | $/min |
|---|---|---|
| Telephony | Twilio Programmable Voice | 0.014 |
| STT | Deepgram Nova-2 (streaming, phonecall model) | 0.0043 |
| LLM | Gemini 3 Flash (Lovable AI Gateway) | 0.001 |
| TTS | Kokoro-82M on Replicate | 0.001–0.002 |
| Bridge infra (Fly.io shared-cpu-1x, amortized) | | 0.0005 |
| **Total** | | **~0.021–0.023** |

## Runtime split

Two services:

1. **Lovable app** (Cloudflare Workers) — REST API, TwiML endpoint,
   authenticated bridge callbacks (`/api/public/bridge/*`),
   agent/campaign/contact CRUD, dashboards.

2. **voice-bridge** (Bun on Fly.io, in `services/voice-bridge/`) — a
   persistent WebSocket server. One long-lived Twilio Media Streams
   socket per active call, plus a live Deepgram STT socket. Fully
   stateless outside the socket that owns the call, so it scales
   horizontally.

Workers can't hold multi-minute WebSockets, which is the only reason the
bridge exists as a second service.

## Live turn loop

```text
Twilio μ-law/8k ─► Deepgram STT ─► finals ─► /bridge/turn ─► Gemini
                                                                │
     ◄─── μ-law/8k 20ms frames ◄── downsample+resample ◄── /bridge/tts
                                                          Kokoro WAV
```

Barge-in: Deepgram interim results cancel the currently-playing TTS on
the caller's first ~50 ms of speech.

## Deploy

- **Lovable app** — publish from the Lovable UI. Set admin secrets:
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `PUBLIC_APP_URL`, `BRIDGE_URL`, `REPLICATE_API_KEY`.
  `BRIDGE_SHARED_SECRET` is auto-generated. `LOVABLE_API_KEY` is
  auto-provisioned.
- **Bridge** — see `services/voice-bridge/README.md`. Set its secrets
  (`LOVABLE_APP_URL`, `BRIDGE_SHARED_SECRET`, `DEEPGRAM_API_KEY`), then
  `fly deploy`. Feed the resulting `wss://…` URL back into the Lovable
  app as `BRIDGE_URL`.
