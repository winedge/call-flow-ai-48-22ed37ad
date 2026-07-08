/**
 * Client-side data cache backed by Supabase.
 *
 * The store hydrates from Supabase on auth (see src/lib/sync.ts) and every
 * mutation below fires a write-through to the corresponding table. The
 * zustand persist middleware keeps a per-browser cache for instant paints.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase/client";

// Fire-and-forget DB write. Errors log to console — UI stays responsive.
function dbWrite(p: PromiseLike<unknown>) {
  Promise.resolve(p).then((r) => {
    const err = (r as { error?: { message?: string } })?.error;
    if (err) console.error("[data-store] write failed:", err);
  });
}



export type UUID = string;
export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)) as UUID;

export type AppRole = "owner" | "admin" | "member";

export type User = {
  id: UUID;
  email: string;
  full_name: string;
  avatar_url?: string;
  created_at: string;
};

export type Organization = {
  id: UUID;
  name: string;
  slug: string;
  created_by: UUID;
  created_at: string;
};

export type OrgMember = {
  org_id: UUID;
  user_id: UUID;
  role: AppRole;
  joined_at: string;
};

export type ContactList = {
  id: UUID;
  org_id: UUID;
  name: string;
  description: string;
  created_at: string;
};

export type Contact = {
  id: UUID;
  org_id: UUID;
  list_id: UUID | null;
  name: string;
  company: string;
  phone: string;
  email: string;
  custom_vars: Record<string, string>;
  tags: string[];
  notes: string;
  status: "new" | "called" | "completed" | "dnc";
  created_at: string;
};

export type AIAgent = {
  id: UUID;
  org_id: UUID;
  name: string;
  /** TTS engine key — resolved via src/lib/voice/tts/registry.ts. */
  tts_engine: "kokoro";
  voice_id: string;
  voice_name: string;
  language: string;
  greeting: string;
  system_prompt: string;
  prompt: string;
  business_knowledge: string;
  personality: string;
  temperature: number;
  objective: string;
  qualification_questions: string[];
  transfer_number: string;
  voicemail_handling: "leave_message" | "hangup" | "retry";
  voicemail_message: string;
  end_call_conditions: string[];
  max_retries: number;
  retry_delay_minutes: number;
  created_at: string;
};

export type PhoneNumber = {
  id: UUID;
  org_id: UUID;
  number: string;
  twilio_sid: string;
  type: "local" | "toll_free";
  capabilities: ("voice" | "sms")[];
  created_at: string;
};

export type CampaignStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "stopped";

export type Campaign = {
  id: UUID;
  org_id: UUID;
  name: string;
  agent_id: UUID | null;
  list_id: UUID | null;
  phone_number_id: UUID | null;
  timezone: string;
  calling_hours: { start: string; end: string; days: number[] };
  calls_per_minute: number;
  retry_rules: { max_attempts: number; gap_minutes: number };
  voicemail_rules: { action: "leave" | "skip" | "retry" };
  status: CampaignStatus;
  created_by: UUID;
  created_at: string;
};

export type CallStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "completed"
  | "no_answer"
  | "busy"
  | "failed"
  | "voicemail";

export type Call = {
  id: UUID;
  org_id: UUID;
  campaign_id: UUID | null;
  contact_id: UUID | null;
  agent_id: UUID | null;
  phone_to: string;
  phone_from: string;
  twilio_call_sid: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  status: CallStatus;
  outcome: string;
  recording_url: string | null;
  transcript: { speaker: "ai" | "human"; text: string; at: number }[];
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  cost_cents: number;
  ai_minutes: number;
  appointment_booked: boolean;
  end_reason: string | null;
};

export type Appointment = {
  id: UUID;
  org_id: UUID;
  call_id: UUID;
  contact_name: string;
  contact_phone: string;
  scheduled_at: string;
  status: "scheduled" | "confirmed" | "cancelled";
  notes: string;
};

export type Automation = {
  id: UUID;
  org_id: UUID;
  name: string;
  trigger: "call_completed" | "appointment_booked" | "call_failed";
  action: "send_sms" | "send_email" | "webhook" | "google_sheets";
  config: Record<string, string>;
  enabled: boolean;
};

