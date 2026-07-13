import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AuthPage } from "@/components/auth/auth-page";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in - Medical Calling AI" },
      { name: "description", content: "Sign in to Medical Calling AI to manage your AI calling campaigns." },
    ],
  }),
  component: IndexPage,
});

function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return <AuthPage />;
}
