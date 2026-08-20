import { createServerFn } from "@tanstack/react-start";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;

      if (!sid || !token) {
        return { live: false, reason: "Credentials missing" };
      }

      return { live: true };
    } catch (error) {
      console.error("[checkTwilioConnection] failed:", error);
      return { live: false, reason: "Check failed" };
    }
  });
