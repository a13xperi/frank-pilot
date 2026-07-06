-- No-PII aggregate metrics for the Token Watch "Frank Ops" dashboard tab.
--
-- Returns ONLY counts + timestamps over voice_intake_calls (inbound) and units.
-- It never selects names, phone numbers, transcripts, or any row-level PII, so it
-- is safe to expose to the anon key and to read from the operator dashboard.
--
-- SECURITY DEFINER + a pinned empty search_path (with fully-qualified names) so
-- the aggregate is readable regardless of caller role / future RLS, with no
-- search_path injection surface.

CREATE OR REPLACE FUNCTION public.frank_call_metrics()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'calls_24h',       (SELECT count(*) FROM public.voice_intake_calls
                          WHERE started_at >= now() - interval '24 hours'),
    'calls_7d',        (SELECT count(*) FROM public.voice_intake_calls
                          WHERE started_at >= now() - interval '7 days'),
    'answered_7d',     (SELECT count(*) FROM public.voice_intake_calls
                          WHERE started_at >= now() - interval '7 days'
                            AND call_successful = 'success'),
    'callbacks_7d',    (SELECT count(*) FROM public.voice_intake_calls
                          WHERE started_at >= now() - interval '7 days'
                            AND callback_requested),
    'units_total',     (SELECT count(*) FROM public.units),
    'units_leased',    (SELECT count(*) FROM public.units WHERE status = 'leased'),
    'units_available', (SELECT count(*) FROM public.units WHERE status = 'available'),
    'units_held',      (SELECT count(*) FROM public.units WHERE status = 'held'),
    'generated_at',    now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.frank_call_metrics() TO anon, authenticated;

COMMENT ON FUNCTION public.frank_call_metrics() IS
  'No-PII aggregate metrics for the Token Watch Frank Ops dashboard. Returns only counts/timestamps over voice_intake_calls + units; never row-level PII.';
