ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS inbound_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS phone_numbers_number_idx ON public.phone_numbers (number);