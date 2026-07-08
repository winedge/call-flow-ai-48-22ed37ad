
ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS has_twilio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_elevenlabs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_openai boolean NOT NULL DEFAULT false;

UPDATE public.org_settings SET has_twilio = true WHERE has_twilio = false;
