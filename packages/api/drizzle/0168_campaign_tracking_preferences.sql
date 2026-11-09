CREATE TABLE "user_analytics_preferences" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "analytics" boolean NOT NULL DEFAULT false,
  "updated_at" text NOT NULL DEFAULT now()::text
);
