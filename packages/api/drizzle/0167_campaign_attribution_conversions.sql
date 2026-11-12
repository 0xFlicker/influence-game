CREATE TABLE "user_campaign_attribution" (
	"user_id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"first_touch_at" text,
	"last_touch_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "user_campaign_attribution_channel_check" CHECK ("user_campaign_attribution"."channel" IN ('web', 'mcp', 'api'))
);
--> statement-breakpoint
CREATE TABLE "campaign_conversion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"user_id" text NOT NULL,
	"public_id" text NOT NULL,
	"agent_profile_id" text,
	"season_id" text,
	"channel" text NOT NULL,
	"mcp_client_id" text,
	"attribution" jsonb,
	"occurred_at" text DEFAULT now()::text NOT NULL,
	"posthog_status" text DEFAULT 'pending' NOT NULL,
	"posthog_attempts" integer DEFAULT 0 NOT NULL,
	"platform_status" text DEFAULT 'pending' NOT NULL,
	"platform_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" text,
	CONSTRAINT "campaign_conversion_events_channel_check" CHECK ("campaign_conversion_events"."channel" IN ('web', 'mcp', 'api')),
	CONSTRAINT "campaign_conversion_events_name_check" CHECK ("campaign_conversion_events"."event_name" IN ('signup_completed', 'agent_creation_started', 'agent_created', 'agent_ready', 'season_entry', 'game_placed', 'mcp_linked', 'owner_returned'))
);
--> statement-breakpoint
ALTER TABLE "user_campaign_attribution" ADD CONSTRAINT "user_campaign_attribution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_conversion_events" ADD CONSTRAINT "campaign_conversion_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_conversion_events" ADD CONSTRAINT "campaign_conversion_events_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_conversion_events" ADD CONSTRAINT "campaign_conversion_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "campaign_conversion_events_name_time_idx" ON "campaign_conversion_events" ("event_name", "occurred_at");
--> statement-breakpoint
CREATE INDEX "campaign_conversion_events_delivery_idx" ON "campaign_conversion_events" ("posthog_status", "platform_status");
