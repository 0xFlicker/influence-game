CREATE TABLE inference_plans (
 id text PRIMARY KEY, name text NOT NULL, policy jsonb NOT NULL, version integer NOT NULL DEFAULT 1
);
INSERT INTO inference_plans(id,name,policy) VALUES
 ('free','Free','{"text":100,"image":25,"renewal":"none","textBurst":5,"imageDaily":5,"textConcurrency":1,"imageConcurrency":1}'),
 ('faf','Friends and Family','{"text":100,"image":25,"renewal":"monthly","textBurst":5,"imageDaily":5,"textConcurrency":1,"imageConcurrency":1}');
CREATE TABLE inference_accounts (
 user_id text PRIMARY KEY REFERENCES users(id), plan_id text NOT NULL REFERENCES inference_plans(id) DEFAULT 'free',
 anchor timestamptz NOT NULL DEFAULT now(), period_start timestamptz NOT NULL DEFAULT now(),
 text_balance integer NOT NULL DEFAULT 100 CHECK(text_balance>=0), image_balance integer NOT NULL DEFAULT 25 CHECK(image_balance>=0),
 text_grant integer NOT NULL DEFAULT 0 CHECK(text_grant>=0), image_grant integer NOT NULL DEFAULT 0 CHECK(image_grant>=0),
 overrides jsonb NOT NULL DEFAULT '{}', paused boolean NOT NULL DEFAULT false, image_exempt boolean,
 version integer NOT NULL DEFAULT 1
);
INSERT INTO inference_accounts(user_id) SELECT id FROM users;
CREATE TABLE inference_reservations (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), category text NOT NULL CHECK(category IN ('text','image')),
 input_hash text NOT NULL, state text NOT NULL CHECK(state IN ('reserved','dispatched','succeeded','failed','uncertain')),
 bucket text NOT NULL CHECK(bucket IN ('balance','grant','exempt')), period_start timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX inference_reservations_user_time ON inference_reservations(user_id,created_at);
CREATE TABLE inference_actions (
 id text PRIMARY KEY, actor_id text NOT NULL REFERENCES users(id), user_id text REFERENCES users(id),
 request_hash text NOT NULL, reason text NOT NULL, command jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER inference_actions_immutable BEFORE UPDATE OR DELETE ON inference_actions FOR EACH ROW EXECUTE FUNCTION reject_agent_content_mutation();
