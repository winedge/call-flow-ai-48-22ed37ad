/**
 * Deepgram streaming STT over WebSocket.
 *
 * We send raw μ-law/8k audio (same format Twilio gives us — zero
 * conversion). Deepgram sends back interim + final transcripts. We only
 * surface finals to the dialog loop; interims are used to detect that the
 * caller is talking so we can barge-in on our current TTS playback.
 */

export type DeepgramCallbacks = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onClose: () => void;
  onError: (err: unknown) => void;
};

export function openDeepgram(apiKey: string, cb: DeepgramCallbacks): {
  send: (mu: Uint8Array) => void;
  close: () => void;
} {
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("encoding", "mulaw");
  url.searchParams.set("sample_rate", "8000");
  url.searchParams.set("channels", "1");
  url.searchParams.set("model", "nova-2-phonecall");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("endpointing", "300");
  url.searchParams.set("vad_events", "true");

  const ws = new WebSocket(url.toString(), ["token", apiKey]);
  let closed = false;

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      if (msg.type === "Results") {
        const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!text) return;
        if (msg.is_final || msg.speech_final) cb.onFinal(text);
        else cb.onInterim(text);
      }
    } catch (e) {
      cb.onError(e);
    }
  });
  ws.addEventListener("close", () => {
    closed = true;
    cb.onClose();
  });
  ws.addEventListener("error", (e) => cb.onError(e));

  return {
    send: (mu) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(mu);
    },
    close: () => {
      if (closed) return;
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        /* ignore */
      }
      ws.close();
    },
  };
}
