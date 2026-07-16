ALTER TABLE "game_completion_settlement_attempts" ADD COLUMN "request_attempt_id" text;--> statement-breakpoint
ALTER TABLE "game_completion_settlement_attempts" ADD CONSTRAINT "game_completion_settlement_attempts_request_attempt_fk" FOREIGN KEY ("request_attempt_id") REFERENCES "public"."game_completion_settlement_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_completion_settlement_attempts_request_attempt_id_unique" ON "game_completion_settlement_attempts" USING btree ("request_attempt_id");--> statement-breakpoint
CREATE FUNCTION "prevent_game_completion_settlement_envelope_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF ROW(
		OLD."id",
		OLD."game_id",
		OLD."owner_epoch",
		OLD."final_event_sequence",
		OLD."final_event_hash",
		OLD."payload_schema_version",
		OLD."payload",
		OLD."payload_hash",
		OLD."captured_at"
	) IS DISTINCT FROM ROW(
		NEW."id",
		NEW."game_id",
		NEW."owner_epoch",
		NEW."final_event_sequence",
		NEW."final_event_hash",
		NEW."payload_schema_version",
		NEW."payload",
		NEW."payload_hash",
		NEW."captured_at"
	) THEN
		RAISE EXCEPTION 'completion settlement envelope fields are immutable'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "game_completion_settlements_envelope_immutable"
BEFORE UPDATE ON "game_completion_settlements"
FOR EACH ROW EXECUTE FUNCTION "prevent_game_completion_settlement_envelope_update"();
