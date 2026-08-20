import { createServerFn } from "@tanstack/react-start";
import { getTwilioEnv } from "./status.server";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const { sid, token } = await getTwilioEnv();

      if (!sid || !token) {
        return { live: false, reason: "Credentials missing" };
      }

      return { live: true };
    } catch (error) {
      console.error("[checkTwilioConnection] failed:", error);
      return { live: false, reason: "Check failed" };
    }
  });
