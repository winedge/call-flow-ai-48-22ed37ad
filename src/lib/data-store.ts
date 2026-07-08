/**
 * In-memory data layer for BulkCall AI.
 *
 * NOTE: Lovable Cloud (Supabase) couldn't be provisioned (workspace credits).
 * This module is intentionally shaped like a typed Supabase client so swapping
 * it for createServerFn + Supabase later is mechanical — same entity names,
 * same shapes, same "org_id" multi-tenancy.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
        return agent;
      },
      updateAgent: (id, patch) =>
        set((s) => ({
          agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),
      deleteAgent: (id) =>
        set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),

      addList: (name, description) => {
        const list: ContactList = {
          id: uid(),
          org_id: get().currentOrgId,
          name,
          description,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ lists: [...s.lists, list] }));
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
        return made.length;
      },
      deleteContacts: (ids) => {
        const set2 = new Set(ids);
        set((s) => ({ contacts: s.contacts.filter((c) => !set2.has(c.id)) }));
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
        return campaign;
      },
      setCampaignStatus: (id, status) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, status } : c)),
        })),
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
        return phone;
      },
      deletePhone: (id) =>
        set((s) => ({ phones: s.phones.filter((p) => p.id !== id) })),

      saveSettings: (patch) =>
        set((s) => ({
          settings: s.settings.map((x) =>
            x.org_id === s.currentOrgId ? { ...x, ...patch } : x,
          ),
        })),

      addAutomation: (a) => {
        const auto: Automation = { ...a, id: uid(), org_id: get().currentOrgId };
        set((s) => ({ automations: [...s.automations, auto] }));
        return auto;
      },
      toggleAutomation: (id) =>
        set((s) => ({
          automations: s.automations.map((a) =>
            a.id === id ? { ...a, enabled: !a.enabled } : a,
          ),
        })),
      deleteAutomation: (id) =>
        set((s) => ({ automations: s.automations.filter((a) => a.id !== id) })),
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
