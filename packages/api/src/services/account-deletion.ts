import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";

/** Close the account without archiving characters or changing accepted entries. */
export async function deleteAccount(db: DrizzleDB, userId: string) {
  return db.transaction(async tx => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).for("no key update");
    if (!user) throw new Error("Account not found");
    if (user.deletedAt) return { deletedAt: user.deletedAt };
    const [service] = await tx.select().from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, userId));
    if (service) throw new Error("Service accounts cannot use account deletion");
    const deletedAt = new Date().toISOString();
    const credentials = await tx.select().from(schema.authenticationCredentials).where(eq(schema.authenticationCredentials.userId, userId));
    for (const credential of credentials) {
      // Farcaster is an independent identity, not a House-managed account.
      if (credential.provider === "farcaster") continue;
      await tx.insert(schema.accountDeletionTasks).values({ userId, provider: credential.provider, target: credential.providerSubject });
    }
    // Always enqueue: historical browser tracking can exist even when the
    // account's current analytics preference is disabled.
    await tx.insert(schema.accountDeletionTasks).values({ userId, provider: "posthog", target: user.publicId });
    await tx.update(schema.users).set({ deletedAt, email: null, walletAddress: null, displayName: null, handle: null })
      .where(eq(schema.users.id, userId));

    await tx.delete(schema.authenticationCredentials).where(eq(schema.authenticationCredentials.userId, userId));
    await tx.delete(schema.verifiedEmailClaims).where(eq(schema.verifiedEmailClaims.userId, userId));
    await tx.delete(schema.mcpOauthAuthorizationCodes).where(eq(schema.mcpOauthAuthorizationCodes.userId, userId));
    await tx.delete(schema.mcpOauthAccessTokens).where(eq(schema.mcpOauthAccessTokens.userId, userId));
    await tx.delete(schema.mcpOauthRefreshTokens).where(eq(schema.mcpOauthRefreshTokens.userId, userId));
    await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await tx.delete(schema.userAnalyticsPreferences).where(eq(schema.userAnalyticsPreferences.userId, userId));
    await tx.delete(schema.userCampaignAttribution).where(eq(schema.userCampaignAttribution.userId, userId));
    // Keep authoritative conversion totals and campaign labels. Remove the
    // identifiers used for advertising delivery, and stop all future delivery.
    await tx.execute(sql`UPDATE campaign_conversion_events SET
      public_id = '', client_user_agent = NULL, mcp_client_id = NULL,
      attribution = attribution - ARRAY['click_id','click_id_param','gclid','fbclid','msclkid','ttclid','twclid','dclid','gbraid','wbraid'],
      posthog_status = 'suppressed', platform_status = 'suppressed', google_status = 'suppressed',
      tiktok_status = 'suppressed', x_status = 'suppressed', google_ad_user_data_granted = false,
      google_request_id = NULL, last_error = NULL, google_last_error = NULL, tiktok_last_error = NULL, x_last_error = NULL
      WHERE user_id = ${userId}`);
    await tx.delete(schema.discordVerificationAttempts).where(eq(schema.discordVerificationAttempts.userId, userId));
    await tx.delete(schema.discordConnectionAudit).where(eq(schema.discordConnectionAudit.userId, userId));
    await tx.update(schema.discordConnections).set({ disconnecting: true, username: "", revision: sql`revision + 1`,
      nextAttemptAt: sql`now()`, attempts: 0, lastError: null }).where(eq(schema.discordConnections.userId, userId));
    await tx.delete(schema.inviteCodes).where(and(eq(schema.inviteCodes.ownerId, userId), isNull(schema.inviteCodes.usedById)));
    await tx.delete(schema.agentEntryIntents).where(eq(schema.agentEntryIntents.userId, userId));
    // Attribution is not game authority. Do not touch accepted events, character
    // snapshots, ratings, frozen artwork, queues, seats, or championship entries.
    await tx.update(schema.competitionReceipts).set({ ownerDisplayNameSnapshot: null }).where(eq(schema.competitionReceipts.ownerId, userId));
    await tx.update(schema.seasonHonors).set({ agentChampionOwnerNameSnapshot: null }).where(eq(schema.seasonHonors.agentChampionOwnerId, userId));
    await tx.update(schema.seasonHonors).set({ architectChampionOwnerNameSnapshot: null }).where(eq(schema.seasonHonors.architectChampionOwnerId, userId));
    return { deletedAt };
  });
}
