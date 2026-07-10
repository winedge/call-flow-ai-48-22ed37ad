import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lazy-loading recording player for list rows.
 *
 * Twilio recording URLs require HTTP Basic auth, and the /api/calls/:id/recording
 * proxy requires a Bearer token — neither can be attached by <audio src>. So on
 * first click we fetch the audio as a blob via the proxy, swap in an object URL,
 * and let the native <audio> element take over from there.
 */
export function RecordingPlayer({ callId, className }: { callId: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const load = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (src || loading) return;
    setLoading(true);
    setError(null);
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
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setSrc(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return <span className="text-[11px] text-red-400 font-mono">{error}</span>;
  }

  if (src) {
    return (
      <audio
        controls
        autoPlay
        preload="auto"
        src={src}
        onClick={(e) => e.stopPropagation()}
        className={className ?? "h-8 w-56 max-w-full"}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-surface-border/60 hover:border-brand-primary/60 hover:bg-brand-primary/5 text-[11px] font-mono text-neutral-700 disabled:opacity-50"
    >
      <Play className="w-3 h-3" />
      {loading ? "Loading…" : "Play"}
    </button>
  );
}
