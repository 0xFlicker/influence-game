ALTER TABLE character_cutouts ADD COLUMN art_saved_at timestamptz, ADD COLUMN art_save_attempted_at timestamptz, ADD COLUMN save_error text;
--> statement-breakpoint
ALTER TABLE character_cutout_demands ADD COLUMN preparation_attempted_at timestamptz;
--> statement-breakpoint
ALTER TABLE agent_content_assets ADD COLUMN transparent_url text;
--> statement-breakpoint
DROP TRIGGER agent_content_assets_immutable ON agent_content_assets;
--> statement-breakpoint
CREATE FUNCTION protect_agent_content_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Accepted character evidence is immutable'; END IF;
  IF NEW.hash IS DISTINCT FROM OLD.hash OR NEW.bytes_object IS DISTINCT FROM OLD.bytes_object THEN
    RAISE EXCEPTION 'Accepted character evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agent_content_assets_immutable BEFORE UPDATE OR DELETE ON agent_content_assets
FOR EACH ROW EXECUTE FUNCTION protect_agent_content_asset();
