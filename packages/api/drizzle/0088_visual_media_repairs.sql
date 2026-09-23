CREATE TABLE visual_repair_jobs (
 id text PRIMARY KEY, game_id text NOT NULL REFERENCES games(id), scene_id text NOT NULL REFERENCES visual_scenes(id), version integer NOT NULL,
 operator_id text NOT NULL, mode text NOT NULL CHECK (mode IN ('regenerate','verify','continue')), plan jsonb NOT NULL, render_context jsonb NOT NULL,
 candidate_artifact_id text, source_image_id text, reuse_prefix text, status text NOT NULL CHECK (status IN ('queued','rendering','verifying','ready','failed','needs_reconciliation')),
 step text NOT NULL DEFAULT 'queued', failure text, owner text, lease_until text, fallback_used boolean NOT NULL DEFAULT false,
 created_at text NOT NULL, started_at text, finished_at text, UNIQUE(scene_id,version)
);
CREATE UNIQUE INDEX visual_repair_active_unique ON visual_repair_jobs(scene_id) WHERE status IN ('queued','rendering','verifying');
CREATE TABLE visual_media_versions (
 id text PRIMARY KEY, game_id text NOT NULL REFERENCES games(id), scene_id text NOT NULL REFERENCES visual_scenes(id),
 job_id text REFERENCES visual_repair_jobs(id), version integer NOT NULL, plan jsonb NOT NULL,
 image_artifact_id text NOT NULL REFERENCES visual_artifacts(id), annotated_artifact_id text NOT NULL REFERENCES visual_artifacts(id),
 localization jsonb NOT NULL, verification_version text NOT NULL, created_at text NOT NULL, UNIQUE(scene_id,version)
);
CREATE TABLE visual_media_publications (
 id text PRIMARY KEY, game_id text NOT NULL REFERENCES games(id), scene_id text NOT NULL REFERENCES visual_scenes(id),
 version_id text NOT NULL REFERENCES visual_media_versions(id), revision integer NOT NULL, operator_id text NOT NULL, created_at text NOT NULL, UNIQUE(scene_id,revision)
);
CREATE TABLE visual_media_requests (
 id text PRIMARY KEY, game_id text NOT NULL REFERENCES games(id), operator_id text NOT NULL, request_id text NOT NULL, input_hash text NOT NULL,
 input jsonb NOT NULL, receipt jsonb NOT NULL, created_at text NOT NULL, UNIQUE(game_id,operator_id,request_id)
);
CREATE FUNCTION immutable_visual_media_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Visual media evidence is immutable'; END $$;
CREATE TRIGGER immutable_visual_media_version BEFORE UPDATE OR DELETE ON visual_media_versions FOR EACH ROW EXECUTE FUNCTION immutable_visual_media_record();
CREATE TRIGGER immutable_visual_media_publication BEFORE UPDATE OR DELETE ON visual_media_publications FOR EACH ROW EXECUTE FUNCTION immutable_visual_media_record();
CREATE TRIGGER immutable_visual_media_request BEFORE UPDATE OR DELETE ON visual_media_requests FOR EACH ROW EXECUTE FUNCTION immutable_visual_media_record();

ALTER TABLE visual_render_operations ADD COLUMN repair_job_id text REFERENCES visual_repair_jobs(id);

CREATE FUNCTION immutable_visual_repair_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.game_id,NEW.scene_id,NEW.version,NEW.operator_id,NEW.mode,NEW.plan,NEW.render_context,NEW.source_image_id,NEW.reuse_prefix,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.game_id,OLD.scene_id,OLD.version,OLD.operator_id,OLD.mode,OLD.plan,OLD.render_context,OLD.source_image_id,OLD.reuse_prefix,OLD.created_at)
 THEN RAISE EXCEPTION 'Visual repair inputs are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_visual_repair_inputs BEFORE UPDATE ON visual_repair_jobs FOR EACH ROW EXECUTE FUNCTION immutable_visual_repair_inputs();
CREATE INDEX visual_repair_queue ON visual_repair_jobs(status,created_at);
