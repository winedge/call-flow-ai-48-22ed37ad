
ALTER TABLE public.call_reflections
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.call_reflections
  ALTER COLUMN success_score DROP NOT NULL,
  ALTER COLUMN success_label DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_reflections_status_check'
  ) THEN
    ALTER TABLE public.call_reflections
      ADD CONSTRAINT call_reflections_status_check
      CHECK (status IN ('pending','success','failed','skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS call_reflections_retry_idx
  ON public.call_reflections (status, next_attempt_at)
  WHERE status IN ('pending','failed');

DROP TRIGGER IF EXISTS call_reflections_set_updated_at ON public.call_reflections;
CREATE TRIGGER call_reflections_set_updated_at
  BEFORE UPDATE ON public.call_reflections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
