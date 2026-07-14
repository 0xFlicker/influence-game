DO $$
DECLARE
  duplicate_summary text;
BEGIN
  SELECT string_agg(
    format('%s (%s profiles)', duplicate.normalized_name, duplicate.profile_count),
    ', ' ORDER BY duplicate.normalized_name
  )
  INTO duplicate_summary
  FROM (
    SELECT lower(btrim("name")) AS normalized_name, count(*) AS profile_count
    FROM "agent_profiles"
    GROUP BY lower(btrim("name"))
    HAVING count(*) > 1
    ORDER BY lower(btrim("name"))
    LIMIT 25
  ) AS duplicate;

  IF duplicate_summary IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot enforce globally unique agent profile names; duplicate normalized names: ' || duplicate_summary,
      HINT = 'Resolve ambiguous saved-profile duplicates explicitly before retrying this migration. No profiles were renamed or deleted.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profiles_normalized_name_unique" ON "agent_profiles" USING btree (lower(btrim("name")));
