import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { MobileTopBar, MobileBottomNav } from "@/components/app/mobile-shell";
import { useSupabaseSync } from "@/lib/sync";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppLayout,
});

function AppLayout() {
  useSupabaseSync();
  return (
    <div className="flex min-h-screen bg-surface-base text-neutral-900">
      {/* Desktop sidebar - hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <MobileTopBar />
        <div className="hidden md:block">
          <Topbar />
        </div>

        <div className="flex-1 px-4 py-5 pb-24 md:p-8 md:pb-8">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
