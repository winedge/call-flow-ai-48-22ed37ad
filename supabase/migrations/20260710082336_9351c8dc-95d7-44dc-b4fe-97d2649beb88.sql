
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS playbook text,
  ADD COLUMN IF NOT EXISTS playbook_calls_analyzed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS playbook_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.call_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  success_score integer NOT NULL DEFAULT 0,
  success_label text NOT NULL DEFAULT 'neutral',
  what_worked jsonb NOT NULL DEFAULT '[]'::jsonb,
  what_failed jsonb NOT NULL DEFAULT '[]'::jsonb,
  objections jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_learnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(call_id)
);

CREATE INDEX IF NOT EXISTS call_reflections_agent_idx ON public.call_reflections(agent_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_reflections TO authenticated;
GRANT ALL ON public.call_reflections TO service_role;

ALTER TABLE public.call_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own reflections"
  ON public.call_reflections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage their own reflections"
  ON public.call_reflections FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
