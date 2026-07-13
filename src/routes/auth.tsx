import { createFileRoute } from "@tanstack/react-router";

import { AuthPage } from "@/components/auth/auth-page";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in - Medical Calling AI" },
      { name: "description", content: "Sign in to Medical Calling AI to manage your AI calling campaigns." },
    ],
  }),
  component: AuthPage,
});
