import { createServerFn } from "@tanstack/react-start";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !token) {
      return { live: false, reason: "Credentials missing" };
    }

    return { live: true };
  });
