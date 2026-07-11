CREATE TABLE "agent_competition_ratings" (
	"agent_profile_id" text PRIMARY KEY NOT NULL,
	"effective_revision_id" text NOT NULL,
	"mu" double precision NOT NULL,
	"sigma" double precision NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"rating_policy_version" text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_competition_ratings_mu_check" CHECK ("agent_competition_ratings"."mu" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "agent_competition_ratings_sigma_check" CHECK ("agent_competition_ratings"."sigma" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) AND "agent_competition_ratings"."sigma" > 0),
	CONSTRAINT "agent_competition_ratings_games_check" CHECK ("agent_competition_ratings"."games_played" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_profile_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"prior_revision_id" text,
	"trigger" text NOT NULL,
	"magnitude" text NOT NULL,
	"fingerprint" text NOT NULL,
	"behavior_snapshot" jsonb NOT NULL,
	"effective_runtime_snapshot" jsonb NOT NULL,
	"revision_policy_version" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "agent_revisions_ordinal_check" CHECK ("agent_revisions"."ordinal" > 0),
	CONSTRAINT "agent_revisions_trigger_check" CHECK ("agent_revisions"."trigger" IN ('initial_backfill', 'profile_create', 'profile_edit', 'runtime_policy_change')),
	CONSTRAINT "agent_revisions_magnitude_check" CHECK ("agent_revisions"."magnitude" IN ('initial', 'small', 'material', 'execution'))
);
--> statement-breakpoint
CREATE TABLE "competition_rating_events" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"agent_revision_id" text NOT NULL,
	"season_id" text,
	"game_id" text,
	"event_type" text NOT NULL,
	"before_mu" double precision,
	"before_sigma" double precision,
	"after_mu" double precision NOT NULL,
	"after_sigma" double precision NOT NULL,
	"rating_policy_version" text NOT NULL,
	"revision_policy_version" text,
	"evidence" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "competition_rating_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "competition_rating_events_type_check" CHECK ("competition_rating_events"."event_type" IN ('initialization', 'revision_recalibration', 'game_result')),
	CONSTRAINT "competition_rating_events_before_pair_check" CHECK (("competition_rating_events"."before_mu" IS NULL) = ("competition_rating_events"."before_sigma" IS NULL)),
	CONSTRAINT "competition_rating_events_before_values_check" CHECK (
    "competition_rating_events"."before_mu" IS NULL
    OR ("competition_rating_events"."before_mu" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      AND "competition_rating_events"."before_sigma" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      AND "competition_rating_events"."before_sigma" > 0)
  ),
	CONSTRAINT "competition_rating_events_after_check" CHECK (
    "competition_rating_events"."after_mu" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND "competition_rating_events"."after_sigma" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND "competition_rating_events"."after_sigma" > 0
  )
);
--> statement-breakpoint
CREATE TABLE "competition_rating_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"agent_revision_id" text NOT NULL,
	"mu" double precision NOT NULL,
	"sigma" double precision NOT NULL,
	"rating_policy_version" text NOT NULL,
	"captured_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "competition_rating_snapshots_mu_check" CHECK ("competition_rating_snapshots"."mu" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "competition_rating_snapshots_sigma_check" CHECK ("competition_rating_snapshots"."sigma" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) AND "competition_rating_snapshots"."sigma" > 0)
);
--> statement-breakpoint
CREATE TABLE "competition_receipt_evidence" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"rating_policy_version" text NOT NULL,
	"pregame_rating" jsonb NOT NULL,
	"postgame_rating" jsonb,
	"opponent_ratings" jsonb NOT NULL,
	"field_strength_evidence" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"game_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"agent_revision_id" text NOT NULL,
	"owner_display_name_snapshot" text,
	"agent_name_snapshot" text NOT NULL,
	"eligibility_status" text NOT NULL,
	"eligibility_reason" text,
	"lobby_size" integer NOT NULL,
	"placement" integer,
	"base_points" integer DEFAULT 0 NOT NULL,
	"field_bonus" integer DEFAULT 0 NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"account_rating_delta" integer,
	"scoring_policy_version" text NOT NULL,
	"earned_at" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "competition_receipts_eligibility_check" CHECK ("competition_receipts"."eligibility_status" IN ('eligible', 'ineligible')),
	CONSTRAINT "competition_receipts_lobby_size_check" CHECK ("competition_receipts"."lobby_size" >= 2),
	CONSTRAINT "competition_receipts_points_check" CHECK (
    "competition_receipts"."base_points" >= 0
    AND "competition_receipts"."field_bonus" >= 0
    AND "competition_receipts"."total_points" = "competition_receipts"."base_points" + "competition_receipts"."field_bonus"
  ),
	CONSTRAINT "competition_receipts_status_values_check" CHECK (
    ("competition_receipts"."eligibility_status" = 'eligible'
      AND "competition_receipts"."placement" BETWEEN 1 AND "competition_receipts"."lobby_size"
      AND "competition_receipts"."eligibility_reason" IS NULL)
    OR ("competition_receipts"."eligibility_status" = 'ineligible'
      AND "competition_receipts"."base_points" = 0
      AND "competition_receipts"."field_bonus" = 0
      AND "competition_receipts"."total_points" = 0
      AND "competition_receipts"."eligibility_reason" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "season_honors" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"agent_champion_agent_profile_id" text NOT NULL,
	"agent_champion_owner_id" text NOT NULL,
	"agent_champion_name_snapshot" text NOT NULL,
	"agent_champion_owner_name_snapshot" text,
	"agent_champion_points" integer NOT NULL,
	"architect_champion_owner_id" text NOT NULL,
	"architect_champion_owner_name_snapshot" text,
	"architect_champion_points_hundredths" integer NOT NULL,
	"architect_contributions" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "season_honors_season_id_unique" UNIQUE("season_id"),
	CONSTRAINT "season_honors_points_check" CHECK (
    "season_honors"."agent_champion_points" >= 0
    AND "season_honors"."architect_champion_points_hundredths" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rated_pool" text DEFAULT 'free' NOT NULL,
	"admission_starts_at" text,
	"admission_closes_at" text,
	"finalized_at" text,
	"created_by_id" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "seasons_slug_unique" UNIQUE("slug"),
	CONSTRAINT "seasons_status_check" CHECK ("seasons"."status" IN ('active', 'closing', 'final')),
	CONSTRAINT "seasons_rated_pool_check" CHECK ("seasons"."rated_pool" IN ('free'))
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "current_revision_id" text;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "agent_revision_id" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "agent_competition_ratings" ADD CONSTRAINT "agent_competition_ratings_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_competition_ratings" ADD CONSTRAINT "agent_competition_ratings_effective_revision_id_agent_revisions_id_fk" FOREIGN KEY ("effective_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_prior_revision_id_agent_revisions_id_fk" FOREIGN KEY ("prior_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_events" ADD CONSTRAINT "competition_rating_events_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_events" ADD CONSTRAINT "competition_rating_events_agent_revision_id_agent_revisions_id_fk" FOREIGN KEY ("agent_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_events" ADD CONSTRAINT "competition_rating_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_events" ADD CONSTRAINT "competition_rating_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_snapshots" ADD CONSTRAINT "competition_rating_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_snapshots" ADD CONSTRAINT "competition_rating_snapshots_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_rating_snapshots" ADD CONSTRAINT "competition_rating_snapshots_agent_revision_id_agent_revisions_id_fk" FOREIGN KEY ("agent_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipt_evidence" ADD CONSTRAINT "competition_receipt_evidence_receipt_id_competition_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."competition_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipts" ADD CONSTRAINT "competition_receipts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipts" ADD CONSTRAINT "competition_receipts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipts" ADD CONSTRAINT "competition_receipts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipts" ADD CONSTRAINT "competition_receipts_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_receipts" ADD CONSTRAINT "competition_receipts_agent_revision_id_agent_revisions_id_fk" FOREIGN KEY ("agent_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_honors" ADD CONSTRAINT "season_honors_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_honors" ADD CONSTRAINT "season_honors_agent_champion_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_champion_agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_honors" ADD CONSTRAINT "season_honors_agent_champion_owner_id_users_id_fk" FOREIGN KEY ("agent_champion_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_honors" ADD CONSTRAINT "season_honors_architect_champion_owner_id_users_id_fk" FOREIGN KEY ("architect_champion_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_competition_ratings_revision_idx" ON "agent_competition_ratings" USING btree ("effective_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_revisions_profile_ordinal_unique" ON "agent_revisions" USING btree ("agent_profile_id","ordinal");--> statement-breakpoint
CREATE INDEX "agent_revisions_profile_fingerprint_idx" ON "agent_revisions" USING btree ("agent_profile_id","fingerprint");--> statement-breakpoint
CREATE INDEX "agent_revisions_profile_created_idx" ON "agent_revisions" USING btree ("agent_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "competition_rating_events_agent_created_idx" ON "competition_rating_events" USING btree ("agent_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "competition_rating_events_game_idx" ON "competition_rating_events" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_rating_snapshots_game_agent_unique" ON "competition_rating_snapshots" USING btree ("game_id","agent_profile_id");--> statement-breakpoint
CREATE INDEX "competition_rating_snapshots_game_idx" ON "competition_rating_snapshots" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_receipts_season_game_agent_unique" ON "competition_receipts" USING btree ("season_id","game_id","agent_profile_id");--> statement-breakpoint
CREATE INDEX "competition_receipts_season_agent_idx" ON "competition_receipts" USING btree ("season_id","agent_profile_id","earned_at");--> statement-breakpoint
CREATE INDEX "competition_receipts_season_owner_idx" ON "competition_receipts" USING btree ("season_id","owner_id","earned_at");--> statement-breakpoint
CREATE INDEX "competition_receipts_game_idx" ON "competition_receipts" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_one_active_pool_unique" ON "seasons" USING btree ("rated_pool") WHERE "seasons"."status" = 'active';--> statement-breakpoint
CREATE INDEX "seasons_status_created_idx" ON "seasons" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_current_revision_id_agent_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_agent_revision_id_agent_revisions_id_fk" FOREIGN KEY ("agent_revision_id") REFERENCES "public"."agent_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_profiles_current_revision_idx" ON "agent_profiles" USING btree ("current_revision_id");--> statement-breakpoint
CREATE INDEX "game_players_agent_revision_id_idx" ON "game_players" USING btree ("agent_revision_id");--> statement-breakpoint
CREATE INDEX "games_season_id_status_idx" ON "games" USING btree ("season_id","status");