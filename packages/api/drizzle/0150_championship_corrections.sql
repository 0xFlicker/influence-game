ALTER TABLE championship_matches ADD COLUMN result_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE championship_results ADD COLUMN revision integer NOT NULL DEFAULT 0, ADD COLUMN game_id text REFERENCES games(id);
--> statement-breakpoint
UPDATE championship_results r SET game_id = m.game_id FROM championship_matches m WHERE m.id = r.match_id;
--> statement-breakpoint
ALTER TABLE championship_results ALTER COLUMN game_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE championship_results DROP CONSTRAINT championship_results_pkey;
--> statement-breakpoint
ALTER TABLE championship_results ADD PRIMARY KEY(match_id,entry_id,revision);
--> statement-breakpoint
ALTER TABLE championship_award_allocations ADD COLUMN generation integer NOT NULL DEFAULT 0, ADD COLUMN superseded_at text;
--> statement-breakpoint
ALTER TABLE championship_award_allocations DROP CONSTRAINT championship_awards_phase;
--> statement-breakpoint
ALTER TABLE championship_award_allocations ADD CONSTRAINT championship_awards_phase UNIQUE(event_id,phase,generation);
--> statement-breakpoint
ALTER TABLE award_grants ADD COLUMN allocation_id text REFERENCES championship_award_allocations(id), ADD COLUMN replaced_by_id text REFERENCES award_grants(id);
--> statement-breakpoint
UPDATE award_grants g SET allocation_id = a.id FROM championship_award_allocations a JOIN competition_audit audit ON audit.request_id ~ ('^' || a.id || ':[0-9]+$') AND audit.action = 'award_granted' WHERE audit.grant_id = g.id;
