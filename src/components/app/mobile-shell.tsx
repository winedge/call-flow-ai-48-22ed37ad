/**
 * Mobile app shell — native-feeling top bar + bottom tab nav.
 *
 * Shown only under `md`. Above `md` the desktop Sidebar + Topbar take over.
 */
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Megaphone,
  Bot,
  Users,
  Phone,
  Menu,
  Plus,
  Radio,
  History,
  Workflow,
  Settings as SettingsIcon,
  LogOut,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useDB, selectCurrentOrg, selectCurrentUser } from "@/lib/data-store";
import logoAsset from "@/assets/logo.png.asset.json";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type Tab = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  match?: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/agents", label: "Agents", icon: Bot },
  {
    to: "/call-history",
    label: "Calls",
    icon: Phone,
    match: (p) => p.startsWith("/call-history") || p.startsWith("/live-calls") || p.startsWith("/calls"),
  },
];

const MORE_NAV: Tab[] = [
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/live-calls", label: "Live Calls", icon: Radio },
  { to: "/call-history", label: "Call History", icon: History },
  { to: "/automations", label: "Automations", icon: Workflow },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function MobileTopBar() {
  const org = useDB(selectCurrentOrg);
  const [open, setOpen] = useState(false);
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 bg-surface-base/85 backdrop-blur-xl border-b border-surface-border/60"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Open menu"
            className="size-9 grid place-items-center rounded-full text-zinc-300 hover:text-zinc-100 active:bg-zinc-800/60 transition"
          >
            <Menu className="size-5" strokeWidth={2} />
          </button>
        </SheetTrigger>
        <MobileDrawer onNavigate={() => setOpen(false)} />
      </Sheet>

      <Link to="/dashboard" className="flex items-center gap-2 min-w-0">
        <img src={logoAsset.url} alt="BulkCall AI" className="h-5 w-auto object-contain shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[9px] font-mono uppercase tracking-wider text-zinc-500">
            {org?.name ?? "—"}
          </p>
        </div>
      </Link>

      <Link
        to={"/campaigns/new" as "/dashboard"}
        aria-label="New campaign"
        className="size-9 grid place-items-center rounded-full bg-brand-primary text-primary-foreground shadow-sm active:brightness-90 transition"
      >
        <Plus className="size-5" strokeWidth={2.5} />
      </Link>
    </header>
  );
}

