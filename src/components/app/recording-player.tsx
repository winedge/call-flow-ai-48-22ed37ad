import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Plays a Twilio call recording through the authenticated proxy at
 * /api/calls/:id/recording. The proxy requires a Bearer token which
 * `<audio src>` can't set, so we fetch as a blob and use an object URL.
 */
export function RecordingPlayer({ callId, className }: { callId: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setError(null);
    setSrc(null);
    setLoading(true);
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) {
          setError("Sign in required");
          return;
        }
        const res = await fetch(`/api/calls/${callId}/recording`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setError(`Unavailable (${res.status})`);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [callId]);

  if (error) return <span className="text-[11px] text-red-400">{error}</span>;
  if (loading || !src) return <span className="text-[11px] text-neutral-400">Loading…</span>;
  return (
    <audio
      controls
      preload="none"
      src={src}
      onClick={(e) => e.stopPropagation()}
      className={className ?? "h-8 w-56 max-w-full"}
    />
  );
}
