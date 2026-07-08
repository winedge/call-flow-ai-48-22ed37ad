ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS voice_stability numeric,
  ADD COLUMN IF NOT EXISTS voice_similarity_boost numeric,
  ADD COLUMN IF NOT EXISTS voice_style numeric,
  ADD COLUMN IF NOT EXISTS voice_speaker_boost boolean;