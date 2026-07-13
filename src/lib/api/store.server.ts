/**
 * In-memory server-side store for the REST API layer.
 *
 * Lives in the worker process - resets on redeploy. Mirrors the client
 * Zustand shapes so migrating to Supabase later is a drop-in.
 */

export type UUID = string;
const uid = (): UUID =>
  (globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36));

export type Agent = {
  id: UUID;
  name: string;
  voice_id: string;
  language: string;
  greeting: string;
  system_prompt: string;
  temperature: number;
  created_at: string;
};

export type Contact = {
  id: UUID;
  name: string;
  phone: string;
  email: string;
  company: string;
  tags: string[];
  status: "new" | "called" | "completed" | "dnc";
  created_at: string;
};

export type Campaign = {
  id: UUID;
  name: string;
  agent_id: UUID | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  concurrency: number;
  from_number: string;
  script: string;
  contact_ids: UUID[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type Call = {
  id: UUID;
  campaign_id: UUID | null;
  contact_id: UUID | null;
  agent_id: UUID | null;
  from_number: string;
  to_number: string;
  status:
    | "queued"
    | "ringing"
    | "in_progress"
    | "completed"
    | "failed"
    | "no_answer"
    | "busy";
  outcome: string | null;
  duration_seconds: number;
  recording_url: string | null;
  transcript: Array<{ role: "agent" | "user"; text: string; ts: number }>;
  provider_call_sid: string | null;
  started_at: string;
  ended_at: string | null;
};

export type Automation = {
  id: UUID;
  name: string;
  trigger: "call.completed" | "call.failed" | "call.no_answer" | "webhook";
  action: "webhook" | "email" | "sms" | "tag_contact";
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
};

type DB = {
  agents: Agent[];
  contacts: Contact[];
  campaigns: Campaign[];
  calls: Call[];
  automations: Automation[];
};

const g = globalThis as unknown as { __medical-calling-ai_db?: DB };

function seed(): DB {
  return {
    agents: [],
    contacts: [],
    campaigns: [],
    calls: [],
    automations: [],
  };
}


export function db(): DB {
  if (!g.__medical-calling-ai_db) g.__medical-calling-ai_db = seed();
  return g.__medical-calling-ai_db;
}

export function newId() {
  return uid();
}

export function nowIso() {
  return new Date().toISOString();
}
