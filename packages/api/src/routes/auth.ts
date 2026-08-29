/**
 * Auth routes.
 *
 * Privy and managed-provider verification converge on one Influence session.
 * Account creation and linking remain separate, explicit mutations.
 */

import { createHmac } from "node:crypto";
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  verifyPrivyToken,
  getPrivyUser,
  requireAuth,
  verifySessionToken,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { isInviteRequired, redeemInviteCode } from "../lib/invite-codes.js";
import { extractBearerToken, validateGameMcpBearerToken } from "../game-mcp/auth.js";
import { projectAuthenticatedPublicIdentity } from "../services/authenticated-public-identity.js";
import {
  createClerkAuthenticationVerifier,
  createClerkSdkDependencies,
  createDefaultFarcasterAuthenticationVerifier,
  createPrivyAuthenticationVerifier,
  type ClerkAuthenticationProviderVerifier,
  type FarcasterAuthenticationProviderVerifier,
  type VerifiedProviderEvidence,
} from "../services/authentication-providers.js";
import {
  createManagedAccountAuthentication,
  exchangeExistingAccountAuthentication,
  linkManagedAuthenticationCredential,
  linkPrivyAuthenticationCredential,
  resolveAccountAuthentication,
  type AccountAuthenticationOutcome,
} from "../services/account-authentication.js";
import {
  issueInfluenceSession,
  projectLoginMethods,
} from "../services/session-issuance.js";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasCurrentLegalAcceptanceVersions,
  normalizeDeploymentSha,
  projectCurrentLegalAcceptance,
  recordCurrentLegalAcceptance,
} from "../services/legal-acceptance.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ManagedAuthMode = "disabled" | "existing-only" | "full";

interface AuthRouteDependencies {
  verifyPrivyToken?: typeof verifyPrivyToken;
  getPrivyUser?: typeof getPrivyUser;
  clerkVerifier?: ClerkAuthenticationProviderVerifier;
  farcasterVerifier?: FarcasterAuthenticationProviderVerifier;
  /** Hostname used for Quick Auth JWT domain verification (no protocol). */
  farcasterAuthDomain?: string;
  isInviteRequired?: typeof isInviteRequired;
  redeemInviteCode?: typeof redeemInviteCode;
  compatibilityBridgeEnabled?: boolean;
  managedAuthMode?: ManagedAuthMode;
  managedRateLimits?: {
    preVerification: number;
    postVerification: number;
    windowMs: number;
  };
  privyTimeoutMs?: number;
  now?: () => number;
}

