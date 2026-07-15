-- Global saved-profile name uniqueness is intentionally deferred. Keep this
-- migration slot non-blocking so environments that failed the original
-- preflight can advance without renaming or deleting existing identities.
SELECT 1;
