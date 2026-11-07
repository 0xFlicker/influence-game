ALTER TABLE agent_learning_review_applications ALTER COLUMN resulting_revision_id DROP NOT NULL, ALTER COLUMN applied_at DROP NOT NULL, ADD COLUMN submission_content_revision_id text;
