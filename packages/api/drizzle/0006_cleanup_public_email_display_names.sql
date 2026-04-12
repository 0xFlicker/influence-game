UPDATE "users"
SET "display_name" = CASE
  WHEN "wallet_address" IS NOT NULL AND "wallet_address" <> ''
    THEN substr("wallet_address", 1, 6) || '...' || right("wallet_address", 4)
  ELSE 'Player'
END
WHERE "display_name" IS NOT NULL
  AND "display_name" ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