export type OrgSettings = {
  org_id: UUID;
  time_zone: string;
  webhook_url: string;
  smtp_host: string;
  smtp_user: string;
  smtp_port: number;
  has_twilio: boolean;
  has_elevenlabs: boolean;
  has_openai: boolean;
};

// ============================================================
// Empty initial state — no demo data. Real data is loaded from
// Supabase after auth via the sync layer in src/lib/sync.ts.
// ============================================================

function buildSeed() {
  return {
    users: [] as User[],
    organizations: [] as Organization[],
    members: [] as OrgMember[],
    lists: [] as ContactList[],
    contacts: [] as Contact[],
    agents: [] as AIAgent[],
    phones: [] as PhoneNumber[],
    campaigns: [] as Campaign[],
    calls: [] as Call[],
    appointments: [] as Appointment[],
    automations: [] as Automation[],
    settings: [] as OrgSettings[],
    currentUserId: "" as UUID,
    currentOrgId: "" as UUID,
  };
}


type DBState = ReturnType<typeof buildSeed> & {
  reset: () => void;
  switchOrg: (orgId: UUID) => void;
  // mutations
  createOrg: (name: string) => Organization;
  addAgent: (agent: Omit<AIAgent, "id" | "org_id" | "created_at">) => AIAgent;
  updateAgent: (id: UUID, patch: Partial<AIAgent>) => void;
  deleteAgent: (id: UUID) => void;
  addList: (name: string, description: string) => ContactList;
  addContact: (c: Omit<Contact, "id" | "org_id" | "created_at">) => Contact;
  addContactsBulk: (cs: Omit<Contact, "id" | "org_id" | "created_at">[]) => number;
  deleteContacts: (ids: UUID[]) => void;
  addCampaign: (c: Omit<Campaign, "id" | "org_id" | "created_by" | "created_at" | "status">) => Campaign;
  setCampaignStatus: (id: UUID, status: CampaignStatus) => void;
  duplicateCampaign: (id: UUID) => void;
  addPhone: (number: string, type: PhoneNumber["type"]) => PhoneNumber;
  deletePhone: (id: UUID) => void;
  saveSettings: (patch: Partial<OrgSettings>) => void;
  addAutomation: (a: Omit<Automation, "id" | "org_id">) => Automation;
  toggleAutomation: (id: UUID) => void;
  deleteAutomation: (id: UUID) => void;
};

