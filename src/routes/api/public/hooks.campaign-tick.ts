/**
 * Campaign dialer tick - invoked once per minute by pg_cron.
 *
 * For every running campaign:
 *   - Compute available concurrency slots (MAX_CONCURRENT - active calls).
 *   - Cap by calls_per_minute for pacing.
 *   - Pick eligible contacts (never dialed, or dialed < max_attempts with
 *     the retry gap elapsed) from the campaign's list.
 *   - Fire Twilio outbound calls via supabaseAdmin.
 *   - When no eligible contacts remain and no active calls, mark the
 *     campaign 'completed'.
 *
 * Auth: relies on the /api/public/* prefix (bypasses auth on published
 * sites). No body params required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { dialOutbound } from "@/lib/voice/telephony/dial.server";

const MAX_CONCURRENT_PER_CAMPAIGN = 10;

interface CampaignRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  list_id: string | null;
  phone_number_id: string | null;
  calls_per_minute: number;
  retry_rules: { max_attempts?: number; gap_minutes?: number } | null;
}

interface ContactRow {
  id: string;
  phone: string;
}

interface CallCountRow {
  contact_id: string | null;
  ended_at: string | null;
  started_at: string;
}

async function runCampaign(
  campaign: CampaignRow,
  admin: Awaited<ReturnType<typeof getAdmin>>,
  fromNumber: string,
): Promise<{ dialed: number; skipped: number; completed: boolean }> {
  if (!campaign.agent_id || !campaign.list_id) {
    return { dialed: 0, skipped: 0, completed: false };
  }
  // Active calls for this campaign (ended_at IS NULL = still in progress).
  const { count: activeCount } = await admin
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .is("ended_at", null);
  const active = activeCount ?? 0;
  const slotsByConcurrency = Math.max(0, MAX_CONCURRENT_PER_CAMPAIGN - active);
  const slots = Math.max(0, Math.min(campaign.calls_per_minute, slotsByConcurrency));
  if (slots <= 0) return { dialed: 0, skipped: 0, completed: false };

  // Load all contacts in the list (paginated - PostgREST caps 1000/request).
  const contacts: ContactRow[] = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (let i = 0; i < 1000; i++) {
      const { data, error } = await admin
        .from("contacts")
        .select("id,phone")
        .eq("list_id", campaign.list_id)
        .eq("user_id", campaign.user_id)
        .range(from, from + pageSize - 1);
      if (error) break;
      const rows = (data ?? []) as ContactRow[];
      contacts.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  if (contacts.length === 0) {
    if (active === 0) {
      await admin
        .from("campaigns")
        .update({ status: "completed" } as never)
        .eq("id", campaign.id);
      return { dialed: 0, skipped: 0, completed: true };
    }
    return { dialed: 0, skipped: 0, completed: false };
  }

  // Prior calls for this campaign (paginated).
  const priorCalls: CallCountRow[] = [];
  {
    const pageSize = 1000;
    let from = 0;
    for (let i = 0; i < 1000; i++) {
      const { data, error } = await admin
        .from("calls")
        .select("contact_id,ended_at,started_at")
        .eq("campaign_id", campaign.id)
        .range(from, from + pageSize - 1);
      if (error) break;
      const rows = (data ?? []) as CallCountRow[];
      priorCalls.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  const byContact = new Map<
    string,
    { attempts: number; lastStartMs: number; anyActive: boolean }
  >();
  for (const c of priorCalls) {
    if (!c.contact_id) continue;
    const entry = byContact.get(c.contact_id) ?? {
      attempts: 0,
      lastStartMs: 0,
      anyActive: false,
    };
    entry.attempts += 1;
    const ts = new Date(c.started_at).getTime();
    if (ts > entry.lastStartMs) entry.lastStartMs = ts;
    if (!c.ended_at) entry.anyActive = true;
    byContact.set(c.contact_id, entry);
  }

  const maxAttempts = campaign.retry_rules?.max_attempts ?? 3;
  const gapMs = (campaign.retry_rules?.gap_minutes ?? 60) * 60_000;
  const now = Date.now();

  const eligible: ContactRow[] = [];
  let exhausted = 0;
  for (const c of contacts) {
    if (!c.phone) continue;
    const hist = byContact.get(c.id);
    if (!hist) {
      eligible.push(c);
    } else if (hist.anyActive) {
      // currently ringing/in-progress - skip
    } else if (hist.attempts >= maxAttempts) {
      exhausted += 1;
    } else if (now - hist.lastStartMs >= gapMs) {
      eligible.push(c);
    }
  }

  const toDial = eligible.slice(0, slots);
  let dialed = 0;
  let skipped = 0;
  for (const c of toDial) {
    try {
      await dialOutbound({
        userId: campaign.user_id,
        agentId: campaign.agent_id,
        campaignId: campaign.id,
        contactId: c.id,
        to: c.phone,
        from: fromNumber,
      });
      dialed += 1;
    } catch (err) {
      skipped += 1;
      console.error(
        `[campaign-tick] dial failed campaign=${campaign.id} contact=${c.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // If everyone is exhausted and nothing is active/eligible, complete.
  const noneRemaining =
    eligible.length === 0 && exhausted + byContact.size >= contacts.length;
  if (noneRemaining && active + dialed === 0) {
    await admin
      .from("campaigns")
      .update({ status: "completed" } as never)
      .eq("id", campaign.id);
    return { dialed, skipped, completed: true };
  }

  return { dialed, skipped, completed: false };
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const Route = createFileRoute("/api/public/hooks/campaign-tick")({
  server: {
    handlers: {
      POST: async () => {
        const admin = await getAdmin();
        const { data: campaignsRaw, error } = await admin
          .from("campaigns")
          .select(
            "id,user_id,agent_id,list_id,phone_number_id,calls_per_minute,retry_rules",
          )
          .eq("status", "running");
        if (error) {
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        const campaigns = (campaignsRaw ?? []) as CampaignRow[];

        const results: Record<string, unknown> = {};
        for (const c of campaigns) {
          // Resolve outbound number: campaign's assigned phone_number_id, else
          // the tenant default TWILIO_FROM_NUMBER.
          let fromNumber = process.env.TWILIO_FROM_NUMBER ?? "";
          if (c.phone_number_id) {
            const { data: pn } = await admin
              .from("phone_numbers")
              .select("number")
              .eq("id", c.phone_number_id)
              .maybeSingle<{ number: string | null }>();
            if (pn?.number) fromNumber = pn.number;
          }
          if (!fromNumber) {
            results[c.id] = { error: "no from number" };
            continue;
          }
          try {
            results[c.id] = await runCampaign(c, admin, fromNumber);
          } catch (err) {
            results[c.id] = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }

        return new Response(
          JSON.stringify({ ok: true, campaigns: results }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