export function createAuthRoutes(
  db: DrizzleDB,
  dependencies: AuthRouteDependencies = {},
) {
  const app = new Hono<AuthEnv>();
  const verifyPrivyAccessToken = dependencies.verifyPrivyToken ?? verifyPrivyToken;
  const loadPrivyUser = dependencies.getPrivyUser ?? getPrivyUser;
  const inviteIsRequired = dependencies.isInviteRequired ?? isInviteRequired;
  const redeemCode = dependencies.redeemInviteCode ?? redeemInviteCode;
  const compatibilityBridgeEnabled = dependencies.compatibilityBridgeEnabled
    ?? readPrivyCompatibilityBridgeEnabled();
  const managedAuthMode = dependencies.managedAuthMode ?? readManagedAuthMode();
  const clerkVerifier = dependencies.clerkVerifier
    ?? createConfiguredClerkVerifier(managedAuthMode);
  const privyVerifier = createPrivyAuthenticationVerifier({
    verifyAccessToken: verifyPrivyAccessToken,
    loadUser: loadPrivyUser,
    timeoutMs: dependencies.privyTimeoutMs,
  });
  const farcasterVerifier = dependencies.farcasterVerifier
    ?? createDefaultFarcasterAuthenticationVerifier();
  const managedRateLimiter = new AuthRateLimiter(
    dependencies.managedRateLimits ?? {
      preVerification: 30,
      postVerification: 20,
      windowMs: 60_000,
    },
    dependencies.now ?? Date.now,
  );

  // -------------------------------------------------------------------------
  // POST /api/auth/local-cli-session — exchange local producer MCP OAuth token
  // for a normal app session JWT. This is intentionally loopback-only so local
  // scripts can reuse the existing browser OAuth grant without making MCP
  // bearer tokens authenticate normal app routes directly.
  // -------------------------------------------------------------------------

  app.post("/api/auth/local-cli-session", async (c) => {
    if (!isLoopbackHost(c.req.header("host"), c.req.url)) {
      return c.json({ error: "Local CLI session exchange is loopback-only" }, 403);
    }

    const body = await parseJsonBody(c, "POST /api/auth/local-cli-session");
    const tokenFromBody = typeof body?.mcpToken === "string" ? body.mcpToken.trim() : "";
    const token = tokenFromBody || extractBearerToken(c.req.header("Authorization"));
    if (!token) {
      return c.json({ error: "mcpToken is required" }, 400);
    }

    const validation = await validateGameMcpBearerToken(db, token);
    if (!validation.ok) {
      return c.json({ error: "Invalid MCP token", reason: validation.reason }, validation.status);
    }
    if (validation.context.authProfile !== "producer") {
      return c.json({ error: "Producer MCP scope is required" }, 403);
    }

    const user = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, validation.context.userId)))[0];
    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    return c.json(await issueInfluenceSession(db, user));
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/login — exchange Privy token for session JWT
  // -------------------------------------------------------------------------

  app.post("/api/auth/login", async (c) => {
    const request = await readStrictTokenRequest(c, [
      "token",
      "intent",
      "inviteCode",
      "acceptTerms",
      "termsVersion",
      "privacyVersion",
      "deploymentSha",
    ]);
    if (!request.ok) return request.response;
    const { body } = request;
    if (body.intent !== "sign_in" && body.intent !== "create_account") {
      return c.json({ error: "Invalid request" }, 400);
    }
    const legalConsent = readCurrentLegalConsent(body);
    if (
      (
        body.intent === "sign_in"
        && (legalConsent !== "absent" || body.inviteCode !== undefined)
      )
      || (body.intent === "create_account" && legalConsent !== "accepted")
    ) {
      return staleLegalVersionResponse(c);
    }

    const verification = await privyVerifier.verify(body.token);
    if (verification.status === "invalid") {
      return c.json({ error: "Invalid Privy token" }, 401);
    }
    const subject = verification.status === "verified"
      ? verification.evidence.subject
      : verification.subject;
    if (subject === null) {
      return c.json({
        error: "Authentication provider profile is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }

    const provider = verification.status === "verified"
      ? verification.evidence.provider
      : verification.provider;
    const authentication = await resolveAccountAuthentication(db, {
      provider,
      subject,
      evidence: verification.status === "verified" ? verification.evidence : null,
      compatibilityBridgeEnabled,
      allowAccountCreation: body.intent === "create_account",
      checkInviteRequired: (tx) => inviteIsRequired(tx),
      redeemInvite: typeof body.inviteCode === "string"
        ? (tx, userId) => redeemCode(tx, body.inviteCode!, userId)
        : undefined,
      beforeCommit: body.intent === "create_account"
        ? (tx, userId) => recordCurrentLegalAcceptance(
          tx,
          userId,
          "account_creation",
          body.deploymentSha as string,
        )
        : undefined,
    });

    if (authentication.status === "profile_unavailable") {
      return c.json({
        error: "Authentication provider profile is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }
    if (authentication.status === "link_required") {
      return c.json({
        error: "This sign-in method must be linked to the existing account",
        code: "ACCOUNT_LINK_REQUIRED",
      }, 409);
    }
    if (authentication.status === "invite_required") {
      return c.json({
        error: "Invite code required",
        code: "INVITE_REQUIRED",
      }, 403);
    }
    if (authentication.status === "invalid_invite") {
      return c.json({
        error: "Invalid or already used invite code",
        code: "INVALID_INVITE_CODE",
      }, 403);
    }
    if (authentication.status === "support_blocked") {
      return c.json({
        error: "This account needs support before it can sign in",
        code: "ACCOUNT_SUPPORT_REQUIRED",
      }, 409);
    }
    if (
      authentication.status === "setup_incomplete"
      || authentication.status === "reauth_required"
    ) {
      if (authentication.status === "setup_incomplete") {
        return c.json({
          error: "This verified sign-in is not connected to a House account",
          code: "ACCOUNT_CREATION_REQUIRED",
        }, 409);
      }
      return c.json({
        error: "Authentication could not be completed",
        code: "ACCOUNT_SUPPORT_REQUIRED",
      }, 409);
    }
    if (body.intent === "create_account" && !authentication.created) {
      return accountAlreadyExistsResponse(c);
    }
    return c.json(await issueInfluenceSession(db, authentication.user));
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/farcaster/login — exchange Quick Auth JWT for session JWT
  // -------------------------------------------------------------------------

  app.post("/api/auth/farcaster/login", async (c) => {
    const body = await parseJsonBody(c, "POST /api/auth/farcaster/login");
    if (!body?.token || typeof body.token !== "string") {
      return c.json({ error: "token is required" }, 400);
    }

    const domain = resolveFarcasterAuthDomain(
      dependencies.farcasterAuthDomain,
      c.req.header("x-forwarded-host") ?? c.req.header("host"),
      c.req.url,
    );
    if (!domain) {
      return c.json({
        error: "Farcaster auth domain is not configured",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }

    const verification = await farcasterVerifier.verify(body.token, domain);
    if (verification.status === "invalid") {
      return c.json({ error: "Invalid Farcaster token" }, 401);
    }
    if (verification.status === "profile_unavailable") {
      return c.json({
        error: "Authentication provider profile is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }

    const authentication = await resolveAccountAuthentication(db, {
      provider: verification.evidence.provider,
      subject: verification.evidence.subject,
      evidence: verification.evidence,
      compatibilityBridgeEnabled: true,
      checkInviteRequired: (tx) => inviteIsRequired(tx),
      redeemInvite: typeof body.inviteCode === "string"
        ? (tx, userId) => redeemCode(tx, body.inviteCode as string, userId)
        : undefined,
    });

    if (authentication.status === "profile_unavailable") {
      return c.json({
        error: "Authentication provider profile is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }
    if (authentication.status === "link_required") {
      return c.json({
        error: "This sign-in method must be linked to the existing account",
        code: "ACCOUNT_LINK_REQUIRED",
      }, 409);
    }
    if (authentication.status === "invite_required") {
      return c.json({
        error: "Invite code required",
        code: "INVITE_REQUIRED",
      }, 403);
    }
    if (authentication.status === "invalid_invite") {
      return c.json({
        error: "Invalid or already used invite code",
        code: "INVALID_INVITE_CODE",
      }, 403);
    }
    if (
      authentication.status === "support_blocked"
      || authentication.status === "setup_incomplete"
      || authentication.status === "reauth_required"
    ) {
      return c.json({
        error: "This account needs support before it can sign in",
        code: "ACCOUNT_SUPPORT_REQUIRED",
      }, 409);
    }
    return c.json(await issueInfluenceSession(db, authentication.user));
  });

  app.post("/api/auth/managed/exchange", async (c) => {
    const availability = managedRouteAvailability(c, managedAuthMode, clerkVerifier);
    if (availability) return availability;
    const request = await readStrictTokenRequest(c, ["token"]);
    if (!request.ok) return request.response;
    const verification = await verifyManagedEvidence(
      c,
      clerkVerifier!,
      managedRateLimiter,
      request.body.token,
    );
    if (!verification.ok) return verification.response;

    return managedOutcomeResponse(
      c,
      db,
      await exchangeExistingAccountAuthentication(db, verification.evidence),
    );
  });

  app.post("/api/auth/managed/create", async (c) => {
    const availability = managedMutationAvailability(
      c,
      managedAuthMode,
      clerkVerifier,
    );
    if (availability) return availability;
    const request = await readStrictTokenRequest(
      c,
      [
        "token",
        "inviteCode",
        "acceptTerms",
        "termsVersion",
        "privacyVersion",
        "deploymentSha",
      ],
      "acceptTerms",
    );
    if (!request.ok) return request.response;
    if (readCurrentLegalConsent(request.body) !== "accepted") {
      return staleLegalVersionResponse(c);
    }
    const verification = await verifyManagedEvidence(
      c,
      clerkVerifier!,
      managedRateLimiter,
      request.body.token,
    );
    if (!verification.ok) return verification.response;

    const outcome = await createManagedAccountAuthentication(
      db,
      verification.evidence,
      {
        checkInviteRequired: (tx) => inviteIsRequired(tx),
        redeemInvite: typeof request.body.inviteCode === "string"
          ? (tx, userId) => redeemCode(
            tx,
            request.body.inviteCode!,
            userId,
          )
          : undefined,
        beforeCommit: (tx, userId) => recordCurrentLegalAcceptance(
          tx,
          userId,
          "account_creation",
          request.body.deploymentSha!,
        ),
      },
    );
    if (outcome.status === "authenticated" && !outcome.created) {
      return accountAlreadyExistsResponse(c);
    }
    if (outcome.status === "invite_required") {
      return c.json({
        error: "Invite code required",
        code: "INVITE_REQUIRED",
      }, 403);
    }
    if (outcome.status === "invalid_invite") {
      return c.json({
        error: "Invalid or already used invite code",
        code: "INVALID_INVITE_CODE",
      }, 403);
    }
    return managedOutcomeResponse(c, db, outcome);
  });

  app.post("/api/auth/managed/link", async (c) => {
    const availability = managedMutationAvailability(
      c,
      managedAuthMode,
      clerkVerifier,
    );
    if (availability) return availability;
    const request = await readStrictTokenRequest(
      c,
      ["token", "privyToken", "confirm"],
      "confirm",
    );
    if (!request.ok) return request.response;
    const influenceSession = await readInfluenceSession(c, db);
    if (influenceSession.status === "legal_acceptance_required") {
      return legalAcceptanceRequiredResponse(c);
    }
    const influenceUserId = influenceSession.status === "authenticated"
      ? influenceSession.userId
      : null;
    const verification = await verifyManagedEvidence(
      c,
      clerkVerifier!,
      managedRateLimiter,
      request.body.token,
      (evidence) => influenceUserId ?? evidence.subject,
    );
    if (!verification.ok) return verification.response;

    let ownerEvidence;
    if (request.body.privyToken) {
      const ownerVerification = await privyVerifier.verify(request.body.privyToken);
      if (ownerVerification.status === "profile_unavailable") {
        return c.json({
          error: "Authentication provider is temporarily unavailable",
          code: "AUTH_PROVIDER_UNAVAILABLE",
        }, 503);
      }
      if (ownerVerification.status !== "verified") {
        return c.json({
          error: "Wallet reauthentication is required",
          code: "WALLET_REAUTH_REQUIRED",
        }, 401);
      }
      ownerEvidence = ownerVerification.evidence;
    }

    return managedOutcomeResponse(
      c,
      db,
      await linkManagedAuthenticationCredential(db, {
        userId: influenceUserId ?? undefined,
        evidence: verification.evidence,
        privyOwnerEvidence: ownerEvidence,
      }),
    );
  });

  app.post("/api/auth/privy/link", async (c) => {
    const availability = managedMutationAvailability(
      c,
      managedAuthMode,
      clerkVerifier,
    );
    if (availability) return availability;
    const influenceSession = await readInfluenceSession(c, db);
    if (influenceSession.status === "legal_acceptance_required") {
      return legalAcceptanceRequiredResponse(c);
    }
    if (influenceSession.status !== "authenticated") {
      return c.json({
        error: "Authentication required",
        code: "INFLUENCE_AUTH_REQUIRED",
      }, 401);
    }
    const influenceUserId = influenceSession.userId;
    const request = await readStrictTokenRequest(
      c,
      ["token", "confirm"],
      "confirm",
    );
    if (!request.ok) return request.response;
    const verification = await privyVerifier.verify(request.body.token);
    if (verification.status === "profile_unavailable") {
      return c.json({
        error: "Authentication provider is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    }
    if (verification.status !== "verified") {
      return c.json({
        error: "Privy reauthentication is required",
        code: "PRIVY_REAUTH_REQUIRED",
      }, 401);
    }
    return managedOutcomeResponse(
      c,
      db,
      await linkPrivyAuthenticationCredential(db, {
        userId: influenceUserId,
        evidence: verification.evidence,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/check-invite — check if invite codes are required
  // -------------------------------------------------------------------------

  app.get("/api/auth/invite-required", async (c) => {
    const required = await inviteIsRequired(db);
    return c.json({ required });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me — get current authenticated user
  // -------------------------------------------------------------------------

  app.get("/api/auth/me", requireAuth(db, {
    allowPendingLegalAcceptance: true,
  }), async (c) => {
    const user = c.get("authContextUser");
    const roles = c.get("userRoles") ?? [];
    const permissions = c.get("userPermissions") ?? [];
    const [loginMethods, legal] = await Promise.all([
      projectLoginMethods(db, user.id),
      projectCurrentLegalAcceptance(db, user.id),
    ]);

    const isAdmin =
      roles.includes("sysop") ||
      roles.includes("admin") ||
      permissions.includes("view_admin");

    return c.json({
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      ...projectAuthenticatedPublicIdentity(user),
      isAdmin,
      roles,
      permissions,
      loginMethods,
      legal,
    });
  });

  app.post("/api/auth/legal-acceptance", requireAuth(db, {
    allowPendingLegalAcceptance: true,
  }), async (c) => {
    const body = await parseJsonBody(c, "POST /api/auth/legal-acceptance");
    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || Object.keys(body).length !== 4
      || body.acceptTerms !== true
      || readCurrentLegalConsent(body) !== "accepted"
    ) {
      return staleLegalVersionResponse(c);
    }
    const user = c.get("authContextUser");
    await recordCurrentLegalAcceptance(
      db,
      user.id,
      "existing_account",
      body.deploymentSha as string,
    );
    return c.json(await issueInfluenceSession(db, user));
  });

  return app;
}

export function readManagedAuthMode(
  value = process.env.MANAGED_AUTH_MODE,
): ManagedAuthMode {
  const mode = value?.trim() || "disabled";
  if (mode === "disabled" || mode === "existing-only" || mode === "full") {
    return mode;
  }
  throw new Error(
    'MANAGED_AUTH_MODE must be one of "disabled", "existing-only", or "full"',
  );
}

function createConfiguredClerkVerifier(
  mode: ManagedAuthMode,
): ClerkAuthenticationProviderVerifier | undefined {
  if (mode === "disabled") return undefined;
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  const jwtKey = process.env.CLERK_JWT_KEY?.trim();
  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES
    ?.split(",")
    .map((party) => party.trim())
    .filter(Boolean);
  if (!secretKey || !publishableKey || !jwtKey || !authorizedParties?.length) {
    return undefined;
  }
  return createClerkAuthenticationVerifier(createClerkSdkDependencies({
    secretKey,
    publishableKey,
    jwtKey,
    authorizedParties,
  }));
}

async function readInfluenceSession(
  c: Context,
  db: DrizzleDB,
): Promise<
  | { status: "absent" }
  | { status: "legal_acceptance_required" }
  | { status: "authenticated"; userId: string }
> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) return { status: "absent" };
  const session = await verifySessionToken(token);
  if (!session) return { status: "absent" };
  if (hasCurrentLegalAcceptanceVersions(session.legalAcceptance)) {
    return { status: "authenticated", userId: session.userId };
  }
  const legal = await projectCurrentLegalAcceptance(db, session.userId);
  return legal.accepted
    ? { status: "authenticated", userId: session.userId }
    : { status: "legal_acceptance_required" };
}

type StrictAuthBody = {
  token: string;
  intent?: "sign_in" | "create_account";
  inviteCode?: string;
  privyToken?: string;
  confirm?: true;
  acceptTerms?: true;
  termsVersion?: string;
  privacyVersion?: string;
  deploymentSha?: string;
};

async function readStrictTokenRequest(
  c: Context,
  allowedKeys: Array<keyof StrictAuthBody>,
  requiredTrueKey?: "confirm" | "acceptTerms",
): Promise<
  | { ok: true; body: StrictAuthBody }
  | { ok: false; response: Response }
> {
  const declaredLength = Number(c.req.header("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    return { ok: false, response: c.json({ error: "Request is too large" }, 413) };
  }
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return { ok: false, response: c.json({ error: "Invalid request" }, 400) };
  }
  if (new TextEncoder().encode(text).byteLength > 16_384) {
    return { ok: false, response: c.json({ error: "Request is too large" }, 413) };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, response: c.json({ error: "Invalid request" }, 400) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: c.json({ error: "Invalid request" }, 400) };
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.includes(key as keyof StrictAuthBody))) {
    return { ok: false, response: c.json({ error: "Invalid request" }, 400) };
  }
  if (
    typeof body.token !== "string"
    || body.token.length === 0
    || body.token.length > 8_192
    || (
      body.intent !== undefined
      && body.intent !== "sign_in"
      && body.intent !== "create_account"
    )
    || (
      body.inviteCode !== undefined
      && (
        typeof body.inviteCode !== "string"
        || body.inviteCode.length === 0
        || body.inviteCode.length > 256
      )
    )
    || (
      body.privyToken !== undefined
      && (
        typeof body.privyToken !== "string"
        || body.privyToken.length === 0
        || body.privyToken.length > 8_192
      )
    )
    || (requiredTrueKey && body[requiredTrueKey] !== true)
  ) {
    return { ok: false, response: c.json({ error: "Invalid request" }, 400) };
  }
  return {
    ok: true,
    body: {
      token: body.token,
      intent: body.intent as "sign_in" | "create_account" | undefined,
      inviteCode: body.inviteCode as string | undefined,
      privyToken: body.privyToken as string | undefined,
      confirm: body.confirm as true | undefined,
      acceptTerms: body.acceptTerms as true | undefined,
      termsVersion: body.termsVersion as string | undefined,
      privacyVersion: body.privacyVersion as string | undefined,
      deploymentSha: body.deploymentSha as string | undefined,
    },
  };
}

function readCurrentLegalConsent(
  body: {
    acceptTerms?: unknown;
    termsVersion?: unknown;
    privacyVersion?: unknown;
    deploymentSha?: unknown;
  },
): "accepted" | "absent" | "invalid" {
  const hasLegalFields = body.acceptTerms !== undefined
    || body.termsVersion !== undefined
    || body.privacyVersion !== undefined
    || body.deploymentSha !== undefined;
  if (!hasLegalFields) return "absent";
  return body.acceptTerms === true
    && body.termsVersion === CURRENT_TERMS_VERSION
    && body.privacyVersion === CURRENT_PRIVACY_VERSION
    && normalizeDeploymentSha(body.deploymentSha) !== null
    ? "accepted"
    : "invalid";
}

function staleLegalVersionResponse(c: Context): Response {
  return c.json({
    error: "The current Terms and Privacy Policy versions must be accepted",
    code: "LEGAL_VERSION_MISMATCH",
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  }, 400);
}

function accountAlreadyExistsResponse(c: Context): Response {
  return c.json({
    error: "This sign-in is already connected to a House account",
    code: "ACCOUNT_ALREADY_EXISTS",
  }, 409);
}

function legalAcceptanceRequiredResponse(c: Context): Response {
  return c.json({
    error: "Current Terms and Privacy Policy acceptance is required",
    code: "LEGAL_ACCEPTANCE_REQUIRED",
  }, 403);
}

function managedRouteAvailability(
  c: Context,
  mode: ManagedAuthMode,
  verifier: ClerkAuthenticationProviderVerifier | undefined,
): Response | null {
  if (mode === "disabled") {
    return c.json({ error: "Not found" }, 404);
  }
  if (!verifier) {
    return c.json({
      error: "Managed authentication is unavailable",
      code: "MANAGED_AUTH_UNAVAILABLE",
    }, 503);
  }
  return null;
}

function managedMutationAvailability(
  c: Context,
  mode: ManagedAuthMode,
  verifier: ClerkAuthenticationProviderVerifier | undefined,
): Response | null {
  const routeAvailability = managedRouteAvailability(c, mode, verifier);
  if (routeAvailability) return routeAvailability;
  if (mode !== "full") {
    return c.json({
      error: "Managed account changes are unavailable",
      code: "MANAGED_AUTH_MUTATION_DISABLED",
    }, 403);
  }
  return null;
}

function managedVerificationFailure(
  c: Context,
  verification: Exclude<
    Awaited<ReturnType<ClerkAuthenticationProviderVerifier["verify"]>>,
    { status: "verified" }
  >,
): Response {
  switch (verification.status) {
    case "profile_unavailable":
      return c.json({
        error: "Authentication provider is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    case "setup_incomplete":
      return c.json({
        error: "Authentication setup is incomplete",
        code: "MANAGED_AUTH_SETUP_INCOMPLETE",
      }, 409);
    case "locked":
      return c.json({
        error: "Authentication is unavailable",
        code: "MANAGED_AUTH_LOCKED",
      }, 423);
    case "invalid":
      return c.json({
        error: "Authentication failed",
        code: "MANAGED_AUTH_FAILED",
      }, 401);
  }
}

async function verifyManagedEvidence(
  c: Context,
  verifier: ClerkAuthenticationProviderVerifier,
  limiter: AuthRateLimiter,
  token: string,
  postVerificationKey: (evidence: VerifiedProviderEvidence) => string =
    (evidence) => evidence.subject,
): Promise<
  | { ok: true; evidence: VerifiedProviderEvidence }
  | { ok: false; response: Response }
> {
  const limited = enforcePreVerificationLimit(c, limiter);
  if (limited) return { ok: false, response: limited };

  const verification = await verifier.verify(token);
  if (verification.status !== "verified") {
    return {
      ok: false,
      response: managedVerificationFailure(c, verification),
    };
  }

  const postLimited = enforcePostVerificationLimit(
    c,
    limiter,
    postVerificationKey(verification.evidence),
  );
  return postLimited
    ? { ok: false, response: postLimited }
    : { ok: true, evidence: verification.evidence };
}

async function managedOutcomeResponse(
  c: Context,
  db: DrizzleDB,
  outcome: AccountAuthenticationOutcome,
): Promise<Response> {
  switch (outcome.status) {
    case "authenticated":
      return c.json(await issueInfluenceSession(db, outcome.user));
    case "link_required":
      return c.json({
        error: "Explicit account linking confirmation is required",
        code: "ACCOUNT_LINK_CONFIRMATION_REQUIRED",
      }, 409);
    case "setup_incomplete":
      return c.json({
        error: "This verified sign-in is not connected to a House account",
        code: "ACCOUNT_CREATION_REQUIRED",
      }, 409);
    case "reauth_required":
      return c.json({
        error: "Wallet reauthentication is required",
        code: "WALLET_REAUTH_REQUIRED",
      }, 401);
    case "profile_unavailable":
      return c.json({
        error: "Authentication provider is temporarily unavailable",
        code: "AUTH_PROVIDER_UNAVAILABLE",
      }, 503);
    case "support_blocked":
      return c.json({
        error: "This account needs support before it can sign in",
        code: "ACCOUNT_SUPPORT_REQUIRED",
      }, 409);
    case "invite_required":
    case "invalid_invite":
      return c.json({
        error: "Account setup is unavailable",
        code: "ACCOUNT_SETUP_UNAVAILABLE",
      }, 403);
  }
}

class AuthRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private static readonly MAX_BUCKETS = 10_000;

  constructor(
    private readonly limits: {
      preVerification: number;
      postVerification: number;
      windowMs: number;
    },
    private readonly now: () => number,
  ) {}

  take(kind: "pre" | "post", key: string): number | null {
    const now = this.now();
    const bucketKey = `${kind}:${key}`;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      this.makeRoom(now);
      bucket = { count: 0, resetAt: now + this.limits.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    const limit = kind === "pre"
      ? this.limits.preVerification
      : this.limits.postVerification;
    if (bucket.count >= limit) {
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    }
    bucket.count += 1;
    return null;
  }

  private makeRoom(now: number): void {
    if (this.buckets.size < AuthRateLimiter.MAX_BUCKETS) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= AuthRateLimiter.MAX_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
    }
  }
}

function enforcePreVerificationLimit(
  c: Context,
  limiter: AuthRateLimiter,
): Response | null {
  const source = c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return rateLimitResponse(c, limiter.take("pre", privacyBucket(source)));
}

function enforcePostVerificationLimit(
  c: Context,
  limiter: AuthRateLimiter,
  subjectOrUserId: string,
): Response | null {
  return rateLimitResponse(
    c,
    limiter.take("post", privacyBucket(subjectOrUserId)),
  );
}

function privacyBucket(value: string): string {
  return createHmac(
    "sha256",
    process.env.JWT_SECRET ?? "managed-auth-rate-limit",
  ).update(value).digest("base64url").slice(0, 24);
}

function rateLimitResponse(
  c: Context,
  retryAfter: number | null,
): Response | null {
  if (retryAfter === null) return null;
  c.header("Retry-After", String(retryAfter));
  return c.json({
    error: "Too many authentication attempts",
    code: "AUTH_RATE_LIMITED",
  }, 429);
}

/**
 * The bridge is intentionally on by default during inventory rollout. After a
 * zero final delta, set PRIVY_COMPATIBILITY_BRIDGE_ENABLED=false so an
 * unbound legacy row cannot authenticate through subject/wallet inference.
 */
export function readPrivyCompatibilityBridgeEnabled(
  value = process.env.PRIVY_COMPATIBILITY_BRIDGE_ENABLED,
): boolean {
  if (value === undefined || value.trim() === "") return true;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    'PRIVY_COMPATIBILITY_BRIDGE_ENABLED must be "true" or "false"',
  );
}

function isLoopbackHost(hostHeader: string | undefined, requestUrl?: string): boolean {
  const host = hostFromHeader(hostHeader) ?? hostFromUrl(requestUrl);
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

function hostFromHeader(hostHeader: string | undefined): string | undefined {
  const host = hostHeader?.trim().toLowerCase();
  if (!host) return undefined;
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    return closingBracket === -1 ? host : host.slice(0, closingBracket + 1);
  }
  return host.split(":")[0];
}

function hostFromUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined;
  try {
    return new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Quick Auth JWT `domain` must match the Mini App host exactly.
 * Prefer WEB_BASE_URL / explicit override; fall back to request Host.
 */
export function resolveFarcasterAuthDomain(
  explicit: string | undefined,
  hostHeader: string | undefined,
  requestUrl?: string,
): string | null {
  const fromExplicit = explicit?.trim().toLowerCase();
  if (fromExplicit) {
    return stripPort(fromExplicit.replace(/^https?:\/\//, "").split("/")[0] ?? "");
  }
  const fromEnv = process.env.WEB_BASE_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).hostname.toLowerCase();
    } catch {
      // fall through
    }
  }
  return hostFromHeader(hostHeader) ?? hostFromUrl(requestUrl) ?? null;
}

function stripPort(host: string): string | null {
  if (!host) return null;
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    return closingBracket === -1 ? host : host.slice(0, closingBracket + 1);
  }
  return host.split(":")[0] || null;
}
