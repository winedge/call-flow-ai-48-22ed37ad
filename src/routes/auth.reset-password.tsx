import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({
    meta: [{ title: "Set new password — BulkCall AI" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase handles the recovery link automatically and sets a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pw = (e.currentTarget.elements.namedItem("pw") as HTMLInputElement).value;
    const pw2 = (e.currentTarget.elements.namedItem("pw2") as HTMLInputElement).value;
    if (pw !== pw2) return toast.error("Passwords don't match");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) return toast.error(error.message);
    setDone(true);
    setTimeout(() => navigate({ to: "/dashboard" }), 800);
  }

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-9 bg-brand-primary rounded-md grid place-items-center">
            <Phone className="size-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="font-medium tracking-tight text-zinc-100 text-lg">
            BulkCall AI
          </span>
        </div>

        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-zinc-100">Set a new password</h1>
          {done ? (
            <p className="text-sm text-brand-primary mt-3">
              Password updated. Redirecting…
            </p>
          ) : !ready ? (
            <p className="text-sm text-zinc-500 mt-3">
              Open the reset link from your email to continue. <Link to="/auth" className="underline">Back to sign in</Link>.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" name="pw" type="password" required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm new password</Label>
                <Input id="pw2" name="pw2" type="password" required minLength={8} />
              </div>
              <Button type="submit" className="w-full bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110" disabled={loading}>
                {loading ? "Updating..." : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
