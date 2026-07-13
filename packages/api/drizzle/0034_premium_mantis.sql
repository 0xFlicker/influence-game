WITH RECURSIVE "slug_candidates" AS (
	SELECT "id", 'legacy-' || "id" AS "candidate", 0 AS "suffix"
	FROM "games"
	WHERE "slug" IS NULL
	UNION ALL
	SELECT
		"slug_candidates"."id",
		'legacy-' || "slug_candidates"."id" || '-' || ("slug_candidates"."suffix" + 1),
		"slug_candidates"."suffix" + 1
	FROM "slug_candidates"
	WHERE EXISTS (
		SELECT 1 FROM "games"
		WHERE "games"."slug" = "slug_candidates"."candidate"
	)
), "available_slugs" AS (
	SELECT DISTINCT ON ("slug_candidates"."id")
		"slug_candidates"."id",
		"slug_candidates"."candidate"
	FROM "slug_candidates"
	WHERE NOT EXISTS (
		SELECT 1 FROM "games"
		WHERE "games"."slug" = "slug_candidates"."candidate"
	)
	ORDER BY "slug_candidates"."id", "slug_candidates"."suffix"
)
UPDATE "games"
SET "slug" = "available_slugs"."candidate"
FROM "available_slugs"
WHERE "games"."id" = "available_slugs"."id";--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "slug" SET NOT NULL;
