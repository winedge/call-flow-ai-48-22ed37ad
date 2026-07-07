/**
 * Deepgram Nova-2 streaming STT — Phase B placeholder.
 * Target cost: ~$0.0043/min. Wired in when the real turn-loop lands.
 */
import type { SttEngine } from "@/lib/voice/types";

export const deepgramStub: SttEngine = {
  id: "deepgram-nova-2",
  label: "Deepgram Nova-2 (streaming)",
  async *transcribeStream() {
    throw new Error("Deepgram STT is not wired yet (Phase B).");
  },
};
