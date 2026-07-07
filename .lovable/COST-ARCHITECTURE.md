# Cost architecture

Target band: **$0.021–0.023/min all-in** (US outbound), using standard
Twilio Programmable Voice — no SIP trunking, no FreeSWITCH.

## Per-minute breakdown

| Layer | Provider | $/min |
|---|---|---|
| Telephony | Twilio Programmable Voice | 0.014 |
| STT | Deepgram Nova-2 streaming | 0.0043 |
| LLM | Gemini 2.5 Flash (Lovable AI Gateway) | 0.001 |
| TTS | Kokoro-82M on Replicate / self-hosted | 0.001–0.002 |
| Infra (amortized @ 1M min/mo) | Workers + DB | 0.0005 |
| **Total** | | **~0.021–0.023** |

Competitors (2026): Bland $0.09, Vapi $0.05, Retell $0.07, Synthflow $0.08.
Pricing at $0.05–0.08/min still leaves healthy margin.

## Phases

- **Phase A (shipped):** Swappable engine abstraction under `src/lib/voice/`.
  TTS = Kokoro (Apache-2.0). STT + telephony stubbed with typed interfaces.
- **Phase B:** Real Deepgram streaming STT + Gemini Flash turn loop over
  Twilio Media Streams (WebSocket).
- **Phase C:** Twilio Programmable Voice wiring — TwiML endpoints,
  `<Connect><Stream/>`, number provisioning, SMS Pumping Protection + Geo
  Permissions on.

## Future lever

If cost/min ever becomes the blocker, the only meaningful lever left is
swapping Twilio Programmable Voice → Elastic SIP Trunking + FreeSWITCH,
which drops telephony from $0.014 → ~$0.0085/min. Everything else in this
architecture stays the same.
