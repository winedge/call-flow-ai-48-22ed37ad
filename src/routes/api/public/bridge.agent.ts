/**
 * Bridge → Lovable: fetch a redacted agent config by id.
 *
 * Reads from the real Supabase `agents` table (service role) so the bridge
 * gets the same config the UI edits — transfer_number, end_call_conditions,
 * voicemail_handling, voicemail_message, etc. Falls back to the in-memory
 * demo store when Supabase is unavailable or the id isn't there.
 *
 * Auth: HMAC via BRIDGE_SHARED_SECRET (empty body signed as path+query).
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyBridge } from "@/lib/voice/bridge-auth";
import { db } from "@/lib/api/store.server";
import { errorJson, json, preflight } from "@/lib/api/cors";

type BridgeAgent = {
  id: string;
  name: string;
  voice_id: string;
  language: string;
  greeting: string;
  system_prompt: string;
  temperature: number;
  personality?: string;
  objective?: string;
  business_knowledge?: string;
  qualification_questions?: string[];
  end_call_conditions?: string[];
  transfer_number?: string;
  voicemail_handling?: string;
  voicemail_message?: string;
  max_call_seconds?: number;
  silence_timeout_seconds?: number;
  tts_engine?: string;
};

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

async function fetchFromSupabase(id: string): Promise<BridgeAgent | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      name: data.name,
      voice_id: data.voice_id || "af_bella",
      language: data.language || "en",
      greeting: data.greeting || "",
      system_prompt: data.system_prompt || "",
      temperature: typeof data.temperature === "number" ? data.temperature : 0.6,
      personality: data.personality || undefined,
      objective: data.objective || undefined,
      business_knowledge: data.business_knowledge || undefined,
      qualification_questions: toStringArray(data.qualification_questions),
      end_call_conditions: toStringArray(data.end_call_conditions),
      transfer_number: data.transfer_number || undefined,
      voicemail_handling: data.voicemail_handling || "hangup",
      voicemail_message: data.voicemail_message || undefined,
      max_call_seconds: 900,
      silence_timeout_seconds: 30,
    };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/bridge/agent")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!(await verifyBridge(request, url.pathname + url.search))) {
          return errorJson(401, "Invalid bridge signature");
        }
        const id = url.searchParams.get("id");
        if (!id) return errorJson(400, "id required");

        const fromDb = await fetchFromSupabase(id);
        if (fromDb) return json(fromDb);

        // Fallback: legacy in-memory demo store
        const store = db();
        const a = store.agents.find((x) => x.id === id);
        if (!a) return errorJson(404, "agent not found");
        return json({
          id: a.id,
          name: a.name,
          voice_id: (a as unknown as { voice_id?: string }).voice_id ?? "af_bella",
          language: a.language,
          greeting: a.greeting,
          system_prompt: a.system_prompt,
          temperature: a.temperature,
          max_call_seconds: 900,
          silence_timeout_seconds: 30,
        } as BridgeAgent);
      },
    },
  },
});
