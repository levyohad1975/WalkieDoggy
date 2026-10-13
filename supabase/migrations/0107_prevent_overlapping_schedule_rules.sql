-- Staging-first, review-required migration: reject overlapping active recurring walks.
-- Existing overlaps are not deleted or rewritten. The trigger checks future writes.
-- Advisory transaction lock serializes concurrent writers for the same family/dog/time.
CREATE OR REPLACE FUNCTION public.prevent_overlapping_schedule_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.family_id::text || ':' || NEW.dog_id::text || ':' || NEW.time, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.schedule_rules existing
    WHERE existing.active = TRUE
      AND existing.id <> NEW.id
      AND existing.family_id = NEW.family_id
      AND existing.dog_id = NEW.dog_id
      AND existing.time = NEW.time
      AND existing.days_of_week && NEW.days_of_week
  ) THEN
    RAISE EXCEPTION 'Overlapping recurring walk for dog at time %', NEW.time
      USING ERRCODE = '23505', CONSTRAINT = 'schedule_rules_no_overlapping_days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_rules_prevent_overlap ON public.schedule_rules;
CREATE TRIGGER schedule_rules_prevent_overlap
BEFORE INSERT OR UPDATE OF family_id, dog_id, time, days_of_week, active
ON public.schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_schedule_rules();
