-- Preserve existing frozen inputs and their hashes. Input size is not a game
-- failure condition. Object-storage migration is the highest-priority follow-up.
ALTER TABLE game_retrospective_inputs DROP CONSTRAINT game_retrospective_inputs_size_check;
