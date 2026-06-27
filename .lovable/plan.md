## Goal

Build "BulkCall AI" — a multi-tenant SaaS for AI-powered outbound calling campaigns (Twilio + ElevenLabs + OpenAI). The full spec is huge; this plan ships it in phases so each phase is genuinely production-ready, not placeholder pages.

The visual reference is the chosen **Technical dispatch terminal** prototype: dark slate background, emerald (`#10b981`) accent, JetBrains Mono for metrics/labels, Inter for body, sidebar + main canvas, KPI tiles, throughput chart, live dispatch panel, dense status tables.

---

## Phase 1 — Foundation + UI (this turn)

### 1. Design system (`src/styles.css`)
- Tailwind v4 tokens via `@theme inline`: `--surface-base #09090b`, `--surface-elevated #18181b`, `--surface-border #27272a`, `--brand-primary #10b981`, `--brand-muted #064e3b`, plus status colors (running/paused/completed/failed).
- Force dark theme app-wide (default `.dark`).
- Load Inter + JetBrains Mono via `<link>` in `__root.tsx` head (not `@import` in CSS).
- Add `font-mono` for numbers/timers, `font-sans` for body.

### 2. Enable Lovable Cloud
- Provisions Supabase (auth + Postgres + storage + edge functions).
- Required for orgs, RLS, server fns, secrets for Twilio/ElevenLabs/OpenAI keys later.

### 3. Database schema (single migration)
Multi-tenant model — every row scoped by `organization_id`.

- `profiles` (id ↔ auth.users, full_name, avatar_url)
- `organizations` (id, name, slug, created_by)
- `organization_members` (org_id, user_id, joined_at)
- `app_role` enum: `owner | admin | member`
- `user_roles` (user_id, organization_id, role) — separate table per security rules
- `has_role(user_id, org_id, role)` SECURITY DEFINER fn (avoids RLS recursion)
- `is_org_member(user_id, org_id)` SECURITY DEFINER fn
- `contact_lists` (id, org_id, name, description, contact_count)
- `contacts` (id, org_id, list_id, name, company, phone, email, custom_vars jsonb, tags text[], notes, status)
- `ai_agents` (id, org_id, name, voice_id, language, greeting, system_prompt, prompt, personality, temperature, objective, qualification_questions jsonb, transfer_rules jsonb, voicemail_handling, end_call_conditions jsonb, retry_logic jsonb)
- `phone_numbers` (id, org_id, number, twilio_sid, capabilities, type)
- `campaigns` (id, org_id, name, agent_id, list_id, phone_number_id, timezone, calling_hours jsonb, calls_per_minute, retry_rules jsonb, voicemail_rules jsonb, status: draft|running|paused|completed|stopped, created_by)
- `calls` (id, org_id, campaign_id, contact_id, agent_id, twilio_call_sid, started_at, ended_at, duration_sec, status, outcome, recording_url, transcript jsonb, summary, sentiment, cost_cents, ai_minutes)
- `appointments` (id, org_id, call_id, contact_id, scheduled_at, status, notes)
- `organization_settings` (org_id PK, time_zone, smtp jsonb, webhook_url) — secret API keys stored via `secrets--add_secret`, not in DB
- `automations` (id, org_id, trigger, action, config jsonb, enabled)

Each public table: `GRANT` to `authenticated` + `service_role`; RLS enabled; policies use `is_org_member(auth.uid(), org_id)` for read and role checks for write.

Triggers:
- `handle_new_user`: on `auth.users` insert → create `profiles` row + personal `organizations` row + `organization_members` row + `owner` role.
- `updated_at` triggers on mutable tables.

### 4. Auth
- `/auth` route: sign in + sign up tabs, email/password + Google OAuth (via `lovable.auth.signInWithOAuth`).
- `/auth/forgot-password` + `/auth/reset-password`.
- Email verification enabled (default Lovable Cloud config).
- Integration ships `_authenticated/route.tsx` gate (`ssr: false`, redirect to `/auth`) — do not author.
- `requireSupabaseAuth` middleware for all protected server fns; `attachSupabaseAuth` registered in `src/start.ts`.

