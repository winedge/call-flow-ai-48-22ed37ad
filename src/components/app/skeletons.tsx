import { Skeleton } from "@/components/ui/skeleton";

export function PageHeaderSkeleton({ withActions = false }: { withActions?: boolean } = {}) {
  return (
    <div className="border-b border-surface-border/60 bg-surface-base/40 backdrop-blur-sm sticky top-14 md:top-16 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-4 md:py-6 mb-5 md:mb-8">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        {withActions && <Skeleton className="h-9 w-32 rounded-md" />}
      </div>
    </div>
  );
}

export function PageSkeleton({
  variant,
  withActions = false,
}: {
  variant: "table" | "cards" | "dashboard" | "form" | "detail" | "stats";
  withActions?: boolean;
}) {
  return (
    <>
      <PageHeaderSkeleton withActions={withActions} />
      {variant === "table" && <TableSkeleton />}
      {variant === "cards" && <CardsSkeleton />}
      {variant === "dashboard" && <DashboardSkeleton />}
      {variant === "form" && <FormSkeleton />}
      {variant === "detail" && <DetailSkeleton />}
      {variant === "stats" && <StatsSkeleton />}
    </>
  );
}


export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white ring-1 ring-black/5 rounded-xl overflow-hidden">
      <div className="border-b border-surface-border/60 px-6 py-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      <div className="divide-y divide-surface-border/30">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-6 py-4 grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="space-y-1.5">
                <Skeleton className="h-3.5 w-[70%]" />
                {c === 0 && <Skeleton className="h-2.5 w-[40%]" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white ring-1 ring-black/5 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3.5 w-[60%]" />
              <Skeleton className="h-2.5 w-[40%]" />
            </div>
          </div>
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-[80%]" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 bg-white ring-1 ring-black/5 rounded-lg space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-2 w-12" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-neutral-200/70">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-5 space-y-3">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          ))}
        </div>
        <div className="border-t border-neutral-200/70 p-5">
          <Skeleton className="h-2.5 w-40 mb-3" />
          <div className="flex items-end gap-[2px] h-14">
            {Array.from({ length: 60 }).map((_, i) => (
              <Skeleton key={i} className="flex-1" style={{ height: `${20 + ((i * 13) % 70)}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 rounded-xl border border-black/5 bg-white shadow-sm p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-[60%]" />
              <Skeleton className="h-2.5 w-[80%]" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-xl border border-black/5 bg-white shadow-sm p-5 space-y-4">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-[50%]" />
                <Skeleton className="h-2.5 w-[30%]" />
              </div>
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FormSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="max-w-3xl space-y-6">
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="bg-white ring-1 ring-black/5 rounded-xl p-6 space-y-4">
          <Skeleton className="h-4 w-32 pb-3" />
          <div className="grid sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <StatsSkeleton count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white ring-1 ring-black/5 rounded-xl p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={i % 2 === 0 ? "" : "flex justify-end"}>
              <Skeleton className={`h-14 rounded-lg ${i % 2 === 0 ? "w-[70%]" : "w-[60%]"}`} />
            </div>
          ))}
        </div>
        <div className="bg-white ring-1 ring-black/5 rounded-xl p-6 space-y-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
