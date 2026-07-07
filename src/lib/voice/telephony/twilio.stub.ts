/**
 * Twilio Programmable Voice — Phase C placeholder.
 *
 * Deliberately NOT Twilio Elastic SIP Trunking. Programmable Voice keeps
 * the stack simple: Twilio handles STIR/SHAKEN, DNC, geo permissions, and
 * Media Streams natively, so we skip FreeSWITCH entirely.
 *
 * Cost floor: ~$0.014/min (US outbound). All-in ~$0.021–0.023/min.
 */
import type { TelephonyProvider } from "@/lib/voice/types";

export const twilioProgrammableVoiceStub: TelephonyProvider = {
  id: "twilio-programmable-voice",
  label: "Twilio Programmable Voice",
  costPerMinuteUsd: 0.014,
  async placeCall() {
    throw new Error("Twilio Programmable Voice is not wired yet (Phase C).");
  },
};
