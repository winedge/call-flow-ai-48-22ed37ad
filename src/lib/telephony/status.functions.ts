import { createServerFn } from "@tanstack/react-start";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      // Access env vars inside handler to ensure server-side execution and avoid bundling issues
      const sid = process.env['TWILIO_ACCOUNT_SID'];
      const token = process.env['TWILIO_AUTH_TOKEN'];

      return {
        live: !!(sid && token),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[checkTwilioConnection] failed:", error);
      return { live: false, reason: "Check failed" };
    }
  });
