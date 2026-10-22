ALTER TABLE agent_screening_attempts DROP CONSTRAINT agent_screening_attempt_stage_check;
ALTER TABLE agent_screening_attempts ADD CONSTRAINT agent_screening_attempt_stage_check CHECK (stage IN ('moderation','luna','luna_collusion'));
