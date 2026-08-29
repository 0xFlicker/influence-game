ALTER TABLE "authentication_credentials" DROP CONSTRAINT "authentication_credentials_provider_check";
--> statement-breakpoint
ALTER TABLE "authentication_credentials" ADD CONSTRAINT "authentication_credentials_provider_check" CHECK ("authentication_credentials"."provider" IN ('privy', 'clerk', 'farcaster'));
