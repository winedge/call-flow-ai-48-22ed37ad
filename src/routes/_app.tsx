import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
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
    <div className="flex min-h-screen bg-surface-base text-zinc-100">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <div className="flex-1 p-8"><Outlet /></div>
      </main>
    </div>
  );
}


