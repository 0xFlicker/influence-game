CREATE TABLE postgame_media_wake_outbox (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at text NOT NULL DEFAULT now()::text,
  delivered_at text
);
--> statement-breakpoint
CREATE INDEX postgame_media_wake_pending_idx ON postgame_media_wake_outbox(created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
CREATE TABLE postgame_media_render_release (
  id integer PRIMARY KEY CHECK (id = 1),
  generation text,
  worker_digest text,
  draining boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE postgame_media_render_generations (
  generation text PRIMARY KEY,
  worker_digest text NOT NULL
);
--> statement-breakpoint
-- The trigger also covers old application writers during a rolling release.
-- The notification commits or rolls back with the authoritative job transition.
CREATE FUNCTION enqueue_postgame_media_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'queued' AND (TG_OP = 'INSERT' OR
      OLD.status IS DISTINCT FROM NEW.status OR
      OLD.render_version IS DISTINCT FROM NEW.render_version OR
      OLD.attempt_number IS DISTINCT FROM NEW.attempt_number) THEN
    INSERT INTO postgame_media_wake_outbox DEFAULT VALUES;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER postgame_media_queue_wake AFTER INSERT OR UPDATE ON game_postgame_media
FOR EACH ROW EXECUTE FUNCTION enqueue_postgame_media_wake();
--> statement-breakpoint
-- Existing queued work must survive switching from polling to on-demand execution.
INSERT INTO postgame_media_wake_outbox (id)
SELECT gen_random_uuid()::text WHERE EXISTS (SELECT 1 FROM game_postgame_media WHERE status = 'queued');
