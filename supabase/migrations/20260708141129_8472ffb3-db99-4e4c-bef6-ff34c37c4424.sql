
-- Remove any accidental duplicates before adding the constraint (keep oldest)
DELETE FROM public.phone_numbers a
USING public.phone_numbers b
WHERE a.user_id = b.user_id
  AND a.twilio_sid = b.twilio_sid
  AND a.twilio_sid <> ''
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_user_twilio_sid_key
  ON public.phone_numbers (user_id, twilio_sid)
  WHERE twilio_sid <> '';
