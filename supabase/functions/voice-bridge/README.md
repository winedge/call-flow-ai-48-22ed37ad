# voice-bridge (edge function)

Deno port of `services/voice-bridge/`. Runs full-duplex Twilio Media Streams
↔ Deepgram ↔ Lovable app on Supabase Edge Functions.

## Trade-off vs the Bun/VPS bridge

Edge Functions have a wall-clock cap per invocation (~150s free, ~400s
paid). Calls longer than that get cut off. This is fine for demos and
short qualification calls. For production / long calls, deploy
`services/voice-bridge/` to a VPS and repoint `BRIDGE_URL`.

## Required secrets (set in Lovable Cloud → Secrets)

- `DEEPGRAM_API_KEY` — Deepgram Nova-2 key
- `LOVABLE_APP_URL` — public URL of this app, e.g. `https://<slug>.lovable.app`
- `BRIDGE_SHARED_SECRET` — must match the app-side value

## Wire-up

In app secrets, set:

```
BRIDGE_URL=wss://<project-ref>.functions.supabase.co/voice-bridge
```

The TwiML endpoint (`/api/public/twilio/voice`) appends `?agent_id=...&call_sid=...`.

## Health

```
GET https://<project-ref>.functions.supabase.co/voice-bridge/healthz
```

Returns `{ok, has_deepgram, has_app_url, has_secret}`.
