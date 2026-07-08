
DROP INDEX IF EXISTS public.phone_numbers_user_twilio_sid_key;

ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_user_twilio_sid_key UNIQUE (user_id, twilio_sid);
