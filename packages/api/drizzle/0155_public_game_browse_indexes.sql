-- Direct public browsing: no projection, queue, or change capture.
-- Both functions depend only on their input. Numeric offsets and a fixed UTC
-- timezone make the sortable timestamp independent of the database session.
CREATE FUNCTION public.public_game_sort_time(value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $$
BEGIN
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?$' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN data_exception THEN RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.public_game_is_public(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE parsed jsonb;
BEGIN
  parsed := value::jsonb;
  RETURN jsonb_typeof(parsed)='object' AND (NOT (parsed ? 'visibility') OR parsed->'visibility'='"public"'::jsonb);
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;
