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
    running: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    paused: "bg-amber-50 text-amber-700 ring-amber-600/20",
    completed: "bg-neutral-100 text-neutral-600 ring-black/5",
    stopped: "bg-red-50 text-red-700 ring-red-600/20",
    draft: "bg-blue-50 text-blue-700 ring-blue-600/20",
    failed: "bg-red-50 text-red-700 ring-red-600/20",
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
    <div className="border-b border-surface-border/60 bg-surface-base/40 backdrop-blur-sm sticky top-14 md:top-16 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-4 md:py-6 mb-5 md:mb-8">
      {crumb && crumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-neutral-500">
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg md:text-xl font-semibold text-neutral-900">{title}</h1>
          {description && (
            <p className="mt-1 text-xs md:text-sm text-neutral-500 line-clamp-2 md:line-clamp-none">{description}</p>
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
    <div className="border border-dashed border-surface-border rounded-xl p-8 md:p-12 text-center bg-surface-elevated/30">
      <div className="mx-auto size-12 rounded-lg bg-neutral-50 ring-1 ring-black/5 grid place-items-center">
        <Icon className="size-5 text-neutral-500" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-neutral-900">{title}</h3>
      <p className="mt-1 text-xs text-neutral-500 max-w-sm mx-auto">{description}</p>
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
        "p-4 bg-white ring-1 ring-black/5 rounded-lg shadow-sm",
        accent && "ring-brand-primary/30 bg-brand-primary/5",
      )}
    >
      <p className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-mono font-medium tracking-tight text-neutral-900">
        {value}
      </p>
      {(delta || hint) && (
        <p
          className={cn(
            "mt-2 text-[10px]",
            delta?.startsWith("+") ? "text-emerald-600" : delta?.startsWith("-") ? "text-red-600" : "text-neutral-500",
          )}
        >
          {delta ?? hint}
        </p>
      )}
    </div>
  );
}
