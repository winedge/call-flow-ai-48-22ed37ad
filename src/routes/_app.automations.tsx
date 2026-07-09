import { useShallow } from "zustand/react/shallow";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, Workflow, Webhook, Mail, MessageSquare, Sheet as SheetIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDB, type Automation } from "@/lib/data-store";

export const Route = createFileRoute("/_app/automations")({
  head: () => ({ meta: [{ title: "Automations - BulkCall AI" }] }),
  component: Automations,
});

const ICONS: Record<Automation["action"], React.ComponentType<{ className?: string }>> = {
  send_sms: MessageSquare,
  send_email: Mail,
  webhook: Webhook,
  google_sheets: SheetIcon,
};

function Automations() {
  const orgId = useDB((s) => s.currentOrgId);
  const list = useDB(useShallow((s) => s.automations.filter((a) => a.org_id === orgId)));
  const add = useDB((s) => s.addAutomation);
  const toggle = useDB((s) => s.toggleAutomation);
  const del = useDB((s) => s.deleteAutomation);

  return (
    <>
      <PageHeader
        title="Automations"
        description="Trigger SMS, email, webhooks, or sheet updates after calls."
        actions={<NewAutomationDialog onAdd={(a) => { add(a); toast.success("Automation created"); }} />}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="Create rules to fire when a call completes, an appointment is booked, or a call fails."
        />
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const Icon = ICONS[a.action];
            return (
              <div key={a.id} className="bg-white ring-1 ring-black/5 rounded-xl p-4 flex items-center gap-4">
                <div className="size-10 rounded-md bg-brand-primary/10 ring-1 ring-brand-primary/30 grid place-items-center shrink-0">
                  <Icon className="size-4 text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{a.name}</p>
                  <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
                    When <span className="text-neutral-600">{a.trigger.replace(/_/g, " ")}</span> · do{" "}
                    <span className="text-neutral-600">{a.action.replace(/_/g, " ")}</span>
                  </p>
                </div>
                <Switch checked={a.enabled} onCheckedChange={() => toggle(a.id)} />
                <Button size="icon" variant="ghost" onClick={() => { del(a.id); toast.success("Deleted"); }}>
                  <Trash2 className="size-3.5 text-red-400" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function NewAutomationDialog({ onAdd }: { onAdd: (a: Omit<Automation, "id" | "org_id">) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Automation["trigger"]>("call_completed");
  const [action, setAction] = useState<Automation["action"]>("send_sms");
  const [target, setTarget] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
          <Plus className="size-4 mr-1" /> New automation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New automation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Post-call notify ops" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Trigger</Label>
              <Select value={trigger} onValueChange={(v) => setTrigger(v as Automation["trigger"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call_completed">Call completed</SelectItem>
                  <SelectItem value="appointment_booked">Appointment booked</SelectItem>
                  <SelectItem value="call_failed">Call failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Automation["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_sms">Send SMS</SelectItem>
                  <SelectItem value="send_email">Send Email</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="google_sheets">Google Sheets</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{action === "webhook" ? "URL" : action === "google_sheets" ? "Sheet ID" : "Template / recipient"}</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!name) return;
              onAdd({ name, trigger, action, config: { target }, enabled: true });
              setName(""); setTarget(""); setOpen(false);
            }}
            className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
