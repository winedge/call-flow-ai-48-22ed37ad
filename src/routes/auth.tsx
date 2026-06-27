import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Phone, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — BulkCall AI" },
      { name: "description", content: "Sign in to BulkCall AI to manage your AI calling campaigns." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent, kind: "in" | "up") {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.error(
        kind === "in"
          ? "Sign-in requires Lovable Cloud — enable in workspace settings"
          : "Account creation requires Lovable Cloud",
      );
    }, 600);
  }

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <div className="size-9 bg-brand-primary rounded-md grid place-items-center">
            <Phone className="size-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="font-medium tracking-tight text-zinc-100 text-lg">
            BulkCall AI
          </span>
        </Link>

        <div className="bg-zinc-900/40 ring-1 ring-white/5 rounded-xl p-6 backdrop-blur-sm">
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-4">
              <form onSubmit={(e) => handleSubmit(e, "in")} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-in">Email</Label>
                  <Input id="email-in" type="email" required placeholder="you@company.com" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw-in">Password</Label>
                    <Link to="/auth/forgot-password" className="text-[11px] text-brand-primary hover:underline">
                      Forgot?
                    </Link>
                  </div>
                  <Input id="pw-in" type="password" required />
                </div>
                <Button type="submit" className="w-full bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110" disabled={loading}>
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled>
                  Continue with Google
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="space-y-4">
              <form onSubmit={(e) => handleSubmit(e, "up")} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name-up">Full name</Label>
                  <Input id="name-up" required placeholder="Ada Lovelace" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-up">Work email</Label>
                  <Input id="email-up" type="email" required placeholder="you@company.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-up">Password</Label>
                  <Input id="pw-up" type="password" required minLength={8} />
                </div>
                <Button type="submit" className="w-full bg-brand-primary text-primary-foreground hover:bg-brand-primary hover:brightness-110" disabled={loading}>
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-6 p-3 bg-amber-500/5 ring-1 ring-amber-500/20 rounded-lg flex gap-2 items-start text-[11px] text-amber-200/80">
          <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />
          <p>
            Auth & data persistence require <strong>Lovable Cloud</strong>. The
            app currently runs against an in-memory demo workspace. Continue to{" "}
            <Link to="/dashboard" className="underline text-brand-primary">
              the dashboard
            </Link>{" "}
            to explore.
          </p>
        </div>
      </div>
    </div>
  );
}
