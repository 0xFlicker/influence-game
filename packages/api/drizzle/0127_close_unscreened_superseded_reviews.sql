-- Close obsolete legacy intake work, not a human approval or an AI verdict.
-- Retain current/published snapshots and explicit human review work.
UPDATE agent_moderation_reviews AS review
  SET status = 'superseded', version = review.version + 1
  FROM agent_content_revisions AS revision, agent_profiles AS profile
  WHERE review.content_revision_id = revision.id
    AND revision.agent_profile_id = profile.id
    AND profile.latest_content_revision_id IS NOT NULL
    AND revision.id IS DISTINCT FROM profile.latest_content_revision_id
    AND revision.id IS DISTINCT FROM profile.content_revision_id
    AND review.status = 'pending' AND review.route = 'ordinary'
    AND review.disposition = 'allowed' AND NOT review.held AND NOT review.flagged
    AND review.cycle = 1
    AND NOT EXISTS (SELECT 1 FROM agent_screenings WHERE content_revision_id = revision.id)
;
--> statement-breakpoint
-- Use a fresh statement snapshot after any concurrent claim holder commits.
DELETE FROM moderation_claims
WHERE review_id IN (SELECT id FROM agent_moderation_reviews WHERE status = 'superseded');
