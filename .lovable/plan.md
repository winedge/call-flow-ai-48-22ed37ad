
## Licensing note

Coqui XTTS v2 is under the **Coqui Public Model License (non-commercial)**. Fine for dev/eval; before you monetize BulkCall we'll need to swap engines (Sarvam / Google TTS / Lovable AI TTS). Proceeding on that basis.

## What gets built

### 1. Hosting: Replicate (`lucataco/xtts-v2`)

XTTS needs a GPU. We'll call it via Replicate through the Lovable connector gateway (no keys to manage — you just link the Replicate connector when prompted).

- Link the **Replicate** standard connector (one click, no manual key entry).
- All calls go server-side through `https://connector-gateway.lovable.dev/replicate/v1` with the auto-injected `LOVABLE_API_KEY` + `LOVABLE_CONNECTOR_REPLICATE_API_KEY`.

### 2. Server function: `synthesizeSpeech`

New file `src/lib/tts/xtts.functions.ts`:
- `createServerFn({ method: "POST" })` with Zod input `{ text, language: "en"|"hi"|"ta"|"te", speaker: string }`.
- Creates a prediction on `lucataco/xtts-v2` (community model — uses `/v1/predictions` with a pinned version hash), polls the gateway URL every ~1s up to ~30s, returns `{ audioUrl }`.
- Reads env inside the handler; surfaces 402/429 as clean toast-friendly errors.

### 3. Agent editor updates (`src/routes/_app.agents.$id.tsx`)

- Replace the ElevenLabs `VOICES` array with XTTS built-in **speaker presets** that handle Indic well: `Claribel Dervla`, `Daisy Studious`, `Gracie Wise`, `Damien Black`, `Viktor Eremita`, `Kumar Dahl`, `Aaron Draper`, `Sofia Hellen`.
- Trim `LANGS` dropdown to the 4 focus languages (English, हिन्दी, தமிழ், తెలుగు) — the rest live under an "Advanced" group.
- Add a **"Preview voice"** button beside the voice picker. Calls `synthesizeSpeech` with the greeting text (falls back to a per-language sample line if greeting is empty), plays via `new Audio(url)`. Loading state + toast on error.
- Small caption: "Powered by Coqui XTTS v2 (non-commercial)".

### 4. Data store tweak (`src/lib/data-store.ts`)

- Add `tts_engine: "xtts"` to the agent shape (default) so we can slot in another engine later without a migration.
- Reuse `voice_id` field for the XTTS speaker name.

### 5. Live-calls page

No change — telephony is still stubbed. Once Twilio's in, the call worker will call the same `synthesizeSpeech` per turn.

## Technical notes

- All Replicate calls stay server-side; no gateway URL touches the browser.
- XTTS output is a 24kHz wav — plays directly in `<audio>` / `new Audio()`.
- In-memory per-session cache keyed by `(speaker, language, text)` so repeated preview clicks don't re-bill.
- Cold-start on Replicate can be ~10s the first call; warm ~2–4s.
- No changes to the REST/OpenAPI layer — TTS is an internal server fn, not a public endpoint.

## What you'll be prompted for (during build)

- **Link Replicate connector** (once) — no key entry, OAuth-style link.

## Out of scope

- Voice cloning from an uploaded sample (XTTS supports it; punt to later).
- Streaming audio (Replicate returns a finished file; fine for previews and per-turn playback).
