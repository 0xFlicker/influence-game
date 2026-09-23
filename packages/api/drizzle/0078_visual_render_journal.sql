CREATE TABLE "visual_render_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "operation_key" text NOT NULL,
  "input_hash" text NOT NULL,
  "generation" integer DEFAULT 1 NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "visual_render_operations_key_unique" UNIQUE("game_id", "operation_key")
);
--> statement-breakpoint
CREATE TABLE "visual_render_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL REFERENCES "visual_render_operations"("id") ON DELETE CASCADE,
  "generation" integer NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "request_hash" text NOT NULL,
  "receipt" jsonb,
  "image" bytea,
  "image_hash" text,
  "cost_microusd" bigint,
  "reconciliation" jsonb,
  "created_at" text DEFAULT now()::text NOT NULL,
  "finished_at" text,
  CONSTRAINT "visual_render_attempts_dispatch_unique" UNIQUE("operation_id", "generation", "provider"),
  CONSTRAINT "visual_render_attempts_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "visual_render_attempts_provider_check" CHECK ("provider" IN ('openai', 'xai')),
  CONSTRAINT "visual_render_attempts_image_check" CHECK (("image" IS NULL) = ("image_hash" IS NULL)),
  CONSTRAINT "visual_render_attempts_cost_check" CHECK ("cost_microusd" IS NULL OR "cost_microusd" >= 0)
);
