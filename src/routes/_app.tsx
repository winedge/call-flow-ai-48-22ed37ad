import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="flex min-h-screen bg-surface-base text-zinc-100">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <div className="flex-1 p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
