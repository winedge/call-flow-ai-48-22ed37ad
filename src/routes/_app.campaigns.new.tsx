import { useShallow } from "zustand/react/shallow";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB } from "@/lib/data-store";

export const Route = createFileRoute("/_app/campaigns/new")({
  head: () => ({ meta: [{ title: "New campaign — BulkCall AI" }] }),
  component: NewCampaign,
});

const TZS = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function NewCampaign() {
  const router = useRouter();
  const orgId = useDB((s) => s.currentOrgId);
  const agents = useDB((s) => s.agents.filter((a) => a.org_id === orgId));
  const lists = useDB((s) => s.lists.filter((l) => l.org_id === orgId));
  const phones = useDB((s) => s.phones.filter((p) => p.org_id === orgId));
  const addCampaign = useDB((s) => s.addCampaign);

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [phoneId, setPhoneId] = useState(phones[0]?.id ?? "");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cpm, setCpm] = useState(10);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryGap, setRetryGap] = useState(60);
  const [vmAction, setVmAction] = useState<"leave" | "skip" | "retry">("leave");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !agentId || !listId || !phoneId) {
      toast.error("Fill all required fields");
      return;
    }
    const camp = addCampaign({
      name,
      agent_id: agentId,
      list_id: listId,
      phone_number_id: phoneId,
      timezone,
      calling_hours: { start: startTime, end: endTime, days },
      calls_per_minute: cpm,
      retry_rules: { max_attempts: maxRetries, gap_minutes: retryGap },
      voicemail_rules: { action: vmAction },
    });
    toast.success("Campaign created as draft");
    router.navigate({ to: "/campaigns/$id", params: { id: camp.id } });
  }

  return (
    <>
      <PageHeader
        title="New Campaign"
        description="Configure dispatch parameters before going live."
        crumb={[
          { label: "Campaigns", to: "/campaigns" },
          { label: "New", to: "/campaigns/new" },
        ]}
      />

      <form onSubmit={submit} className="max-w-3xl space-y-6">
        <Section title="Identity">
          <Field label="Campaign name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 Outbound Push" required />
          </Field>
        </Section>

        <Section title="Routing">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="AI agent *">
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Contact list *">
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="From number *">
              <Select value={phoneId} onValueChange={setPhoneId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {phones.map((p) => <SelectItem key={p.id} value={p.id}>{p.number}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Calling window">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Time zone">
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TZS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start">
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End">
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Days of week">
            <div className="flex gap-1.5 flex-wrap">
              {DAY_LABELS.map((d, i) => (
                <button
                  type="button"
                  key={d}
                  onClick={() =>
                    setDays((cur) => cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort())
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-mono ring-1 transition-colors ${
                    days.includes(i)
                      ? "bg-brand-primary/10 ring-brand-primary/40 text-brand-primary"
                      : "bg-zinc-900/60 ring-white/5 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Throughput & retries">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Calls per minute">
              <Input type="number" min={1} max={100} value={cpm} onChange={(e) => setCpm(+e.target.value)} />
            </Field>
            <Field label="Max retry attempts">
              <Input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(+e.target.value)} />
            </Field>
            <Field label="Gap (minutes)">
              <Input type="number" min={5} max={1440} value={retryGap} onChange={(e) => setRetryGap(+e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Voicemail">
          <Field label="When voicemail detected">
            <Select value={vmAction} onValueChange={(v) => setVmAction(v as "leave" | "skip" | "retry")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="leave">Leave message</SelectItem>
                <SelectItem value="skip">Skip & log</SelectItem>
                <SelectItem value="retry">Retry later</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.navigate({ to: "/campaigns" })}>
            Cancel
          </Button>
          <Button type="submit" className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            Create campaign
          </Button>
        </div>
      </form>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 space-y-4">
      <h2 className="text-sm font-medium text-zinc-200 border-b border-surface-border/40 pb-3">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">{label}</Label>
      {children}
    </div>
  );
}
