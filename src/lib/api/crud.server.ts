import { db, newId, nowIso, type Agent, type Contact, type Campaign, type Call, type Automation } from "./store.server";
import { errorJson, json } from "./cors";

type Collection = "agents" | "contacts" | "campaigns" | "automations";

const defaults: Record<Collection, (input: Record<string, unknown>) => object> = {
  agents: (i) => ({
    voice_id: "21m00Tcm4TlvDq8ikWAM",
    language: "en-US",
    greeting: "",
    system_prompt: "",
    temperature: 0.6,
    ...i,
  }),
  contacts: (i) => ({
    name: "",
    email: "",
    company: "",
    tags: [],
    status: "new",
    ...i,
  }),
  campaigns: (i) => ({
    agent_id: null,
    status: "draft",
    concurrency: 5,
    from_number: "",
    script: "",
    contact_ids: [],
    started_at: null,
    completed_at: null,
    ...i,
  }),
  automations: (i) => ({
    trigger: "call.completed",
    action: "webhook",
    config: {},
    enabled: true,
    ...i,
  }),
};

export async function list(name: Collection) {
  const rows = db()[name] as unknown as Array<{ id: string }>;
  return json({ data: rows, count: rows.length });
}

export async function create(name: Collection, request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson(400, "Invalid JSON body");
  }
  const row = {
    id: newId(),
    created_at: nowIso(),
    ...defaults[name](body),
  };
  (db()[name] as unknown as object[]).push(row);
  return json(row, { status: 201 });
}

export async function get(name: Collection, id: string) {
  const row = (db()[name] as unknown as Array<{ id: string }>).find(
    (r) => r.id === id,
  );
  if (!row) return errorJson(404, `${name} ${id} not found`);
  return json(row);
}

export async function patch(name: Collection, id: string, request: Request) {
  const arr = db()[name] as unknown as Array<Record<string, unknown> & { id: string }>;
  const idx = arr.findIndex((r) => r.id === id);
  if (idx < 0) return errorJson(404, `${name} ${id} not found`);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson(400, "Invalid JSON body");
  }
  arr[idx] = { ...arr[idx], ...body, id: arr[idx].id };
  return json(arr[idx]);
}

export async function remove(name: Collection, id: string) {
  const arr = db()[name] as unknown as Array<{ id: string }>;
  const idx = arr.findIndex((r) => r.id === id);
  if (idx < 0) return errorJson(404, `${name} ${id} not found`);
  arr.splice(idx, 1);
  return new Response(null, { status: 204 });
}

export type { Agent, Contact, Campaign, Call, Automation };
