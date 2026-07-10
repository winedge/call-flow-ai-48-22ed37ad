/**
 * Small helpers to display a call's sentiment consistently.
 * Sentiment is populated by the reflection loop as "positive" | "neutral" | "negative".
 */
export type Sentiment = "positive" | "neutral" | "negative" | null | undefined;

export function sentimentLabel(s: Sentiment): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sentimentClass(s: Sentiment): string {
  switch (s) {
    case "positive":
      return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
    case "negative":
      return "text-red-500 bg-red-500/10 border-red-500/30";
    case "neutral":
      return "text-amber-500 bg-amber-500/10 border-amber-500/30";
    default:
      return "text-neutral-500 bg-neutral-500/5 border-neutral-500/20";
  }
}

export function SentimentBadge({ value }: { value: Sentiment }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-mono ${sentimentClass(value)}`}
    >
      {sentimentLabel(value)}
    </span>
  );
}
