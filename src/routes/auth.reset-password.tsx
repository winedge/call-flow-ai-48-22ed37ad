import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({
    meta: [{ title: "Set new password — BulkCall AI" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [done, setDone] = useState(false);
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
              Password updated. <Link to="/auth" className="underline">Sign in</Link>.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setDone(true);
              }}
              className="space-y-4 mt-4"
            >
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm new password</Label>
                <Input id="pw2" type="password" required minLength={8} />
              </div>
              <Button type="submit" className="w-full bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110">
                Update password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
