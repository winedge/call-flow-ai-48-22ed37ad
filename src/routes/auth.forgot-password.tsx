import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Phone, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => ({
    meta: [{ title: "Reset password - Medical Calling AI" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/auth" className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 text-xs mb-6">
          <ArrowLeft className="size-3.5" /> Back to sign in
        </Link>
        <div className="flex items-center gap-3 mb-8">
          <div className="size-9 bg-brand-primary rounded-md grid place-items-center">
            <Phone className="size-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="font-medium tracking-tight text-neutral-900 text-lg">
            Medical Calling AI
          </span>
        </div>

        <div className="bg-white ring-1 ring-black/5 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-neutral-900">Reset password</h1>
          <p className="text-sm text-neutral-500 mt-1 mb-6">
            Enter your email and we'll send you a reset link.
          </p>
          {sent ? (
            <p className="text-sm text-brand-primary">
              If an account exists for that email, you'll receive a reset link shortly.
            </p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const email = (e.currentTarget.elements.namedItem("em") as HTMLInputElement).value;
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                  redirectTo: `${window.location.origin}/auth/reset-password`,
                });
                if (error) return toast.error(error.message);
                setSent(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="em">Email</Label>
                <Input id="em" name="em" type="email" required />
              </div>
              <Button type="submit" className="w-full bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
                Send reset link
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
