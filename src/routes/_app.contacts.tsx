import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Upload,
  Plus,
  Trash2,
  Search,
  Users,
  Tag,
  Download,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useDB, type Contact } from "@/lib/data-store";

export const Route = createFileRoute("/_app/contacts")({
  head: () => ({ meta: [{ title: "Contacts — BulkCall AI" }] }),
  component: ContactsPage,
});

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

function ContactsPage() {
  const orgId = useDB((s) => s.currentOrgId);
  const lists = useDB((s) => s.lists.filter((l) => l.org_id === orgId));
  const contacts = useDB((s) => s.contacts.filter((c) => c.org_id === orgId));
  const addList = useDB((s) => s.addList);
  const addContact = useDB((s) => s.addContact);
  const addBulk = useDB((s) => s.addContactsBulk);
  const deleteContacts = useDB((s) => s.deleteContacts);

  const [filterListId, setFilterListId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      if (filterListId !== "all" && c.list_id !== filterListId) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [contacts, filterListId, search]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  }

  function handleCSV(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data;
        let invalid = 0;
        const listId = filterListId !== "all" ? filterListId : (lists[0]?.id ?? null);
        const toInsert: Omit<Contact, "id" | "org_id" | "created_at">[] = [];
        for (const row of rows) {
          const phone = (row.phone ?? row.Phone ?? "").trim();
          if (!PHONE_RE.test(phone)) {
            invalid++;
            continue;
          }
          toInsert.push({
            list_id: listId,
            name: (row.name ?? row.Name ?? "").trim(),
            company: (row.company ?? row.Company ?? "").trim(),
            phone,
            email: (row.email ?? row.Email ?? "").trim(),
            custom_vars: {},
            tags: (row.tags ?? row.Tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
            notes: (row.notes ?? row.Notes ?? "").trim(),
            status: "new",
          });
        }
        const added = addBulk(toInsert);
        toast.success(
          `Imported ${added} contacts${invalid ? ` (${invalid} invalid skipped)` : ""}${added < toInsert.length ? `, ${toInsert.length - added} duplicates` : ""}`,
        );
      },
      error: () => toast.error("Failed to parse CSV"),
    });
  }

  function exportCSV() {
    const csv = Papa.unparse(
      filtered.map((c) => ({
        name: c.name,
        company: c.company,
        phone: c.phone,
        email: c.email,
        tags: c.tags.join(","),
        notes: c.notes,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${contacts.length.toLocaleString()} contacts across ${lists.length} lists.`}
        actions={
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCSV(f);
                e.currentTarget.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5 mr-1" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="size-3.5 mr-1" /> Export
            </Button>
            <NewListDialog onCreate={(n, d) => addList(n, d)} />
            <NewContactDialog
              lists={lists}
              onAdd={(c) => addContact(c)}
            />
          </div>
        }
      />

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Import a CSV or add contacts manually to get started."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <Select value={filterListId} onValueChange={setFilterListId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lists</SelectItem>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, email..."
                className="pl-9"
              />
            </div>
            {selected.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-400"
                onClick={() => {
                  deleteContacts([...selected]);
                  toast.success(`Deleted ${selected.size} contacts`);
                  setSelected(new Set());
                }}
              >
                <Trash2 className="size-3.5 mr-1" /> Delete {selected.size}
              </Button>
            )}
          </div>

          <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[760px]">
                <thead>
                  <tr className="text-[11px] text-zinc-500 uppercase tracking-wider border-b border-surface-border/60">
                    <th className="px-4 py-3 w-10">
                      <Checkbox
                        checked={selected.size > 0 && selected.size === filtered.length}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Company</th>
                    <th className="px-4 py-3 text-left font-medium">Phone</th>
                    <th className="px-4 py-3 text-left font-medium">Email</th>
                    <th className="px-4 py-3 text-left font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((c) => (
                    <tr key={c.id} className="border-b border-surface-border/30 hover:bg-zinc-800/20">
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggle(c.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-zinc-200">{c.name}</td>
                      <td className="px-4 py-3 text-zinc-400">{c.company}</td>
                      <td className="px-4 py-3 font-mono text-zinc-300">{c.phone}</td>
                      <td className="px-4 py-3 text-zinc-400">{c.email}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {c.tags.map((t) => (
                            <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              <Tag className="size-2.5 mr-1 inline" />
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 200 && (
              <div className="px-4 py-3 text-xs text-zinc-500 border-t border-surface-border/40">
                Showing first 200 of {filtered.length}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function NewListDialog({ onCreate }: { onCreate: (name: string, desc: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus className="size-3.5 mr-1" /> New list</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New contact list</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!name) return;
              onCreate(name, desc);
              toast.success("List created");
              setName(""); setDesc(""); setOpen(false);
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

function NewContactDialog({
  lists,
  onAdd,
}: {
  lists: { id: string; name: string }[];
  onAdd: (c: Omit<Contact, "id" | "org_id" | "created_at">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "", company: "", phone: "", email: "", tags: "", notes: "",
    list_id: lists[0]?.id ?? "",
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
          <Plus className="size-3.5 mr-1" /> Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-2"><Label>Company</Label><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
          <div className="space-y-2"><Label>Phone *</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+15551234567" /></div>
          <div className="space-y-2"><Label>Email</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="space-y-2 col-span-2"><Label>Tags (comma-separated)</Label><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div>
          <div className="space-y-2 col-span-2"><Label>Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!PHONE_RE.test(f.phone)) { toast.error("Invalid phone"); return; }
              onAdd({
                list_id: f.list_id || null,
                name: f.name, company: f.company, phone: f.phone, email: f.email,
                custom_vars: {},
                tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
                notes: f.notes, status: "new",
              });
              toast.success("Contact added");
              setF({ name: "", company: "", phone: "", email: "", tags: "", notes: "", list_id: lists[0]?.id ?? "" });
              setOpen(false);
            }}
            className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
          >Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
