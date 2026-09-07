ALTER TABLE "provider_logical_calls"
  ADD COLUMN "semantic_coordinate" jsonb,
  ADD COLUMN "semantic_coordinate_hash" text;

ALTER TABLE "provider_logical_calls"
  ALTER COLUMN "logical_call_ordinal" DROP NOT NULL;

ALTER TABLE "provider_logical_calls"
  DROP CONSTRAINT "provider_logical_calls_ordinal_check";

ALTER TABLE "provider_logical_calls"
  ADD CONSTRAINT "provider_logical_calls_ordinal_check"
  CHECK ("next_attempt_ordinal" > 0);

CREATE INDEX "provider_logical_calls_semantic_coordinate_hash_idx"
  ON "provider_logical_calls" ("game_id", "semantic_coordinate_hash");
