ALTER TABLE visual_media_publications ADD COLUMN audience text NOT NULL DEFAULT 'public';
--> statement-breakpoint
ALTER TABLE visual_media_publications ADD CONSTRAINT visual_media_publication_audience_check CHECK (audience IN ('public', 'private'));
--> statement-breakpoint
-- Existing Werewolf publications approved private production only.
UPDATE visual_media_publications p SET audience = 'private' FROM games g WHERE p.game_id = g.id AND g.game_kind = 'werewolf';
