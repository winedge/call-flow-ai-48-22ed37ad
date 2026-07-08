ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS data_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb;