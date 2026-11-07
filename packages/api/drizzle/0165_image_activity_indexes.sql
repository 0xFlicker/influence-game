CREATE INDEX inference_reservations_owner_category_state ON inference_reservations(user_id, category, state);
CREATE INDEX character_reference_jobs_owner_status ON character_reference_jobs(user_id, status, created_at);