export const useDB = create<DBState>()(
  persist(
    (set, get) => ({
      ...buildSeed(),
      reset: () => set(buildSeed()),
      switchOrg: (orgId) => set({ currentOrgId: orgId }),

      createOrg: (name) => {
        const org: Organization = {
          id: uid(),
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          created_by: get().currentUserId,
          created_at: new Date().toISOString(),
        };
        set((s) => ({
          organizations: [...s.organizations, org],
          members: [
            ...s.members,
            { org_id: org.id, user_id: s.currentUserId, role: "owner", joined_at: org.created_at },
          ],
          settings: [
            ...s.settings,
            {
              org_id: org.id,
              time_zone: "America/Los_Angeles",
              webhook_url: "",
              smtp_host: "",
              smtp_user: "",
              smtp_port: 587,
              has_twilio: false,
              has_elevenlabs: false,
              has_openai: false,
            },
          ],
          currentOrgId: org.id,
        }));
        return org;
      },

      addAgent: (a) => {
        const agent: AIAgent = {
          ...a,
          id: uid(),
          org_id: get().currentOrgId,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ agents: [...s.agents, agent] }));
        dbWrite(
          supabase.from("agents").insert({
            id: agent.id,
            user_id: agent.org_id,
            name: agent.name,
            voice_id: agent.voice_id,
            voice_name: agent.voice_name,
            language: agent.language,
            greeting: agent.greeting,
            system_prompt: agent.system_prompt,
            prompt: agent.prompt,
            business_knowledge: agent.business_knowledge,
            personality: agent.personality,
            temperature: agent.temperature,
            objective: agent.objective,
            qualification_questions: agent.qualification_questions,
            transfer_number: agent.transfer_number,
            voicemail_handling: agent.voicemail_handling,
            voicemail_message: agent.voicemail_message,
            end_call_conditions: agent.end_call_conditions,
            max_retries: agent.max_retries,
            retry_delay_minutes: agent.retry_delay_minutes,
          }),
        );
        return agent;
      },
      updateAgent: (id, patch) => {
        set((s) => ({
          agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
        const dbPatch: Record<string, unknown> = { ...patch };
        delete dbPatch.id;
        delete dbPatch.org_id;
        delete dbPatch.created_at;
        delete dbPatch.tts_engine;
        dbWrite(supabase.from("agents").update(dbPatch as never).eq("id", id));
      },
      deleteAgent: (id) => {
        set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
        dbWrite(supabase.from("agents").delete().eq("id", id));
      },

      addList: (name, description) => {
        const list: ContactList = {
          id: uid(),
          org_id: get().currentOrgId,
          name,
          description,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ lists: [...s.lists, list] }));
        dbWrite(
          supabase.from("contact_lists").insert({
            id: list.id,
            user_id: list.org_id,
            name: list.name,
            description: list.description,
          }),
        );
        return list;
      },
      addContact: (c) => {
        const contact: Contact = {
          ...c,
          id: uid(),
          org_id: get().currentOrgId,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ contacts: [...s.contacts, contact] }));
        dbWrite(
          supabase.from("contacts").insert({
            id: contact.id,
            user_id: contact.org_id,
            list_id: contact.list_id,
            name: contact.name,
            company: contact.company,
            phone: contact.phone,
            email: contact.email,
            custom_vars: contact.custom_vars,
            tags: contact.tags,
            notes: contact.notes,
            status: contact.status,
          }),
        );
        return contact;
      },
      addContactsBulk: (cs) => {
        const orgId = get().currentOrgId;
        const existingPhones = new Set(
          get()
            .contacts.filter((c) => c.org_id === orgId)
            .map((c) => c.phone),
        );
        const fresh = cs.filter((c) => !existingPhones.has(c.phone));
        const now = new Date().toISOString();
        const made: Contact[] = fresh.map((c) => ({
          ...c,
          id: uid(),
          org_id: orgId,
          created_at: now,
        }));
        set((s) => ({ contacts: [...s.contacts, ...made] }));
        if (made.length > 0) {
          dbWrite(
            supabase.from("contacts").insert(
              made.map((m) => ({
                id: m.id,
                user_id: m.org_id,
                list_id: m.list_id,
                name: m.name,
                company: m.company,
                phone: m.phone,
                email: m.email,
                custom_vars: m.custom_vars,
                tags: m.tags,
                notes: m.notes,
                status: m.status,
              })),
            ),
          );
        }
        return made.length;
      },
      deleteContacts: (ids) => {
        const set2 = new Set(ids);
        set((s) => ({ contacts: s.contacts.filter((c) => !set2.has(c.id)) }));
        if (ids.length > 0) {
          dbWrite(supabase.from("contacts").delete().in("id", ids));
        }
      },

      addCampaign: (c) => {
        const campaign: Campaign = {
          ...c,
          id: uid(),
          org_id: get().currentOrgId,
          created_by: get().currentUserId,
          created_at: new Date().toISOString(),
          status: "draft",
        };
        set((s) => ({ campaigns: [...s.campaigns, campaign] }));
        dbWrite(
          supabase.from("campaigns").insert({
            id: campaign.id,
            user_id: campaign.org_id,
            name: campaign.name,
            agent_id: campaign.agent_id,
            list_id: campaign.list_id,
            phone_number_id: campaign.phone_number_id,
            timezone: campaign.timezone,
            calling_hours: campaign.calling_hours,
            calls_per_minute: campaign.calls_per_minute,
            retry_rules: campaign.retry_rules,
            voicemail_rules: campaign.voicemail_rules,
            status: campaign.status,
          }),
        );
        return campaign;
      },
      setCampaignStatus: (id, status) => {
        set((s) => ({
          campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, status } : c)),
        }));
        dbWrite(supabase.from("campaigns").update({ status }).eq("id", id));
      },
      duplicateCampaign: (id) => {
        const orig = get().campaigns.find((c) => c.id === id);
        if (!orig) return;
        const copy: Campaign = {
          ...orig,
          id: uid(),
          name: orig.name + " (Copy)",
          status: "draft",
          created_at: new Date().toISOString(),
        };
        set((s) => ({ campaigns: [...s.campaigns, copy] }));
        dbWrite(
          supabase.from("campaigns").insert({
            id: copy.id,
            user_id: copy.org_id,
            name: copy.name,
            agent_id: copy.agent_id,
            list_id: copy.list_id,
            phone_number_id: copy.phone_number_id,
            timezone: copy.timezone,
            calling_hours: copy.calling_hours,
            calls_per_minute: copy.calls_per_minute,
            retry_rules: copy.retry_rules,
            voicemail_rules: copy.voicemail_rules,
            status: copy.status,
          }),
        );
      },

      addPhone: (number, type) => {
        const phone: PhoneNumber = {
          id: uid(),
          org_id: get().currentOrgId,
          number,
          twilio_sid: "PN" + uid().replace(/-/g, "").slice(0, 30),
          type,
          capabilities: ["voice", "sms"],
          created_at: new Date().toISOString(),
        };
        set((s) => ({ phones: [...s.phones, phone] }));
        dbWrite(
          supabase.from("phone_numbers").insert({
            id: phone.id,
            user_id: phone.org_id,
            number: phone.number,
            twilio_sid: phone.twilio_sid,
            type: phone.type,
            capabilities: phone.capabilities,
          }),
        );
        return phone;
      },
      deletePhone: (id) => {
        set((s) => ({ phones: s.phones.filter((p) => p.id !== id) }));
        dbWrite(supabase.from("phone_numbers").delete().eq("id", id));
      },

      saveSettings: (patch) => {
        set((s) => ({
          settings: s.settings.map((x) =>
            x.org_id === s.currentOrgId ? { ...x, ...patch } : x,
          ),
        }));
        const uid_ = get().currentUserId;
        const dbPatch: Record<string, unknown> = { ...patch };
        delete dbPatch.org_id;
        delete dbPatch.has_twilio;
        delete dbPatch.has_elevenlabs;
        delete dbPatch.has_openai;
        if (uid_) {
          dbWrite(
            supabase.from("org_settings").upsert({ user_id: uid_, ...dbPatch } as never),
          );
        }
      },

      addAutomation: (a) => {
        const auto: Automation = { ...a, id: uid(), org_id: get().currentOrgId };
        set((s) => ({ automations: [...s.automations, auto] }));
        dbWrite(
          supabase.from("automations").insert({
            id: auto.id,
            user_id: auto.org_id,
            name: auto.name,
            trigger: auto.trigger,
            action: auto.action,
            config: auto.config,
            enabled: auto.enabled,
          }),
        );
        return auto;
      },
      toggleAutomation: (id) => {
        const cur = get().automations.find((a) => a.id === id);
        const next = !cur?.enabled;
        set((s) => ({
          automations: s.automations.map((a) =>
            a.id === id ? { ...a, enabled: next } : a,
          ),
        }));
        dbWrite(supabase.from("automations").update({ enabled: next }).eq("id", id));
      },
      deleteAutomation: (id) => {
        set((s) => ({ automations: s.automations.filter((a) => a.id !== id) }));
        dbWrite(supabase.from("automations").delete().eq("id", id));
      },

    }),
    { name: "bulkcall-db-v2" },
  ),
);

// ============================================================
// Selectors
// ============================================================

export function selectCurrentOrg(s: DBState) {
  return s.organizations.find((o) => o.id === s.currentOrgId) ?? null;
}
export function selectCurrentUser(s: DBState) {
  return s.users.find((u) => u.id === s.currentUserId) ?? null;
}
export function selectCurrentSettings(s: DBState) {
  return s.settings.find((x) => x.org_id === s.currentOrgId) ?? null;
}
export function scopeOrg<T extends { org_id: UUID }>(rows: T[], orgId: UUID) {
  return rows.filter((r) => r.org_id === orgId);
}
