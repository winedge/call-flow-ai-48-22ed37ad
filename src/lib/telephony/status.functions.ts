import { createServerFn } from "@tanstack/react-start";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    return {
      live: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      timestamp: Date.now(),
    };
  });
