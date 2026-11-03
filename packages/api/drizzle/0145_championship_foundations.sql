CREATE TABLE championship_events (
 id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL,
 source_season_id text NOT NULL REFERENCES seasons(id), status text NOT NULL DEFAULT 'draft',
 published boolean NOT NULL DEFAULT false, policies jsonb NOT NULL, start_date text,
 qualification_object jsonb, role_schedule_object jsonb,
 created_by_id text NOT NULL REFERENCES users(id), created_at text NOT NULL DEFAULT now()::text, locked_at text,
 CONSTRAINT championship_events_status CHECK (status IN ('draft','locked','running','paused','final'))
);
--> statement-breakpoint
CREATE TABLE championship_entries (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES championship_events(id),
 agent_id text NOT NULL REFERENCES agent_profiles(id), owner_id text NOT NULL REFERENCES users(id),
 name text NOT NULL, qualification_rank integer NOT NULL, season_points integer NOT NULL,
 source_revision_id text REFERENCES agent_revisions(id), build_object jsonb NOT NULL,
 CONSTRAINT championship_entry_agent UNIQUE(event_id,agent_id),
 CONSTRAINT championship_entry_rank UNIQUE(event_id,qualification_rank),
 CONSTRAINT championship_entry_rank_positive CHECK(qualification_rank > 0)
);
--> statement-breakpoint
CREATE TABLE championship_matches (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES championship_events(id), ordinal integer NOT NULL,
 game_kind text NOT NULL, scheduled_at text NOT NULL, game_id text REFERENCES games(id), status text NOT NULL DEFAULT 'scheduled',
 CONSTRAINT championship_match_ordinal UNIQUE(event_id,ordinal), CONSTRAINT championship_match_game UNIQUE(game_id),
 CONSTRAINT championship_match_format CHECK((ordinal BETWEEN 1 AND 16 AND game_kind='werewolf') OR (ordinal=17 AND game_kind='influence')),
 CONSTRAINT championship_match_status CHECK(status IN ('scheduled','running','settling','completed','void'))
);
--> statement-breakpoint
CREATE TABLE award_definitions (
 code text PRIMARY KEY, title text NOT NULL, recipient_type text NOT NULL, theme text NOT NULL DEFAULT 'season-0', version integer NOT NULL DEFAULT 1,
 CONSTRAINT award_definition_recipient CHECK(recipient_type IN ('agent','account'))
);
--> statement-breakpoint
CREATE TABLE award_grants (
 id text PRIMARY KEY, definition_code text NOT NULL REFERENCES award_definitions(code),
 agent_id text REFERENCES agent_profiles(id), account_id text REFERENCES users(id),
 recipient_key text NOT NULL, source_key text NOT NULL, source_season_id text REFERENCES seasons(id),
 source_event_id text REFERENCES championship_events(id), evidence_object jsonb NOT NULL,
 granted_by_id text NOT NULL REFERENCES users(id), reason text NOT NULL,
 granted_at text NOT NULL DEFAULT now()::text, revoked_at text,
 CONSTRAINT award_grant_achievement UNIQUE(definition_code,recipient_key,source_key),
 CONSTRAINT award_grant_recipient CHECK((agent_id IS NOT NULL AND account_id IS NULL AND recipient_key='agent:' || agent_id) OR (account_id IS NOT NULL AND agent_id IS NULL AND recipient_key='account:' || account_id))
);
--> statement-breakpoint
CREATE TABLE competition_audit (
 id text PRIMARY KEY, event_id text REFERENCES championship_events(id), grant_id text REFERENCES award_grants(id),
 actor_id text NOT NULL REFERENCES users(id), action text NOT NULL, reason text NOT NULL,
 request_id text NOT NULL, created_at text NOT NULL DEFAULT now()::text,
 CONSTRAINT competition_audit_request UNIQUE(actor_id,request_id)
);
--> statement-breakpoint
ALTER TABLE championship_events ADD CONSTRAINT payload_9f85e5870c79_check CHECK (qualification_object IS NULL OR ((
 jsonb_typeof(qualification_object) = 'object'
 AND qualification_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (qualification_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND qualification_object->>'storage' = 'private-payload-v1' AND qualification_object->>'codec' = 'json-gzip'
 AND qualification_object->>'sha256' ~ '^[a-f0-9]{64}$' AND qualification_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND qualification_object->>'key' = 'payloads/v1/json-gzip/' || (qualification_object->>'sha256')
 AND jsonb_typeof(qualification_object->'byteLength') = 'number' AND (qualification_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(qualification_object->'storedByteLength') = 'number' AND (qualification_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE championship_events ADD CONSTRAINT payload_e5e2ce224175_check CHECK (role_schedule_object IS NULL OR ((
 jsonb_typeof(role_schedule_object) = 'object'
 AND role_schedule_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (role_schedule_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND role_schedule_object->>'storage' = 'private-payload-v1' AND role_schedule_object->>'codec' = 'json-gzip'
 AND role_schedule_object->>'sha256' ~ '^[a-f0-9]{64}$' AND role_schedule_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND role_schedule_object->>'key' = 'payloads/v1/json-gzip/' || (role_schedule_object->>'sha256')
 AND jsonb_typeof(role_schedule_object->'byteLength') = 'number' AND (role_schedule_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(role_schedule_object->'storedByteLength') = 'number' AND (role_schedule_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE championship_entries ADD CONSTRAINT payload_335d41d6f874_check CHECK (build_object IS NULL OR ((
 jsonb_typeof(build_object) = 'object'
 AND build_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (build_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND build_object->>'storage' = 'private-payload-v1' AND build_object->>'codec' = 'json-gzip'
 AND build_object->>'sha256' ~ '^[a-f0-9]{64}$' AND build_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND build_object->>'key' = 'payloads/v1/json-gzip/' || (build_object->>'sha256')
 AND jsonb_typeof(build_object->'byteLength') = 'number' AND (build_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(build_object->'storedByteLength') = 'number' AND (build_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
--> statement-breakpoint
ALTER TABLE award_grants ADD CONSTRAINT payload_ed3048c2b885_check CHECK (evidence_object IS NULL OR ((
 jsonb_typeof(evidence_object) = 'object'
 AND evidence_object ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
 AND (evidence_object - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
 AND evidence_object->>'storage' = 'private-payload-v1' AND evidence_object->>'codec' = 'json-gzip'
 AND evidence_object->>'sha256' ~ '^[a-f0-9]{64}$' AND evidence_object->>'storedSha256' ~ '^[a-f0-9]{64}$'
 AND evidence_object->>'key' = 'payloads/v1/json-gzip/' || (evidence_object->>'sha256')
 AND jsonb_typeof(evidence_object->'byteLength') = 'number' AND (evidence_object->>'byteLength')::bigint >= 0
 AND jsonb_typeof(evidence_object->'storedByteLength') = 'number' AND (evidence_object->>'storedByteLength')::bigint >= 0
 ) IS TRUE));
