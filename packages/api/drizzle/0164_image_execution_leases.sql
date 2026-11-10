ALTER TABLE inference_reservations ADD COLUMN execution_lease_until timestamptz;
ALTER TABLE inference_reservations ADD COLUMN execution_released_at timestamptz;
ALTER TABLE inference_reservations ADD COLUMN execution_release_reason text;
ALTER TABLE inference_reservations ADD COLUMN visual_operation_id text REFERENCES visual_render_operations(id);
ALTER TABLE inference_reservations ADD COLUMN avatar_request_id text REFERENCES avatar_generation_requests(id);

-- Associate retained journal identities once; runtime code uses these relationships.
UPDATE inference_reservations r SET visual_operation_id = o.id
FROM visual_render_operations o
WHERE r.category = 'image' AND r.user_id = o.user_id
AND (r.id = 'visual:' || o.id OR r.id ~ ('^visual:' || o.id || ':[0-9]+$'));
UPDATE inference_reservations r SET avatar_request_id = a.id
FROM avatar_generation_requests a WHERE r.category = 'image' AND r.user_id = a.user_id AND r.id = 'avatar:' || a.id;

-- Never infer a charge outcome from age. Only execution ownership expires.
-- The initial grace covers both bounded provider calls in an existing fallback chain.
UPDATE inference_reservations SET execution_lease_until = created_at + interval '15 minutes'
WHERE category = 'image' AND state IN ('reserved','dispatched','uncertain');
UPDATE inference_reservations SET execution_released_at = COALESCE(finished_at, now()),
execution_release_reason = CASE WHEN state = 'succeeded' THEN 'completed' ELSE 'failed' END
WHERE category = 'image' AND state IN ('succeeded','failed');
CREATE INDEX inference_image_execution_owner ON inference_reservations(user_id, execution_lease_until)
WHERE category = 'image' AND execution_released_at IS NULL;
