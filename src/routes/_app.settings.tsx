import { useShallow } from "zustand/react/shallow";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Save, Plus, Trash2, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB, selectCurrentSettings, type PhoneNumber } from "@/lib/data-store";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — BulkCall AI" }] }),
  component: SettingsPage,
});

const TZS = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Tokyo"];

function SettingsPage() {
  const settings = useDB(selectCurrentSettings);
  const saveSettings = useDB((s) => s.saveSettings);
  const orgId = useDB((s) => s.currentOrgId);
  const phones = useDB(useShallow((s) => s.phones.filter((p) => p.org_id === orgId)));
  const addPhone = useDB((s) => s.addPhone);
  const delPhone = useDB((s) => s.deletePhone);
  const members = useDB(useShallow((s) => s.members.filter((m) => m.org_id === orgId)));
  const users = useDB((s) => s.users);

  return (
    <>
      <PageHeader title="Settings" description="API keys, telephony, billing, and team." />

      <Tabs defaultValue="integrations" className="max-w-4xl">
        <TabsList className="mb-6">
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="telephony">Telephony</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks & SMTP</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="space-y-6">
          <KeyCard
            title="Twilio"
            description="Used for outbound/inbound calling, AMD, recording, and ConversationRelay."
            connected={settings?.has_twilio ?? false}
            fields={[
              { label: "Account SID", placeholder: "ACxxxxxxxxxxxxxx" },
              { label: "Auth Token", placeholder: "••••••••••••", secret: true },
            ]}
            onSave={() => { saveSettings({ has_twilio: true }); toast.success("Twilio connected"); }}
          />
          <KeyCard
            title="ElevenLabs"
            description="Streaming TTS, voice cloning, and multilingual voices."
            connected={settings?.has_elevenlabs ?? false}
            fields={[{ label: "API Key", placeholder: "sk_••••", secret: true }]}
            onSave={() => { saveSettings({ has_elevenlabs: true }); toast.success("ElevenLabs connected"); }}
          />
          <KeyCard
            title="OpenAI"
            description="Real-time conversations, function calling, and structured outputs."
            connected={settings?.has_openai ?? false}
            fields={[{ label: "API Key", placeholder: "sk-••••", secret: true }]}
            onSave={() => { saveSettings({ has_openai: true }); toast.success("OpenAI connected"); }}
          />
        </TabsContent>

        <TabsContent value="telephony" className="space-y-6">
          <Card title="Phone numbers">
            <p className="text-xs text-zinc-500 mb-4">
              Numbers provisioned via Twilio for outbound caller ID and inbound webhooks.
            </p>
            <div className="space-y-2 mb-4">
              {phones.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-zinc-900/60 ring-1 ring-white/5 p-3 rounded-md">
                  <div>
                    <p className="font-mono text-zinc-200">{p.number}</p>
                    <p className="text-[11px] text-zinc-500">{p.type} · voice, sms</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => { delPhone(p.id); toast.success("Number released"); }}>
                    <Trash2 className="size-3.5 text-red-400" />
                  </Button>
                </div>
              ))}
              {phones.length === 0 && (
                <p className="text-xs text-zinc-500 italic">No numbers provisioned.</p>
              )}
            </div>
            <AddPhone onAdd={(n, t) => { addPhone(n, t); toast.success("Number added"); }} />
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-6">
          <Card title="Workspace defaults">
            <div className="space-y-4">
              <FieldRow label="Default time zone">
                <Select value={settings?.time_zone ?? "UTC"} onValueChange={(v) => saveSettings({ time_zone: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TZS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Webhook URL">
                <Input defaultValue={settings?.webhook_url ?? ""} placeholder="https://yourapp.com/webhooks/bulkcall" onBlur={(e) => saveSettings({ webhook_url: e.target.value })} />
              </FieldRow>
            </div>
          </Card>
          <Card title="SMTP">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Host"><Input defaultValue={settings?.smtp_host ?? ""} onBlur={(e) => saveSettings({ smtp_host: e.target.value })} /></FieldRow>
              <FieldRow label="Port"><Input type="number" defaultValue={settings?.smtp_port ?? 587} onBlur={(e) => saveSettings({ smtp_port: +e.target.value })} /></FieldRow>
              <FieldRow label="User"><Input defaultValue={settings?.smtp_user ?? ""} onBlur={(e) => saveSettings({ smtp_user: e.target.value })} /></FieldRow>
              <FieldRow label="Password"><Input type="password" placeholder="••••••" /></FieldRow>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-6">
          <Card title="Team members">
            <div className="space-y-2">
              {members.map((m) => {
                const u = users.find((x) => x.id === m.user_id);
                return (
                  <div key={m.user_id} className="flex items-center gap-3 bg-zinc-900/60 ring-1 ring-white/5 p-3 rounded-md">
                    <div className="size-8 rounded-full bg-zinc-800 ring-1 ring-white/10 grid place-items-center text-xs text-zinc-300">
                      {u?.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200">{u?.full_name}</p>
                      <p className="text-[11px] text-zinc-500">{u?.email}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                      {m.role}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => toast.info("Invites require Lovable Cloud")}>
              <Plus className="size-3.5 mr-1" /> Invite member
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <Card title="Plan">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">Growth · $299/mo</p>
                <p className="text-[11px] text-zinc-500">10,000 AI minutes included · $0.04/min overage</p>
              </div>
              <Button variant="outline">Manage plan</Button>
            </div>
          </Card>
          <Card title="Usage this month">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="AI minutes" value="3,287" />
              <MiniStat label="Twilio cost" value="$142.10" />
              <MiniStat label="ElevenLabs" value="$84.22" />
              <MiniStat label="OpenAI" value="$61.40" />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-6">
          <Card title="REST API">
            <p className="text-sm text-zinc-400 mb-4">
              Programmatic access to campaigns, contacts, calls, and webhooks.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-zinc-950/60 ring-1 ring-white/5 p-3 rounded font-mono text-xs text-zinc-300">
                <span className="text-emerald-400">GET</span> https://api.bulkcall.ai/v1/campaigns
                <button className="ml-auto text-zinc-500 hover:text-zinc-200" onClick={() => { navigator.clipboard.writeText("https://api.bulkcall.ai/v1/campaigns"); toast.success("Copied"); }}>
                  <Copy className="size-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 bg-zinc-950/60 ring-1 ring-white/5 p-3 rounded font-mono text-xs text-zinc-300">
                <span className="text-blue-400">POST</span> https://api.bulkcall.ai/v1/campaigns
              </div>
              <div className="flex items-center gap-2 bg-zinc-950/60 ring-1 ring-white/5 p-3 rounded font-mono text-xs text-zinc-300">
                <span className="text-emerald-400">GET</span> https://api.bulkcall.ai/v1/calls/&#123;id&#125;
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => toast.info("OpenAPI spec generated server-side")}>
              View OpenAPI docs
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
      <h2 className="text-sm font-medium text-zinc-200 mb-4 border-b border-surface-border/40 pb-3">{title}</h2>
      {children}
    </div>
  );
}

function KeyCard({ title, description, connected, fields, onSave }: {
  title: string; description: string; connected: boolean;
  fields: { label: string; placeholder: string; secret?: boolean }[];
  onSave: () => void;
}) {
  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-md">{description}</p>
        </div>
        {connected ? (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400 font-mono">
            <CheckCircle2 className="size-3" /> Connected
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400 font-mono">
            <AlertCircle className="size-3" /> Not connected
          </span>
        )}
      </div>
      <div className="space-y-3">
        {fields.map((f) => <SecretField key={f.label} {...f} />)}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={onSave} className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
          <Save className="size-3.5 mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}

function SecretField({ label, placeholder, secret }: { label: string; placeholder: string; secret?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono mb-2 block">{label}</Label>
      <div className="relative">
        <Input type={secret && !show ? "password" : "text"} placeholder={placeholder} />
        {secret && (
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200">
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">{label}</Label>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-950/40 ring-1 ring-white/5 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mb-1">{label}</p>
      <p className="font-mono text-zinc-100">{value}</p>
    </div>
  );
}

function AddPhone({ onAdd }: { onAdd: (n: string, t: PhoneNumber["type"]) => void }) {
  const [n, setN] = useState("");
  const [t, setT] = useState<PhoneNumber["type"]>("local");
  return (
    <div className="flex gap-2">
      <Input value={n} onChange={(e) => setN(e.target.value)} placeholder="+14155550100" className="flex-1" />
      <Select value={t} onValueChange={(v) => setT(v as PhoneNumber["type"])}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="local">Local</SelectItem>
          <SelectItem value="toll_free">Toll-free</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={() => { if (!/^\+\d{8,15}$/.test(n)) { toast.error("Invalid E.164"); return; } onAdd(n, t); setN(""); }} className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
        <Plus className="size-3.5 mr-1" /> Add
      </Button>
    </div>
  );
}
