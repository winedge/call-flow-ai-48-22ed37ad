import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, Plus, LogOut, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDB, selectCurrentOrg, selectCurrentUser } from "@/lib/data-store";

export function Topbar() {
  const router = useRouter();
  const org = useDB(selectCurrentOrg);
  const user = useDB(selectCurrentUser);
  const orgs = useDB((s) => s.organizations);
  const switchOrg = useDB((s) => s.switchOrg);
  const createOrg = useDB((s) => s.createOrg);

  return (
    <header className="h-16 border-b border-surface-border/60 flex items-center justify-between px-8 bg-surface-base/80 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-4 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors min-w-0">
              <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
                Workspace
              </span>
              <span className="size-1 bg-neutral-300 rounded-full shrink-0" />
              <span className="text-neutral-900 font-medium truncate">
                {org?.name ?? "-"}
              </span>
              <ChevronDown className="size-3.5 text-neutral-500 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
              Switch workspace
            </DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem
                key={o.id}
                onClick={() => switchOrg(o.id)}
                className="flex items-center justify-between"
              >
                <span>{o.name}</span>
                {o.id === org?.id && (
                  <span className="size-1.5 rounded-full bg-brand-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                const name = window.prompt("New workspace name");
                if (name) {
                  createOrg(name);
                  toast.success("Workspace created");
                }
              }}
            >
              <Plus className="size-3.5 mr-2" /> New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:block text-right">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">
            Status
          </p>
          <div className="flex items-center gap-1.5 justify-end">
            <span className="size-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-neutral-800">
              Node-04 Active
            </span>
          </div>
        </div>

        <Button asChild className="bg-brand-primary text-primary-foreground hover:brightness-110 hover:bg-brand-primary">
          <Link to="/campaigns/new">
            <Plus className="size-4 mr-1" /> New Campaign
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-8 rounded-full bg-neutral-200 ring-1 ring-black/10 grid place-items-center text-xs font-medium text-neutral-800 hover:ring-brand-primary/50 transition-all">
              {user?.full_name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm">{user?.full_name}</span>
                <span className="text-[11px] text-neutral-500 font-normal">
                  {user?.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.navigate({ to: "/settings" })}>
              <UserIcon className="size-3.5 mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                toast.info("Auth wiring pending Lovable Cloud enablement");
                router.navigate({ to: "/auth" });
              }}
            >
              <LogOut className="size-3.5 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
