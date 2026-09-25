ALTER TABLE inference_actions ALTER COLUMN actor_id DROP NOT NULL;
INSERT INTO inference_actions(id, actor_id, user_id, request_hash, reason, command, result)
 SELECT 'initial:' || user_id, NULL, user_id, 'initial', 'Initial Free allowance', '{"kind":"initial_grant"}',
 jsonb_build_object('text',text_balance,'image',image_balance,'periodStart',period_start)
 FROM inference_accounts ON CONFLICT DO NOTHING;
