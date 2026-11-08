ALTER TABLE agent_content_assets ADD COLUMN is_public boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE agent_content_assets ALTER COLUMN is_public SET DEFAULT false;
--> statement-breakpoint
CREATE TABLE agent_image_owners (user_id text NOT NULL REFERENCES users(id),hash text NOT NULL REFERENCES agent_content_assets(hash),PRIMARY KEY(user_id,hash));
