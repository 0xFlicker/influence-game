CREATE FUNCTION immutable_visual_character_variant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Visual character variants are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_visual_character_variant BEFORE UPDATE ON visual_character_variants
FOR EACH ROW EXECUTE FUNCTION immutable_visual_character_variant();
