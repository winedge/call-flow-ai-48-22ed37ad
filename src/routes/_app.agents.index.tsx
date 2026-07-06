import { useShallow } from "zustand/react/shallow";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Bot, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, EmptyState } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { useDB } from "@/lib/data-store";

export const Route = createFileRoute("/_app/agents/")({
  head: () => ({ meta: [{ title: "AI Agents — BulkCall AI" }] }),
  component: AgentsList,
});

function AgentsList() {
  const orgId = useDB((s) => s.currentOrgId);
  const agents = useDB(useShallow((s) => s.agents.filter((a) => a.org_id === orgId)));
  const del = useDB((s) => s.deleteAgent);

  return (
    <>
      <PageHeader
        title="AI Agents"
        description="Voices, prompts, and behavior for every campaign."
        actions={
          <Button asChild className="bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
            <Link to="/agents/new">
              <Plus className="size-4 mr-1" /> New Agent
            </Link>
          </Button>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create an agent to define voice, language, and conversational behavior."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <div key={a.id} className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-4">
                <div className="size-10 rounded-md bg-brand-primary/10 ring-1 ring-brand-primary/30 grid place-items-center shrink-0">
                  <Bot className="size-4 text-brand-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to="/agents/$id" params={{ id: a.id }} className="font-medium text-zinc-100 hover:text-brand-primary truncate block">
                    {a.name}
                  </Link>
                  <p className="text-[11px] text-zinc-500 font-mono">{a.voice_name} · {a.language}</p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 line-clamp-3 mb-4">{a.objective}</p>
              <div className="flex gap-2 text-[10px] mt-auto">
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  temp {a.temperature}
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  retry {a.max_retries}
                </span>
              </div>
              <div className="mt-4 flex justify-between items-center border-t border-surface-border/40 pt-3">
                <Button asChild size="sm" variant="ghost">
                  <Link to="/agents/$id" params={{ id: a.id }}>Edit</Link>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete agent "${a.name}"?`)) {
                      del(a.id);
                      toast.success("Agent deleted");
                    }
                  }}
                >
                  <Trash2 className="size-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
