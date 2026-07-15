UPDATE call_reflections
SET status='pending', attempts=0, last_error=NULL, next_attempt_at=NULL
WHERE status='skipped' AND last_error='transcript too short';