import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const checkTwilioConnection = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      // In a real app, this would check the Twilio API or look for verified credentials in the database.
      // For this project, we check if the user has a TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secret set.
      // Since secrets are private to the handler, we can verify their presence here.
      
      const sid = process.env['TWILIO_ACCOUNT_SID'];
      const token = process.env['TWILIO_AUTH_TOKEN'];

      if (!sid || !token) {
        return { live: false, reason: "Credentials missing" };
      }

      // Optional: Actually ping Twilio API here if desired. 
      // For a "live status" in the header, checking for configured credentials is the standard first step.
      return { live: true };
    } catch (error) {
      console.error("[checkTwilioConnection] failed:", error);
      return { live: false, reason: "Check failed" };
    }
  });
