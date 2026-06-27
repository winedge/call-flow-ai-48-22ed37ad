import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StatusPill({
  status,
  children,
}: {
  status: "running" | "paused" | "completed" | "stopped" | "draft" | "failed";
  children?: ReactNode;
}) {
  const map = {
    running:
      "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
    completed:
      "bg-zinc-800 text-zinc-400 ring-white/5",
    stopped: "bg-red-500/10 text-red-400 ring-red-500/20",
    draft: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
    failed: "bg-red-500/10 text-red-400 ring-red-500/20",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full ring-1",
        map[status],
      )}
    >
      {status === "running" ? (
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
      ) : null}
      {children ?? status}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  crumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  crumb?: { label: string; to: string }[];
}) {
  return (
    <div className="border-b border-surface-border/60 bg-surface-base/40 backdrop-blur-sm sticky top-16 z-10 -mx-8 px-8 py-6 mb-8">
      {crumb && crumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          {crumb.map((c, i) => (
            <span key={c.to} className="flex items-center gap-1">
              {i > 0 && <span className="opacity-40">/</span>}
              <Link to={c.to} className="hover:text-brand-primary">
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-zinc-100">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-surface-border rounded-xl p-12 text-center bg-surface-elevated/30">
      <div className="mx-auto size-12 rounded-lg bg-zinc-900/50 ring-1 ring-white/5 grid place-items-center">
        <Icon className="size-5 text-zinc-500" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-zinc-200">{title}</h3>
      <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">{description}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  accent = false,
}: {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "p-4 bg-zinc-900/40 ring-1 ring-white/5 rounded-lg",
        accent && "ring-brand-primary/30 bg-brand-primary/5",
      )}
    >
      <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-mono font-medium tracking-tight text-zinc-100">
        {value}
      </p>
      {(delta || hint) && (
        <p
          className={cn(
            "mt-2 text-[10px]",
            delta?.startsWith("+") ? "text-emerald-400" : delta?.startsWith("-") ? "text-red-400" : "text-zinc-500",
          )}
        >
          {delta ?? hint}
        </p>
      )}
    </div>
  );
}
