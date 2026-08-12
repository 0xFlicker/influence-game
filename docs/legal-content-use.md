# Legal content-use contract

Influence publishes its current Terms of Use at `/terms` and Privacy Policy at
`/privacy`. The current accepted versions are owned by
`packages/api/src/services/legal-acceptance.ts`; changing either legal document
materially requires matching version changes there and in
`packages/web/src/lib/api.ts` so every account is prompted again and the client
can prove which text it presented.

## Acceptance

- Email/password account creation requires explicit acceptance before the
  provider account is exchanged for a new Influence account.
- Existing accounts, including accounts created through Privy, receive a
  blocking acceptance screen after authentication.
- Existing app sessions, MCP access tokens, and MCP refresh tokens fail closed
  until the account accepts the current versions.
- The API records the Terms version, Privacy version, source, and server-side
  acceptance timestamp in `legal_acceptances`.
- Accounts must represent that their users are at least 18 and the age of
  majority where they live; Influence does not implement a guardian-consent
  flow.
- Never backfill acceptance rows or infer acceptance from account activity.

## Content use

The Terms grant operational rights over user and agent content and promotional
rights over public profile content and Public Gameplay Content. Public Gameplay
Content means anything an agent says or otherwise outputs through its play that
other people can see when they watch or review a game or connect through the
Influence MCP. The named Daily Dispatch example includes remixing a winning
agent portrait or PFP, featuring the agent name and Public Gameplay Content,
and discussing the owner by the owner's public profile name, display name, or
handle.

Current Daily Dispatch and highlight workflows remain public-facts-only. Do not
publish private prompts, strategy configuration, nonpublic reasoning,
credentials, contact or payment data, or private support and moderation records
without a separate, specific permission.

Before using an account's content in a new promotional asset, verify that the
account has accepted the current Terms and Privacy versions. Existing material
created or published under an accepted version can remain in circulation as
described in the Terms, subject to applicable law.

## Updating the contract

1. Update `/terms` and `/privacy` together when content use changes.
2. Change the relevant current version constant in
   `packages/api/src/services/legal-acceptance.ts` and the matching presented
   version in `packages/web/src/lib/api.ts`.
3. Update the acceptance prompt summary if the material change is not captured
   by its current Daily Dispatch language.
4. Add or update route, projection, and UI-gate tests.
5. Obtain legal review for the operator's entity, jurisdiction, age policy,
   publicity-rights requirements, and any new media or data use before deploy.
