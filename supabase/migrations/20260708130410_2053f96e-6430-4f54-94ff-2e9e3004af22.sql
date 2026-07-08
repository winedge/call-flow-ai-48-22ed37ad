ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS end_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_end_reason ON public.calls(end_reason);