import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Megaphone,
  Bot,
  Users,
  Radio,
  History,
  Workflow,
  Settings as SettingsIcon,
  Phone,
  Sparkles,
} from "lucide-react";


import { cn } from "@/lib/utils";
import { useDB, selectCurrentOrg } from "@/lib/data-store";
import logoAsset from "@/assets/logo.png.asset.json";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  live?: boolean;
};
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/agents", label: "AI Agents", icon: Bot },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/live-calls", label: "Live Calls", icon: Radio, live: true },
  { to: "/call-history", label: "Call History", icon: History },
  { to: "/automations", label: "Automations", icon: Workflow },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const calls = useDB((s) => s.calls);
  const orgId = useDB((s) => s.currentOrgId);
  const org = useDB(selectCurrentOrg);
  const liveCount = calls.filter(
    (c) => c.org_id === orgId && c.status === "in_progress",
  ).length;
  const aiMinutes = calls
    .filter((c) => c.org_id === orgId)
    .reduce((sum, c) => sum + c.ai_minutes, 0);
  const quota = 10000;

  return (
    <aside className="w-64 flex-shrink-0 border-r border-surface-border/60 bg-surface-base flex flex-col h-screen sticky top-0">
      <div className="p-6">
        <Link to="/dashboard" className="flex items-center gap-3">
          <img src={logoAsset.url} alt="BulkCall AI" className="h-6 w-auto object-contain" />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              {org?.name ?? "—"}
            </p>
          </div>
        </Link>
      </div>
      <div className="px-4 pb-3">
        <Link
          to={"/launch" as "/dashboard"}
          className="group flex items-center gap-2 px-3 py-2 rounded-md bg-brand-primary/15 hover:bg-brand-primary/25 ring-1 ring-brand-primary/40 text-brand-primary transition-colors"
        >
          <Sparkles className="size-4" strokeWidth={2} />
          <span className="text-sm font-medium">Launch a campaign</span>
        </Link>
      </div>

      <nav className="flex-1 px-4 space-y-0.5 overflow-y-auto">
        <p className="px-3 pb-2 pt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
          Operations
        </p>

        {NAV.map((item) => {
          const active =
            pathname === item.to ||
            (item.to !== "/dashboard" && pathname.startsWith(item.to));
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to as "/dashboard"}
              className={cn(
                "group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-800/60 text-brand-primary ring-1 ring-white/5"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/30",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  active ? "text-brand-primary" : "text-zinc-500 group-hover:text-zinc-300",
                )}
                strokeWidth={1.75}
              />
              <span className="truncate">{item.label}</span>
              {item.live && liveCount > 0 ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-brand-primary">
                  <span className="size-1.5 rounded-full bg-brand-primary animate-pulse" />
                  {liveCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-surface-border/60">
        <div className="p-3 bg-zinc-900/50 rounded-lg ring-1 ring-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
              AI Minutes
            </p>
            <p className="text-[10px] font-mono text-zinc-400">
              {Math.round((aiMinutes / quota) * 100)}%
            </p>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-brand-primary"
              style={{ width: `${Math.min(100, (aiMinutes / quota) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] font-mono text-zinc-400">
            {Math.round(aiMinutes).toLocaleString()} /{" "}
            {quota.toLocaleString()} min
          </p>
        </div>
      </div>
    </aside>
  );
}
