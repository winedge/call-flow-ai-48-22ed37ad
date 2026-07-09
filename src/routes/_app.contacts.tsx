import { useShallow } from "zustand/react/shallow";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Upload,
  Plus,
  Trash2,
  Search,
  Users,
  Tag,
  Download,
  Loader2,
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
  head: () => ({ meta: [{ title: "Contacts - BulkCall AI" }] }),
  component: ContactsPage,
});

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;
type ContactDraft = Omit<Contact, "id" | "org_id" | "created_at">;

function listNameFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported contacts";
}

function csvRowsToContacts(rows: Record<string, string>[], listId: string | null) {
  let invalid = 0;
  const contacts: ContactDraft[] = [];
  for (const row of rows) {
    const phone = (row.phone ?? row.Phone ?? "").trim();
    if (!PHONE_RE.test(phone)) {
      invalid++;
      continue;
    }
    contacts.push({
      list_id: listId,
      name: (row.name ?? row.Name ?? "").trim(),
      company: (row.company ?? row.Company ?? "").trim(),
      phone,
      email: (row.email ?? row.Email ?? "").trim(),
      custom_vars: {},
      tags: (row.tags ?? row.Tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: (row.notes ?? row.Notes ?? "").trim(),
      status: "new",
    });
  }
  return { contacts, invalid };
}

function ContactsPage() {
  const orgId = useDB((s) => s.currentOrgId);
  const lists = useDB(useShallow((s) => s.lists.filter((l) => l.org_id === orgId)));
  const contacts = useDB(useShallow((s) => s.contacts.filter((c) => c.org_id === orgId)));
  const createList = useDB((s) => s.createList);
  const addContact = useDB((s) => s.addContact);
  const importContacts = useDB((s) => s.importContacts);
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
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  window.dispatchEvent(new CustomEvent("contacts:import-file", { detail: f }));
                }
                e.currentTarget.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5 mr-1" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="size-3.5 mr-1" /> Export
            </Button>
            <ImportCsvDialog
              lists={lists}
              currentFilterListId={filterListId}
              createList={createList}
              importContacts={importContacts}
              onImported={(listId) => setFilterListId(listId)}
            />
            <NewListDialog onCreate={createList} />
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
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
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

          <div className="bg-white ring-1 ring-black/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[760px]">
                <thead>
                  <tr className="text-[11px] text-neutral-500 uppercase tracking-wider border-b border-surface-border/60">
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
                    <tr key={c.id} className="border-b border-surface-border/30 hover:bg-neutral-100">
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggle(c.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-neutral-900">{c.name}</td>
                      <td className="px-4 py-3 text-neutral-600">{c.company}</td>
                      <td className="px-4 py-3 font-mono text-neutral-800">{c.phone}</td>
                      <td className="px-4 py-3 text-neutral-600">{c.email}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {c.tags.map((t) => (
                            <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-neutral-200 text-neutral-600">
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
              <div className="px-4 py-3 text-xs text-neutral-500 border-t border-surface-border/40">
                Showing first 200 of {filtered.length}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ImportCsvDialog({
  lists,
  currentFilterListId,
  createList,
  importContacts,
  onImported,
}: {
  lists: { id: string; name: string }[];
  currentFilterListId: string;
  createList: (name: string, desc: string) => Promise<{ id: string; name: string }>;
  importContacts: (contacts: ContactDraft[], listId: string) => Promise<{
    inserted: number;
    duplicates: number;
    failed: number;
    errors: string[];
  }>;
  onImported: (listId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ContactDraft[]>([]);
  const [invalid, setInvalid] = useState(0);
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [listId, setListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const listener = (event: Event) => {
      const file = (event as CustomEvent<File>).detail;
      if (!file) return;
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const preferredListId = currentFilterListId !== "all" ? currentFilterListId : (lists[0]?.id ?? "");
          const parsed = csvRowsToContacts(res.data, preferredListId || null);
          setFileName(file.name);
          setRows(parsed.contacts);
          setInvalid(parsed.invalid);
          setListId(preferredListId);
          setNewListName(listNameFromFile(file.name));
          setMode(preferredListId ? "existing" : "new");
          setOpen(true);
        },
        error: () => toast.error("Failed to parse CSV"),
      });
    };
    window.addEventListener("contacts:import-file", listener);
    return () => window.removeEventListener("contacts:import-file", listener);
  }, [currentFilterListId, lists]);

  async function runImport() {
    try {
      setImporting(true);
      let targetListId = listId;
      if (mode === "new") {
        const name = newListName.trim();
        if (!name) {
          toast.error("Name the contact list before importing");
          return;
        }
        const list = await createList(name, "Imported from CSV");
        targetListId = list.id;
      } else if (!targetListId) {
        toast.error("Choose a contact list before importing");
        return;
      }

      const result = await importContacts(rows, targetListId);
      onImported(targetListId);
      const pieces = [
        `Imported ${result.inserted}`,
        result.duplicates ? `${result.duplicates} duplicates` : "",
        invalid ? `${invalid} invalid` : "",
        result.failed ? `${result.failed} failed` : "",
      ].filter(Boolean);
      if (result.errors.length > 0) toast.error(result.errors[0]);
      toast.success(pieces.join(" · "));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Import contacts</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            {fileName ? `${fileName}: ${rows.length} valid rows${invalid ? `, ${invalid} invalid rows skipped` : ""}` : "Choose a CSV file."}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>New list</Button>
            <Button type="button" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")} disabled={lists.length === 0}>Existing list</Button>
          </div>
          {mode === "new" ? (
            <div className="space-y-2">
              <Label>List name</Label>
              <Input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Imported leads" />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Contact list</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger><SelectValue placeholder="Choose list" /></SelectTrigger>
                <SelectContent>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={runImport} disabled={importing || rows.length === 0} className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            {importing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Upload className="size-3.5 mr-1" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewListDialog({ onCreate }: { onCreate: (name: string, desc: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
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
            onClick={async () => {
              if (!name) return;
              try {
                setSaving(true);
                await onCreate(name, desc);
                toast.success("List created");
                setName(""); setDesc(""); setOpen(false);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create list");
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110"
          >
            {saving && <Loader2 className="size-3.5 mr-1 animate-spin" />}
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
