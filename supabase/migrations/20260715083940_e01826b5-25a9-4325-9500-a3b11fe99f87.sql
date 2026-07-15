UPDATE call_reflections r
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    next_attempt_at = NULL
FROM calls c
WHERE r.call_id = c.id
  AND r.status = 'skipped'
  AND r.last_error = 'transcript too short'
  AND jsonb_typeof(c.transcript) = 'array'
  AND jsonb_array_length(c.transcript) >= 3;