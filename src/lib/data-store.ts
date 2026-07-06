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
// Seed data
// ============================================================

const seedUserId = "u_demo_owner" as UUID;
const seedOrgId = "o_demo" as UUID;
const seedAgentId = "ag_sarah" as UUID;
const seedAgent2Id = "ag_nexus" as UUID;
const seedListId = "cl_demo" as UUID;
const seedPhoneId = "pn_demo" as UUID;

function seedTranscript(): Call["transcript"] {
  return [
    { speaker: "ai", text: "Hi, is this John? This is Sarah with BulkCall AI.", at: 0 },
    { speaker: "human", text: "Uh, yes — what's this about?", at: 4 },
    { speaker: "ai", text: "Just a quick call — would you have a moment to talk about your insurance coverage?", at: 7 },
    { speaker: "human", text: "Sure, I have a couple of minutes.", at: 13 },
    { speaker: "ai", text: "Great. Would you like to schedule a demo for Wednesday at 2pm?", at: 17 },
  ];
}

function buildSeed() {
  const now = Date.now();
  const user: User = {
    id: seedUserId,
    email: "operator@bulkcall.ai",
    full_name: "Demo Operator",
    created_at: new Date(now - 86400_000 * 30).toISOString(),
  };
  const org: Organization = {
    id: seedOrgId,
    name: "Global Operations",
    slug: "global-operations",
    created_by: seedUserId,
    created_at: new Date(now - 86400_000 * 30).toISOString(),
  };
  const members: OrgMember[] = [
    { org_id: seedOrgId, user_id: seedUserId, role: "owner", joined_at: org.created_at },
  ];
  const lists: ContactList[] = [
    {
      id: seedListId,
      org_id: seedOrgId,
      name: "Q4 Outreach Leads",
      description: "Inbound leads from website forms, Q4 2025",
      created_at: new Date(now - 86400_000 * 7).toISOString(),
    },
  ];
  const sampleContacts: Contact[] = Array.from({ length: 8 }).map((_, i) => ({
    id: uid(),
    org_id: seedOrgId,
    list_id: seedListId,
    name: ["John Doe", "Jane Smith", "Carlos Reyes", "Aisha Patel", "Liam Chen", "Maya Brooks", "Owen Park", "Sofia Russo"][i],
    company: ["Acme", "Globex", "Initech", "Soylent", "Hooli", "Pied Piper", "Stark", "Wayne"][i],
    phone: `+1555${String(1000000 + i * 12347).slice(0, 7)}`,
    email: `contact${i + 1}@example.com`,
    custom_vars: {},
    tags: i % 2 === 0 ? ["warm"] : ["cold"],
    notes: "",
    status: "new",
    created_at: new Date(now - 86400_000 * (7 - i)).toISOString(),
  }));
  const agents: AIAgent[] = [
    {
      id: seedAgentId,
      org_id: seedOrgId,
      name: "Sarah-AI",
      voice_id: "female_warm",
      voice_name: "Warm Female",
      language: "en",
      greeting: "Hi, this is Sarah with BulkCall AI. Do you have a quick moment?",
      system_prompt: "You are Sarah, a friendly outbound sales SDR. Keep replies under two sentences. Be warm and professional.",
      prompt: "Qualify the prospect's interest in scheduling a 15-minute product demo this week.",
      business_knowledge: "BulkCall AI helps teams run AI-powered outbound calling campaigns. Pricing starts at $99/mo.",
      personality: "Friendly, concise, slightly upbeat.",
      temperature: 0.6,
      objective: "Book a 15-minute demo for the calendar.",
      qualification_questions: [
        "Are you the decision-maker for outbound calling?",
        "How many calls per month does your team currently make?",
      ],
      transfer_number: "+15551234567",
      voicemail_handling: "leave_message",
      voicemail_message: "Hi, this is Sarah from BulkCall AI — sorry I missed you. I'll try again later.",
      end_call_conditions: ["Prospect says not interested", "Demo booked"],
      max_retries: 3,
      retry_delay_minutes: 60,
      created_at: new Date(now - 86400_000 * 10).toISOString(),
    },
    {
      id: seedAgent2Id,
      org_id: seedOrgId,
      name: "Nexus-V3",
      voice_id: "male_deep",
      voice_name: "Deep Male",
      language: "en",
      greeting: "Good day, this is Nexus calling on behalf of BulkCall AI.",
      system_prompt: "You are Nexus, a research agent collecting product feedback. Be polite and brief.",
      prompt: "Collect a customer satisfaction score 1-10 plus one improvement suggestion.",
      business_knowledge: "We're surveying existing customers about their experience.",
      personality: "Calm, formal, neutral.",
      temperature: 0.4,
      objective: "Collect a CSAT score.",
      qualification_questions: ["Are you a current BulkCall AI customer?"],
      transfer_number: "",
      voicemail_handling: "hangup",
      voicemail_message: "",
      end_call_conditions: ["Score collected"],
      max_retries: 2,
      retry_delay_minutes: 240,
      created_at: new Date(now - 86400_000 * 5).toISOString(),
    },
  ];
  const phones: PhoneNumber[] = [
    {
      id: seedPhoneId,
      org_id: seedOrgId,
      number: "+14155551200",
      twilio_sid: "PNxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      type: "local",
      capabilities: ["voice", "sms"],
      created_at: new Date(now - 86400_000 * 20).toISOString(),
    },
  ];
  const campaigns: Campaign[] = [
    {
      id: uid(),
      org_id: seedOrgId,
      name: "Q3 Outreach Alpha",
      agent_id: seedAgentId,
      list_id: seedListId,
      phone_number_id: seedPhoneId,
      timezone: "America/Los_Angeles",
      calling_hours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
      calls_per_minute: 12,
      retry_rules: { max_attempts: 3, gap_minutes: 60 },
      voicemail_rules: { action: "leave" },
      status: "running",
      created_by: seedUserId,
      created_at: new Date(now - 86400_000 * 2).toISOString(),
    },
    {
      id: uid(),
      org_id: seedOrgId,
      name: "Inbound Qualification",
      agent_id: seedAgentId,
      list_id: seedListId,
      phone_number_id: seedPhoneId,
      timezone: "America/New_York",
      calling_hours: { start: "10:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      calls_per_minute: 6,
      retry_rules: { max_attempts: 2, gap_minutes: 120 },
      voicemail_rules: { action: "skip" },
      status: "paused",
      created_by: seedUserId,
      created_at: new Date(now - 86400_000 * 5).toISOString(),
    },
    {
      id: uid(),
      org_id: seedOrgId,
      name: "Market Research V2",
      agent_id: seedAgent2Id,
      list_id: seedListId,
      phone_number_id: seedPhoneId,
      timezone: "Europe/London",
      calling_hours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      calls_per_minute: 4,
      retry_rules: { max_attempts: 2, gap_minutes: 240 },
      voicemail_rules: { action: "skip" },
      status: "completed",
      created_by: seedUserId,
      created_at: new Date(now - 86400_000 * 14).toISOString(),
    },
  ];

  // Synthesize a realistic 24h call history
  const calls: Call[] = [];
  for (let h = 23; h >= 0; h--) {
    const count = Math.floor(20 + Math.random() * 80);
    for (let i = 0; i < count; i++) {
      const startedAt = new Date(now - h * 3600_000 - Math.random() * 3600_000);
      const dur = Math.floor(20 + Math.random() * 260);
      const outcomes: { s: CallStatus; o: string }[] = [
        { s: "completed", o: "Demo booked" },
        { s: "completed", o: "Not interested" },
        { s: "completed", o: "Callback requested" },
        { s: "no_answer", o: "No answer" },
        { s: "busy", o: "Line busy" },
        { s: "voicemail", o: "Voicemail left" },
        { s: "failed", o: "Failed to connect" },
      ];
      const pick = outcomes[Math.floor(Math.random() * outcomes.length)];
      calls.push({
        id: uid(),
        org_id: seedOrgId,
        campaign_id: campaigns[i % campaigns.length].id,
        contact_id: sampleContacts[i % sampleContacts.length].id,
        agent_id: i % 3 === 0 ? seedAgent2Id : seedAgentId,
        phone_to: sampleContacts[i % sampleContacts.length].phone,
        phone_from: "+14155551200",
        twilio_call_sid: "CA" + uid().replace(/-/g, "").slice(0, 30),
        started_at: startedAt.toISOString(),
        ended_at: new Date(startedAt.getTime() + dur * 1000).toISOString(),
        duration_sec: pick.s === "completed" ? dur : Math.floor(dur / 4),
        status: pick.s,
        outcome: pick.o,
        recording_url: pick.s === "completed" ? "https://example.com/recording.mp3" : null,
        transcript: pick.s === "completed" ? seedTranscript() : [],
        summary: pick.s === "completed" ? "Prospect engaged. Demo scheduled for next Wed 2pm PT." : pick.o,
        sentiment: pick.s === "completed" ? "positive" : pick.s === "no_answer" ? null : "neutral",
        cost_cents: Math.floor(dur * 0.4),
        ai_minutes: +(dur / 60).toFixed(2),
        appointment_booked: pick.o === "Demo booked",
      });
    }
  }

  // Live calls (still ringing / in-progress)
  for (let i = 0; i < 4; i++) {
    calls.unshift({
      id: uid(),
      org_id: seedOrgId,
      campaign_id: campaigns[0].id,
      contact_id: sampleContacts[i].id,
      agent_id: i % 2 ? seedAgent2Id : seedAgentId,
      phone_to: sampleContacts[i].phone,
      phone_from: "+14155551200",
      twilio_call_sid: "CA" + uid().replace(/-/g, "").slice(0, 30),
      started_at: new Date(now - (60 + i * 30) * 1000).toISOString(),
      ended_at: null,
      duration_sec: 60 + i * 30,
      status: "in_progress",
      outcome: "",
      recording_url: null,
      transcript: seedTranscript().slice(0, 2 + i),
      summary: "",
      sentiment: null,
      cost_cents: 0,
      ai_minutes: 0,
      appointment_booked: false,
    });
  }

  const appointments: Appointment[] = calls
    .filter((c) => c.appointment_booked)
    .slice(0, 12)
    .map((c) => ({
      id: uid(),
      org_id: seedOrgId,
      call_id: c.id,
      contact_name: sampleContacts.find((x) => x.id === c.contact_id)?.name ?? "Contact",
      contact_phone: c.phone_to,
      scheduled_at: new Date(now + 86400_000 * (1 + Math.random() * 6)).toISOString(),
      status: "scheduled",
      notes: c.summary,
    }));

  const automations: Automation[] = [
    {
      id: uid(),
      org_id: seedOrgId,
      name: "Post-call SMS confirmation",
      trigger: "appointment_booked",
      action: "send_sms",
      config: { template: "Thanks {{name}} — your demo is confirmed for {{date}}." },
      enabled: true,
    },
  ];

  const settings: OrgSettings = {
    org_id: seedOrgId,
    time_zone: "America/Los_Angeles",
    webhook_url: "",
    smtp_host: "",
    smtp_user: "",
    smtp_port: 587,
    has_twilio: false,
    has_elevenlabs: false,
    has_openai: false,
  };

  return {
    users: [user] as User[],
    organizations: [org] as Organization[],
    members,
    lists,
    contacts: sampleContacts,
    agents,
    phones,
    campaigns,
    calls,
    appointments,
    automations,
    settings: [settings] as OrgSettings[],
    currentUserId: seedUserId as UUID,
    currentOrgId: seedOrgId as UUID,
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
    { name: "bulkcall-db-v1" },
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
