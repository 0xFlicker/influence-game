-- Account deletion is the one operation that can release a claimed handle.
CREATE OR REPLACE FUNCTION prevent_users_claimed_handle_clear() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.handle IS NOT NULL AND NEW.handle IS NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'a claimed users.handle cannot return to null'
      USING ERRCODE = '23514', CONSTRAINT = 'users_handle_claimed_not_null';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Fence requests that passed authentication before deletion committed. Locks
-- serialize with deletion while existing seats and scheduler writes stay valid.
-- Take the same lock as account bookkeeping upfront: two concurrent profile
-- creations must not both acquire SHARE and then deadlock while upgrading it.
CREATE FUNCTION require_active_account_for_identity_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_deleted_at text;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT deleted_at INTO account_deleted_at FROM users WHERE id = NEW.user_id FOR NO KEY UPDATE;
  IF account_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account has been deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON authentication_credentials FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON verified_email_claims FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON mcp_oauth_authorization_codes FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON mcp_oauth_access_tokens FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON mcp_oauth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON agent_profiles FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON discord_connections FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON discord_verification_attempts FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON user_analytics_preferences FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON user_campaign_attribution FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON agent_editor_drafts FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT OR UPDATE ON agent_entry_intents FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
CREATE TRIGGER account_active BEFORE INSERT ON free_game_queue FOR EACH ROW EXECUTE FUNCTION require_active_account_for_identity_write();