### 5. App shell (`_authenticated/route.tsx` already managed)
New `_authenticated/_app.tsx` pathless layout providing the **dispatch terminal** chrome:
- `Sidebar` (collapsible): Dashboard, Campaigns, AI Agents, Contacts, Live Calls, Call History, Automations, Settings. Bottom: AI minutes usage tile.
- `Topbar`: workspace switcher (lists user's orgs), Node-04 Active status pill, "+ New Campaign" CTA, user menu (profile, sign out — with cancelQueries+clear+navigate hygiene).

### 6. Routes (real content, not stubs)
All under `_authenticated/_app/`:

- `dashboard.tsx` — 5 KPI tiles (Active Campaigns, Calls Today, Answered, Success Rate, AI Minutes — derived from real `calls`/`campaigns` aggregates via server fn), Recharts area chart for Call Throughput (last 24h, real data), Live Dispatch panel (filters `calls` where ended_at is null, polls every 3s), Recent Campaigns table.
- `campaigns/index.tsx` — list with status pills + progress bars + actions (Pause/Resume/Stop/Duplicate).
- `campaigns/new.tsx` — multi-step form (Agent → List → Number → Schedule → Retry/Voicemail → Launch). Zod-validated.
- `campaigns/$campaignId.tsx` — campaign analytics page (Total/Completed/Connected/NoAnswer/Busy/Failed/Voicemail, Avg Duration, Cost, AI Minutes, Success Rate).
- `agents/index.tsx` + `agents/new.tsx` + `agents/$agentId.tsx` — full AI agent CRUD with all fields from spec.
- `contacts/index.tsx` — list with bulk select, bulk delete, tags, search; "Upload CSV" + "Add contact" actions; client-side CSV parse (PapaParse) with duplicate detection by phone.
- `contacts/$listId.tsx` — list detail with contact table.
- `live-calls.tsx` — full-page live dispatch with active call cards, transcript stream area (placeholder until phase 2 wiring), End Call / Transfer buttons.
- `call-history.tsx` — table filterable by campaign/agent/outcome/date; row click → drawer with recording placeholder, transcript, AI summary, sentiment, download buttons.
- `automations.tsx` — list + create form (trigger: call_completed; action: SMS/email/webhook/sheet).
- `settings/index.tsx` — tabs: Organization (name, timezone), Team (members + invite + role change), API Keys (Twilio SID/Token, ElevenLabs key, OpenAI key — saved via `secrets--add_secret` flow), Phone Numbers, Webhooks, SMTP.

Every route defines `head()` (route-specific title + description), `errorComponent`, `notFoundComponent`. Router config sets `defaultErrorComponent`.

### 7. Server functions (TanStack `createServerFn`)
Co-located in `src/lib/*.functions.ts`:
- `organizations.functions.ts` — list mine, create, switch, list members, invite.
- `dashboard.functions.ts` — KPIs aggregate + throughput series.
- `agents.functions.ts` — CRUD.
- `contacts.functions.ts` — CRUD + bulk insert from parsed CSV (with phone normalization + dedupe).
- `campaigns.functions.ts` — CRUD + status transitions.
- `calls.functions.ts` — list + live + detail.
All use `requireSupabaseAuth`; enforce `is_org_member` on every read/write.

### 8. Validation, errors, UX
- Zod for every form + server fn input.
- shadcn `<Form>` + `<Toast>` (sonner) everywhere.
- React Query for all reads; `ensureQueryData` in loaders + `useSuspenseQuery` in components.
- Skeleton loaders for KPIs, tables, charts.
- Responsive: grid → flex breakpoint patterns per the responsive-layout rules.

### 9. Memory
Save core design rules (`mem://index.md`): dark theme, emerald primary `#10b981`, Inter + JetBrains Mono, dispatch-terminal aesthetic, multi-tenant with org_id scoping + has_role/is_org_member.

### 10. Out of scope this phase
- Real Twilio outbound calls / Media Streams / ConversationRelay
- Real ElevenLabs TTS streaming
- Real OpenAI conversation engine
- Voicemail/AMD wiring
- Stripe billing + plan enforcement
- Public REST API + OpenAPI spec
- Cross-org admin panel
- Voice cloning UI

These get their own phases — schema and UI in phase 1 are designed to plug them in without rework.

---

## Phases 2–5 (preview, for later turns)

- **Phase 2 — Telephony brain**: Twilio connector, edge function for outbound dial, Media Streams ↔ OpenAI Realtime ↔ ElevenLabs streaming TTS, live transcript via Supabase Realtime, recording + AMD + voicemail handling, campaign worker (rate-limited dialer respecting calling hours/timezone), retry logic.
- **Phase 3 — Appointments + automations**: booking engine, calendar UI, SMS/email confirmations (Twilio + SMTP), post-call automations runner (webhook/sheet/API trigger).
- **Phase 4 — Billing**: Stripe integration, plan tiers (minutes-based), real-time usage metering, invoice history.
- **Phase 5 — Public API + admin**: REST endpoints under `src/routes/api/public/*` with API-key auth, OpenAPI doc page, cross-org admin panel (super-admin role, user/org/subscription/system-log management).

---

## Technical notes

- Stack: TanStack Start, React 19, TS strict, Tailwind v4, shadcn, React Query, Supabase (Lovable Cloud), Recharts, PapaParse, sonner, zod, react-hook-form.
- Role storage: `user_roles` table (never on profile) + `has_role` SECURITY DEFINER fn — required to avoid RLS recursion and privilege escalation.
- All sensitive credentials (Twilio, ElevenLabs, OpenAI) live in Lovable Cloud secrets, never in DB or client. Settings page triggers `add_secret` flow per org.
- Live data: polling in phase 1; Supabase Realtime channels added in phase 2 once calls are real.
- No mock AI behavior — pages render real (initially empty) data; user adds agents/contacts/campaigns to populate.