function MobileDrawer({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const org = useDB(selectCurrentOrg);
  const user = useDB(selectCurrentUser);
  const orgs = useDB((s) => s.organizations);
  const switchOrg = useDB((s) => s.switchOrg);
  const calls = useDB((s) => s.calls);
  const orgId = useDB((s) => s.currentOrgId);
  const aiMinutes = calls
    .filter((c) => c.org_id === orgId)
    .reduce((sum, c) => sum + c.ai_minutes, 0);
  const quota = 10000;
  const pct = Math.min(100, (aiMinutes / quota) * 100);

  return (
    <SheetContent
      side="left"
      className="w-[86vw] max-w-sm p-0 bg-surface-base border-surface-border/60 flex flex-col"
    >
      <SheetHeader className="p-5 pb-3 border-b border-surface-border/60">
        <SheetTitle asChild>
          <div className="flex items-center gap-3">
            <div className="size-9 bg-brand-primary rounded-lg grid place-items-center shrink-0">
              <Phone className="size-4 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-zinc-100">BulkCall AI</p>
              <p className="truncate text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                {org?.name ?? "—"}
              </p>
            </div>
          </div>
        </SheetTitle>
      </SheetHeader>

      <div className="p-4 border-b border-surface-border/60">
        <Link
          to={"/launch" as "/dashboard"}
          onClick={onNavigate}
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-brand-primary/15 ring-1 ring-brand-primary/40 text-brand-primary active:bg-brand-primary/25 transition"
        >
          <Sparkles className="size-4" strokeWidth={2} />
          <span className="text-sm font-medium">Launch a campaign</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        <p className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
          Navigation
        </p>
        {[...TABS, ...MORE_NAV].map((item) => (
          <Link
            key={item.to + item.label}
            to={item.to as "/dashboard"}
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-zinc-300 hover:text-zinc-100 active:bg-zinc-800/60 transition-colors"
          >
            <item.icon className="size-[18px] text-zinc-500 shrink-0" strokeWidth={1.75} />
            <span className="text-[15px]">{item.label}</span>
          </Link>
        ))}

        {orgs.length > 1 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
              Workspaces
            </p>
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  switchOrg(o.id);
                  onNavigate();
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-zinc-300 active:bg-zinc-800/60 transition-colors"
              >
                <span className="text-sm truncate">{o.name}</span>
                {o.id === org?.id && (
                  <span className="size-1.5 rounded-full bg-brand-primary shrink-0" />
                )}
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-surface-border/60 space-y-3">
        <div className="p-3 bg-zinc-900/50 rounded-lg ring-1 ring-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
              AI Minutes
            </p>
            <p className="text-[10px] font-mono text-zinc-400">{Math.round(pct)}%</p>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] font-mono text-zinc-400">
            {Math.round(aiMinutes).toLocaleString()} / {quota.toLocaleString()} min
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-zinc-800 ring-1 ring-white/10 grid place-items-center text-xs font-medium text-zinc-300 shrink-0">
            {user?.full_name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-200 truncate">{user?.full_name}</p>
            <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
          </div>
          <button
            aria-label="Sign out"
            onClick={() => {
              toast.info("Auth wiring pending Lovable Cloud enablement");
              onNavigate();
              router.navigate({ to: "/auth" });
            }}
            className="size-9 grid place-items-center rounded-full text-zinc-400 active:bg-zinc-800/60 transition"
          >
            <LogOut className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </SheetContent>
  );
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const calls = useDB((s) => s.calls);
  const orgId = useDB((s) => s.currentOrgId);
  const liveCount = calls.filter(
    (c) => c.org_id === orgId && c.status === "in_progress",
  ).length;

  return (
    <>
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-surface-border/60 bg-surface-base/90 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5 h-16">
          {TABS.map((tab) => {
            const active = tab.match
              ? tab.match(pathname)
              : pathname === tab.to || pathname.startsWith(tab.to + "/");
            const Icon = tab.icon;
            const showLive = tab.to === "/call-history" && liveCount > 0;
            return (
              <Link
                key={tab.to}
                to={tab.to as "/dashboard"}
                className="relative flex flex-col items-center justify-center gap-1 active:bg-zinc-800/40 transition-colors"
              >
                <div
                  className={cn(
                    "relative flex items-center justify-center size-8 rounded-full transition-all",
                    active && "bg-brand-primary/15",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[18px] transition-colors",
                      active ? "text-brand-primary" : "text-zinc-500",
                    )}
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {showLive ? (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand-primary ring-2 ring-surface-base animate-pulse" />
                  ) : null}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-tight transition-colors",
                    active ? "text-brand-primary" : "text-zinc-500",
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setMoreOpen(true)}
            className="relative flex flex-col items-center justify-center gap-1 active:bg-zinc-800/40 transition-colors"
          >
            <div className="flex items-center justify-center size-8 rounded-full">
              <Menu className="size-[18px] text-zinc-500" strokeWidth={1.75} />
            </div>
            <span className="text-[10px] font-medium tracking-tight text-zinc-500">
              More
            </span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="bg-surface-base border-surface-border/60 rounded-t-2xl p-0 max-h-[80vh]"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-zinc-700" />
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <h3 className="text-sm font-medium text-zinc-100">More</h3>
            <button
              aria-label="Close"
              onClick={() => setMoreOpen(false)}
              className="size-8 grid place-items-center rounded-full text-zinc-400 active:bg-zinc-800/60"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-3 pb-6 space-y-0.5">
            {MORE_NAV.map((item) => (
              <Link
                key={item.to + item.label}
                to={item.to as "/dashboard"}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 px-3 py-3.5 rounded-lg text-zinc-200 active:bg-zinc-800/60 transition-colors"
              >
                <div className="size-9 grid place-items-center rounded-lg bg-zinc-900/60 ring-1 ring-white/5 shrink-0">
                  <item.icon className="size-4 text-brand-primary" strokeWidth={1.75} />
                </div>
                <span className="text-[15px]">{item.label}</span>
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
