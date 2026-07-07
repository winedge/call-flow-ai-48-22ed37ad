
# Path to lowest-viable cost/min with **Twilio Programmable Voice**

## Reality check on the target

With Twilio Programmable Voice (not SIP trunking) you cannot hit $0.008/min — Twilio's own carrier rate for US outbound is $0.014/min and that's a hard floor. The realistic band becomes **$0.020–0.023/min all-in**, which is still 4–5× cheaper than competitors (Bland $0.09, Vapi $0.05, Retell $0.07). Good enough to have healthy margins if you price at $0.05–0.08/min.

If cost/min ever becomes a blocker, the only lever left is swapping the telephony layer — everything else in this plan stays the same.

## Target unit economics (US outbound, Twilio Programmable Voice)

| Layer | Provider | $/min | Notes |
|---|---|---|---|
| Telephony | **Twilio Programmable Voice** | $0.014 | Twilio's standard per-minute rate |
| STT | Deepgram Nova-2 streaming | $0.0043 | ~250ms latency |
| LLM | Gemini 2.5 Flash via Lovable AI Gateway | $0.001 | ~500 tok/min |
| TTS | Self-hosted Kokoro (Apache-2.0) on GPU / Replicate | $0.001–0.002 | Commercially usable |
| Infra amortized @ 1M min/mo | Workers, DB, monitoring | $0.0005 | No FreeSWITCH → much lower ops |
| **Total** | | **~$0.021–0.023/min** | |

Fewer moving parts than the SIP-trunk plan: **no FreeSWITCH, no separate SIP servers, no carrier compliance work**. Twilio handles STIR/SHAKEN, DNC scrubbing UI, geo permissions, and DTMF/media natively.

Also fixes the current blocker: XTTS's non-commercial CPML license makes it unusable at production scale.

## What gets built (phased)

### Phase A — Engine abstraction + Kokoro swap *(this plan implements Phase A)*

Refactor so telephony, STT, and TTS are pluggable. Swap XTTS → Kokoro so the app becomes commercially usable now, without touching agent UX. Telephony stays stubbed but the interface is defined.

**Files created:**

- `src/lib/voice/types.ts` — shared engine interfaces:
  ```
  TtsEngine.synthesize({text, language, voice}) → {audioUrl}
  SttEngine.transcribeStream(audio) → text stream
  TelephonyProvider.placeCall({to, agentId}) → callId
  ```
- `src/lib/voice/tts/kokoro.functions.ts` — `createServerFn`, calls `hexgrad/kokoro-82m` on Replicate through the existing connector gateway. Apache-2.0.
- `src/lib/voice/tts/xtts.functions.ts` — moved from `src/lib/tts/xtts.functions.ts` (deprecated, kept dev-only; UI hides it).
- `src/lib/voice/tts/registry.ts` — resolves `tts_engine` → engine module. Exposes `KOKORO_VOICES` (`af_bella`, `af_sarah`, `am_michael`, `bf_emma`, `bm_lewis`, `hf_alpha`, `hm_omega`, …) and `KOKORO_LANGUAGES` (en, hi).
- `src/lib/voice/stt/types.ts` + `deepgram.stub.ts` — placeholder for Phase B.
- `src/lib/voice/telephony/types.ts` + `twilio.stub.ts` — placeholder for Phase C, wired for **Twilio Programmable Voice** only (no SIP trunking branch).

**Files edited:**

- `src/lib/data-store.ts` — extend agent shape: `tts_engine: "kokoro" | "xtts"` (default `"kokoro"`). Migrate seed agents from xtts → kokoro; remap voice IDs (Claribel→af_bella, Damien→am_michael, Kumar→hm_omega, etc.).
- `src/routes/_app.agents.$id.tsx`:
  - Voice dropdown reads `KOKORO_VOICES` via registry.
  - Language dropdown = en, hi (Tamil/Telugu marked "coming with next engine").
  - Preview button calls `synthesizeSpeechKokoro`.
  - Caption: "Powered by Kokoro (Apache-2.0) — commercially licensed".
  - Cache key becomes `${engine}|${voice}|${lang}|${text}`.
- `.lovable/plan.md` → replaced with `.lovable/COST-ARCHITECTURE.md` summarizing phased path, per-minute math, and the future-lever note that swapping Programmable Voice → SIP trunking is a ~$0.005/min saving if ever needed.

**Files deleted:** none.

### Phase B — Real STT + LLM turn loop *(future, not this plan)*

- Deepgram streaming STT reachable from Twilio Media Streams.
- Turn-taking state machine (`src/lib/voice/dialog.server.ts`) driving Gemini Flash via Lovable AI Gateway.
- Barge-in / interruption handling.

### Phase C — Twilio Programmable Voice *(future, not this plan)*

- Replace stubbed `src/routes/api/public/webhooks.twilio.ts` with real TwiML endpoints.
- Use `<Connect><Stream url="wss://…"/></Connect>` (Twilio Media Streams) to send call audio to our websocket → Deepgram → Gemini → Kokoro → TwiML `<Play>` back.
- Purchase numbers, configure webhooks, enable SMS Pumping Protection and Geo Permissions (per Twilio guidance).
- Uses existing Twilio connector; no separate SIP/FreeSWITCH infrastructure.

## Technical notes (Phase A specifics)

- Kokoro on Replicate returns a WAV URL; playback stays `new Audio(url)`.
- `KOKORO_VOICES` maps friendly labels → Kokoro's `af_*`/`am_*`/`bf_*`/`bm_*`/`hf_*`/`hm_*` speaker codes. Language auto-inferred from voice prefix.
- Registry pattern: `getTtsEngine(agent.tts_engine)` returns `{ synthesize, voices, languages }`. Adding ElevenLabs/Cartesia later = new file + registry entry; zero agent-UI changes.
- `telephony/twilio.stub.ts` uses a single Programmable Voice variant — simple and matches the existing Twilio connector.

## Out of scope for this plan

- Wiring real Deepgram / Gemini / Twilio (Phases B and C).
- Twilio SIP Trunking / FreeSWITCH.
- Billing/pricing UI showing $/min to customers.
- Kokoro voice cloning from uploaded samples.
- Tamil/Telugu support.

