CREATE INDEX "provider_call_attempts_game_catalog_idx" ON "provider_call_attempts" USING btree ("game_id","catalog_id");
