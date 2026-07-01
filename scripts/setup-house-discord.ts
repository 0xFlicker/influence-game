#!/usr/bin/env bun
/**
 * Idempotently configures The House Discord as a low-trust support/community
 * server for Influence.
 *
 * Usage:
 *   doppler run --project social-strategy-agent --config dev -- \
 *     bun scripts/setup-house-discord.ts
 *
 * Required env:
 *   DISCORD_HOUSE_BOT_TOKEN
 *   DISCORD_HOUSE_GUILD_ID
 */

const API_BASE = "https://discord.com/api/v10";
const AUDIT_REASON = encodeURIComponent(
  "Configure The House support/community server",
);

const token = requireEnv("DISCORD_HOUSE_BOT_TOKEN");
const guildId = requireEnv("DISCORD_HOUSE_GUILD_ID");

const ChannelType = {
  GuildText: 0,
  GuildCategory: 4,
  GuildForum: 15,
} as const;

const OverwriteType = {
  Role: 0,
} as const;

const AutoModEventType = {
  MessageSend: 1,
  MemberUpdate: 2,
} as const;

const AutoModTriggerType = {
  Keyword: 1,
  Spam: 3,
  KeywordPreset: 4,
  MentionSpam: 5,
  MemberProfile: 6,
} as const;

const AutoModActionType = {
  BlockMessage: 1,
  SendAlertMessage: 2,
  Timeout: 3,
  BlockMemberInteraction: 4,
} as const;

const AutoModKeywordPreset = {
  Profanity: 1,
  SexualContent: 2,
  Slurs: 3,
} as const;

const OnboardingMode = {
  Advanced: 1,
} as const;

const Perm = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  SendTtsMessages: 1n << 12n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  ViewGuildInsights: 1n << 19n,
  ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  UseApplicationCommands: 1n << 31n,
  ManageEvents: 1n << 33n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  SendMessagesInThreads: 1n << 38n,
  ModerateMembers: 1n << 40n,
  SendVoiceMessages: 1n << 46n,
  SendPolls: 1n << 49n,
} as const;

const baseRead = perms("ViewChannel", "ReadMessageHistory");
const baseTalk = perms(
  "ViewChannel",
  "SendMessages",
  "ReadMessageHistory",
  "AddReactions",
  "UseApplicationCommands",
  "CreatePublicThreads",
  "SendMessagesInThreads",
);
const supportTalk = perms(
  "ViewChannel",
  "SendMessages",
  "ReadMessageHistory",
  "AddReactions",
  "UseApplicationCommands",
  "CreatePublicThreads",
  "SendMessagesInThreads",
  "AttachFiles",
);
const staffTalk = perms(
  "ViewChannel",
  "SendMessages",
  "ReadMessageHistory",
  "AddReactions",
  "UseApplicationCommands",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "SendMessagesInThreads",
  "AttachFiles",
  "EmbedLinks",
);
const staffManage = perms("ManageMessages", "ManageThreads");
const quietDeny = perms(
  "SendMessages",
  "SendTtsMessages",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "SendMessagesInThreads",
  "AttachFiles",
  "MentionEveryone",
  "SendVoiceMessages",
  "SendPolls",
);
const publicDeny = perms(
  "MentionEveryone",
  "CreateInstantInvite",
  "SendTtsMessages",
  "SendVoiceMessages",
);

type PermissionName = keyof typeof Perm;

interface DiscordUser {
  id: string;
  username: string;
  bot?: boolean;
}

interface Guild {
  id: string;
  name: string;
  features: string[];
}

interface Role {
  id: string;
  name: string;
  permissions: string;
}

interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

interface Message {
  id: string;
  content: string;
  author: DiscordUser;
  pinned?: boolean;
}

interface AutoModRule {
  id: string;
  name: string;
}

interface RoleSpec {
  name: string;
  permissions: string;
  color: number;
  hoist?: boolean;
  mentionable?: boolean;
}

interface ChannelSpec {
  name: string;
  type: number;
  parentId?: string;
  topic?: string;
  rateLimitPerUser?: number;
  permissionOverwrites?: PermissionOverwrite[];
  availableTags?: ForumTag[];
  defaultThreadRateLimitPerUser?: number;
}

interface PermissionOverwrite {
  id: string;
  type: number;
  allow?: string;
  deny?: string;
}

interface ForumTag {
  name: string;
  moderated?: boolean;
}

interface SetupContext {
  guild: Guild;
  botUser: DiscordUser;
  roles: {
    everyone: Role;
    admin: Role;
    moderator: Role;
    support: Role;
    member: Role;
    player: Role;
    spectator: Role;
    builder: Role;
  };
  channels: Record<string, Channel>;
  warnings: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function perms(...names: PermissionName[]): string {
  return names.reduce((value, name) => value | Perm[name], 0n).toString();
}

function orPerms(...values: string[]): string {
  return values.reduce((acc, value) => acc | BigInt(value), 0n).toString();
}

function overwrite(
  id: string,
  allow: string,
  deny: string = "0",
): PermissionOverwrite {
  return {
    id,
    type: OverwriteType.Role,
    allow,
    deny,
  };
}

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[discord ${ts}] ${message}`);
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { retry?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "X-Audit-Log-Reason": AUDIT_REASON,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 429 && options.retry !== false) {
    const retryBody = await readJson(response);
    const retryAfterSeconds =
      typeof retryBody?.retry_after === "number" ? retryBody.retry_after : 1;
    await Bun.sleep(Math.ceil(retryAfterSeconds * 1000));
    return api<T>(method, path, body, { retry: false });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed = parseJson(text);

  if (!response.ok) {
    const details =
      parsed && typeof parsed === "object"
        ? JSON.stringify(redactDiscordError(parsed))
        : text.slice(0, 500);
    throw new Error(`${method} ${path} failed: HTTP ${response.status} ${details}`);
  }

  return (parsed ?? undefined) as T;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  return parseJson(text) as Record<string, unknown> | null;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactDiscordError(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const allowed: Record<string, unknown> = {};
  for (const key of ["code", "message", "errors"]) {
    if (key in record) allowed[key] = record[key];
  }
  return allowed;
}

async function loadInitialState(): Promise<{
  guild: Guild;
  botUser: DiscordUser;
  roles: Role[];
  channels: Channel[];
}> {
  const [guild, botUser, roles, channels] = await Promise.all([
    api<Guild>("GET", `/guilds/${guildId}`),
    api<DiscordUser>("GET", "/users/@me"),
    api<Role[]>("GET", `/guilds/${guildId}/roles`),
    api<Channel[]>("GET", `/guilds/${guildId}/channels`),
  ]);

  return { guild, botUser, roles, channels };
}

async function ensureRole(
  roles: Role[],
  spec: RoleSpec,
): Promise<Role> {
  const existing = roles.find((role) => role.name === spec.name);
  const body = {
    name: spec.name,
    permissions: spec.permissions,
    color: spec.color,
    hoist: spec.hoist ?? false,
    mentionable: spec.mentionable ?? false,
  };

  if (existing) {
    const updated = await api<Role>(
      "PATCH",
      `/guilds/${guildId}/roles/${existing.id}`,
      body,
    );
    log(`updated role: ${spec.name}`);
    return updated;
  }

  const created = await api<Role>("POST", `/guilds/${guildId}/roles`, body);
  log(`created role: ${spec.name}`);
  return created;
}

async function configureEveryoneRole(everyone: Role): Promise<Role> {
  const updated = await api<Role>(
    "PATCH",
    `/guilds/${guildId}/roles/${everyone.id}`,
    {
      permissions: baseRead,
      mentionable: false,
    },
  );
  log("hardened @everyone base permissions");
  return updated;
}

async function ensureChannel(
  channels: Channel[],
  spec: ChannelSpec,
): Promise<Channel> {
  const existing = channels.find(
    (channel) => channel.name === spec.name && channel.type === spec.type,
  );
  const body = channelBody(spec);

  if (existing) {
    const updated = await api<Channel>("PATCH", `/channels/${existing.id}`, body);
    log(`updated channel: ${spec.name}`);
    return updated;
  }

  const created = await api<Channel>(
    "POST",
    `/guilds/${guildId}/channels`,
    body,
  );
  channels.push(created);
  log(`created channel: ${spec.name}`);
  return created;
}

function channelBody(spec: ChannelSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: spec.name,
    type: spec.type,
  };
  if (spec.parentId) body.parent_id = spec.parentId;
  if (spec.topic !== undefined) body.topic = spec.topic;
  if (spec.rateLimitPerUser !== undefined) {
    body.rate_limit_per_user = spec.rateLimitPerUser;
  }
  if (spec.permissionOverwrites) {
    body.permission_overwrites = spec.permissionOverwrites;
  }
  if (spec.availableTags) {
    body.available_tags = spec.availableTags;
  }
  if (spec.defaultThreadRateLimitPerUser !== undefined) {
    body.default_thread_rate_limit_per_user =
      spec.defaultThreadRateLimitPerUser;
  }
  return body;
}

function roleOverwriteTargets(ctx: SetupContext): string[] {
  return [
    ctx.roles.everyone.id,
    ctx.roles.member.id,
    ctx.roles.player.id,
    ctx.roles.spectator.id,
    ctx.roles.builder.id,
  ];
}

function publicReadOnlyOverwrites(ctx: SetupContext): PermissionOverwrite[] {
  return [
    ...roleOverwriteTargets(ctx).map((roleId) =>
      overwrite(roleId, baseRead, quietDeny),
    ),
    overwrite(ctx.roles.support.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.moderator.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.admin.id, perms("Administrator"), "0"),
  ];
}

function publicChatOverwrites(ctx: SetupContext): PermissionOverwrite[] {
  return [
    overwrite(ctx.roles.everyone.id, baseTalk, publicDeny),
    overwrite(ctx.roles.member.id, baseTalk, publicDeny),
    overwrite(ctx.roles.player.id, baseTalk, publicDeny),
    overwrite(ctx.roles.spectator.id, baseTalk, publicDeny),
    overwrite(ctx.roles.builder.id, baseTalk, publicDeny),
    overwrite(ctx.roles.support.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.moderator.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.admin.id, perms("Administrator"), "0"),
  ];
}

function supportOverwrites(ctx: SetupContext): PermissionOverwrite[] {
  return [
    overwrite(ctx.roles.everyone.id, supportTalk, publicDeny),
    overwrite(ctx.roles.member.id, supportTalk, publicDeny),
    overwrite(ctx.roles.player.id, supportTalk, publicDeny),
    overwrite(ctx.roles.spectator.id, supportTalk, publicDeny),
    overwrite(ctx.roles.builder.id, supportTalk, publicDeny),
    overwrite(ctx.roles.support.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.moderator.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.admin.id, perms("Administrator"), "0"),
  ];
}

function staffOverwrites(ctx: SetupContext): PermissionOverwrite[] {
  return [
    overwrite(ctx.roles.everyone.id, "0", perms("ViewChannel")),
    overwrite(ctx.roles.support.id, staffTalk, "0"),
    overwrite(ctx.roles.moderator.id, orPerms(staffTalk, staffManage), "0"),
    overwrite(ctx.roles.admin.id, perms("Administrator"), "0"),
  ];
}

async function configureRoles(ctx: SetupContext, allRoles: Role[]): Promise<void> {
  const everyone = allRoles.find((role) => role.id === guildId);
  if (!everyone) {
    throw new Error("Could not find @everyone role");
  }

  ctx.roles.everyone = await configureEveryoneRole(everyone);
  ctx.roles.admin = await ensureRole(allRoles, {
    name: "House Admin",
    permissions: perms("Administrator"),
    color: 0xf2c94c,
    hoist: true,
  });
  ctx.roles.moderator = await ensureRole(allRoles, {
    name: "House Moderator",
    permissions: perms(
      "ViewChannel",
      "SendMessages",
      "ReadMessageHistory",
      "AddReactions",
      "UseApplicationCommands",
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
      "KickMembers",
      "BanMembers",
      "ViewAuditLog",
      "ManageNicknames",
    ),
    color: 0xeb5757,
    hoist: true,
  });
  ctx.roles.support = await ensureRole(allRoles, {
    name: "House Support",
    permissions: perms(
      "ViewChannel",
      "SendMessages",
      "ReadMessageHistory",
      "AddReactions",
      "UseApplicationCommands",
      "ManageMessages",
      "ManageThreads",
    ),
    color: 0x2f80ed,
    hoist: true,
  });
  ctx.roles.member = await ensureRole(allRoles, {
    name: "Member",
    permissions: baseTalk,
    color: 0x27ae60,
  });
  ctx.roles.player = await ensureRole(allRoles, {
    name: "Player",
    permissions: baseTalk,
    color: 0x9b51e0,
  });
  ctx.roles.spectator = await ensureRole(allRoles, {
    name: "Spectator",
    permissions: baseTalk,
    color: 0x56ccf2,
  });
  ctx.roles.builder = await ensureRole(allRoles, {
    name: "Builder",
    permissions: baseTalk,
    color: 0xf2994a,
  });
}

async function configureChannels(
  ctx: SetupContext,
  allChannels: Channel[],
): Promise<void> {
  const start = await ensureChannel(allChannels, {
    name: "START HERE",
    type: ChannelType.GuildCategory,
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });
  const support = await ensureChannel(allChannels, {
    name: "SUPPORT",
    type: ChannelType.GuildCategory,
    permissionOverwrites: supportOverwrites(ctx),
  });
  const community = await ensureChannel(allChannels, {
    name: "COMMUNITY",
    type: ChannelType.GuildCategory,
    permissionOverwrites: publicChatOverwrites(ctx),
  });
  const staff = await ensureChannel(allChannels, {
    name: "STAFF",
    type: ChannelType.GuildCategory,
    permissionOverwrites: staffOverwrites(ctx),
  });

  ctx.channels.welcome = await ensureChannel(allChannels, {
    name: "welcome",
    type: ChannelType.GuildText,
    parentId: start.id,
    topic: "Start here. The House is the community and support server for Influence.",
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });
  ctx.channels.rules = await ensureChannel(allChannels, {
    name: "rules",
    type: ChannelType.GuildText,
    parentId: start.id,
    topic: "Rules for The House. Staff will never ask for secrets.",
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });
  ctx.channels.announcements = await ensureChannel(allChannels, {
    name: "announcements",
    type: ChannelType.GuildText,
    parentId: start.id,
    topic: "Official announcements for The House and Influence.",
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });
  ctx.channels.status = await ensureChannel(allChannels, {
    name: "status",
    type: ChannelType.GuildText,
    parentId: start.id,
    topic: "Operational status and known service updates.",
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });
  ctx.channels.knownIssues = await ensureChannel(allChannels, {
    name: "known-issues",
    type: ChannelType.GuildText,
    parentId: start.id,
    topic: "Public known issues and workarounds.",
    permissionOverwrites: publicReadOnlyOverwrites(ctx),
  });

  ctx.channels.helpDesk = await ensureChannel(allChannels, {
    name: "help-desk",
    type: ChannelType.GuildForum,
    parentId: support.id,
    topic: supportForumTopic("support"),
    rateLimitPerUser: 30,
    defaultThreadRateLimitPerUser: 30,
    permissionOverwrites: supportOverwrites(ctx),
    availableTags: [
      { name: "account" },
      { name: "game" },
      { name: "mcp" },
      { name: "billing" },
      { name: "resolved", moderated: true },
      { name: "staff-review", moderated: true },
    ],
  });
  ctx.channels.bugReports = await ensureChannel(allChannels, {
    name: "bug-reports",
    type: ChannelType.GuildForum,
    parentId: support.id,
    topic: supportForumTopic("bug"),
    rateLimitPerUser: 30,
    defaultThreadRateLimitPerUser: 30,
    permissionOverwrites: supportOverwrites(ctx),
    availableTags: [
      { name: "web" },
      { name: "gameplay" },
      { name: "agent" },
      { name: "mcp" },
      { name: "blocked", moderated: true },
      { name: "resolved", moderated: true },
    ],
  });

  ctx.channels.general = await ensureChannel(allChannels, {
    name: "general",
    type: ChannelType.GuildText,
    parentId: community.id,
    topic: "General community chat for The House.",
    rateLimitPerUser: 10,
    permissionOverwrites: publicChatOverwrites(ctx),
  });
  ctx.channels.influenceLobby = await ensureChannel(allChannels, {
    name: "influence-lobby",
    type: ChannelType.GuildText,
    parentId: community.id,
    topic: "Talk Influence games, agents, votes, and strategy.",
    rateLimitPerUser: 10,
    permissionOverwrites: publicChatOverwrites(ctx),
  });
  ctx.channels.watchParties = await ensureChannel(allChannels, {
    name: "watch-parties",
    type: ChannelType.GuildText,
    parentId: community.id,
    topic: "Watch games together and react to the chaos.",
    rateLimitPerUser: 10,
    permissionOverwrites: publicChatOverwrites(ctx),
  });
  ctx.channels.agentLab = await ensureChannel(allChannels, {
    name: "agent-lab",
    type: ChannelType.GuildText,
    parentId: community.id,
    topic: "Discuss agent design, prompts, models, and strategy experiments.",
    rateLimitPerUser: 15,
    permissionOverwrites: publicChatOverwrites(ctx),
  });

  ctx.channels.modChat = await ensureChannel(allChannels, {
    name: "mod-chat",
    type: ChannelType.GuildText,
    parentId: staff.id,
    topic: "Private moderation coordination.",
    permissionOverwrites: staffOverwrites(ctx),
  });
  ctx.channels.automodAlerts = await ensureChannel(allChannels, {
    name: "automod-alerts",
    type: ChannelType.GuildText,
    parentId: staff.id,
    topic: "AutoMod alerts and safety events.",
    permissionOverwrites: staffOverwrites(ctx),
  });
  ctx.channels.supportTriage = await ensureChannel(allChannels, {
    name: "support-triage",
    type: ChannelType.GuildText,
    parentId: staff.id,
    topic: "Private support triage and escalation notes.",
    permissionOverwrites: staffOverwrites(ctx),
  });
  ctx.channels.incidentRoom = await ensureChannel(allChannels, {
    name: "incident-room",
    type: ChannelType.GuildText,
    parentId: staff.id,
    topic: "Incident response room. Use during raids or service incidents.",
    permissionOverwrites: staffOverwrites(ctx),
  });
}

function supportForumTopic(kind: "support" | "bug"): string {
  if (kind === "support") {
    return [
      "Open one post per issue.",
      "Include: what happened, what you expected, game URL or slug, browser/device, screenshots/log excerpts with secrets removed.",
      "Staff will never DM first or ask for seed phrases, private keys, passwords, or tokens.",
    ].join("\n");
  }

  return [
    "Report reproducible Influence bugs here.",
    "Include: steps to reproduce, expected result, actual result, game URL or slug, browser/device, screenshots/log excerpts with secrets removed.",
    "Keep sensitive account data out of public posts.",
  ].join("\n");
}

async function configureGuildSettings(ctx: SetupContext): Promise<void> {
  const features = Array.from(new Set([...(ctx.guild.features ?? []), "COMMUNITY"]));
  const body = {
    features,
    description:
      "The House is the community and support Discord for Influence.",
    verification_level: 3,
    default_message_notifications: 1,
    explicit_content_filter: 2,
    preferred_locale: "en-US",
    rules_channel_id: ctx.channels.rules.id,
    public_updates_channel_id: ctx.channels.announcements.id,
    safety_alerts_channel_id: ctx.channels.automodAlerts.id,
    system_channel_id: ctx.channels.status.id,
    system_channel_flags: 1 | 2 | 4 | 8,
  };

  try {
    await api<Guild>("PATCH", `/guilds/${guildId}`, body);
    log("configured guild safety/community settings");
  } catch (error) {
    ctx.warnings.push(
      "Could not enable/configure Community via API. Discord may require finishing Community setup in the UI.",
    );
    await api<Guild>("PATCH", `/guilds/${guildId}`, {
      description: body.description,
      verification_level: body.verification_level,
      default_message_notifications: body.default_message_notifications,
      explicit_content_filter: body.explicit_content_filter,
      preferred_locale: body.preferred_locale,
      safety_alerts_channel_id: body.safety_alerts_channel_id,
      system_channel_id: body.system_channel_id,
      system_channel_flags: body.system_channel_flags,
    });
    log(`configured fallback guild safety settings: ${String(error)}`);
  }
}

async function configureWelcomeScreen(ctx: SetupContext): Promise<void> {
  try {
    await api("PATCH", `/guilds/${guildId}/welcome-screen`, {
      enabled: true,
      description:
        "The House is the community and support server for Influence.",
      welcome_channels: [
        {
          channel_id: ctx.channels.helpDesk.id,
          description: "Get help without getting DM-scammed.",
        },
        {
          channel_id: ctx.channels.influenceLobby.id,
          description: "Talk Influence games and strategy.",
        },
        {
          channel_id: ctx.channels.rules.id,
          description: "Read the rules before posting.",
        },
      ],
    });
    log("configured welcome screen");
  } catch (error) {
    ctx.warnings.push(
      `Welcome screen still needs UI/API follow-up: ${String(error)}`,
    );
  }
}

async function configureOnboarding(ctx: SetupContext): Promise<void> {
  const defaultChannelIds = [
    ctx.channels.welcome.id,
    ctx.channels.rules.id,
    ctx.channels.announcements.id,
    ctx.channels.status.id,
    ctx.channels.knownIssues.id,
    ctx.channels.helpDesk.id,
    ctx.channels.bugReports.id,
    ctx.channels.general.id,
    ctx.channels.influenceLobby.id,
    ctx.channels.watchParties.id,
    ctx.channels.agentLab.id,
  ];

  try {
    await api("PUT", `/guilds/${guildId}/onboarding`, {
      enabled: true,
      mode: OnboardingMode.Advanced,
      default_channel_ids: defaultChannelIds,
    });
    log("configured onboarding default channels");
    ctx.warnings.push(
      "Review onboarding in the Discord UI. Default channels are configured, but role-choice prompt creation is UI follow-up because Discord requires prompt IDs for API edits.",
    );
  } catch (error) {
    ctx.warnings.push(
      `Onboarding still needs UI/API follow-up: ${String(error)}`,
    );
  }
}

async function configureStarterMessages(ctx: SetupContext): Promise<void> {
  await upsertPinnedMessage(
    ctx,
    ctx.channels.welcome.id,
    "Welcome to The House",
    [
      "# Welcome to The House",
      "",
      "The House is the support and community Discord for Influence.",
      "",
      "Use the public support forums for issues. Staff will never DM you first for support, and nobody from The House will ask for seed phrases, private keys, passwords, recovery phrases, API keys, or tokens.",
      "",
      "Start with #rules, then use #help-desk, #bug-reports, #influence-lobby, or #agent-lab depending on what you need.",
    ].join("\n"),
  );

  await upsertPinnedMessage(
    ctx,
    ctx.channels.rules.id,
    "The House rules",
    [
      "# The House rules",
      "",
      "1. Be direct, but not cruel. No harassment, hate, threats, or dogpiling.",
      "2. No scams, impersonation, phishing, or fake support.",
      "3. Staff will never ask for seed phrases, private keys, passwords, recovery phrases, API keys, or tokens.",
      "4. Keep support in public support channels unless staff explicitly moves it.",
      "5. Do not post private data, private logs, or sensitive account details.",
      "6. No spam, invite farming, raid behavior, or mass mentions.",
      "7. Critique games, agents, prompts, and strategy. Do not target people.",
      "8. Mods may remove content or restrict access to keep the server usable.",
    ].join("\n"),
  );

  await upsertPinnedMessage(
    ctx,
    ctx.channels.status.id,
    "The House status",
    [
      "# The House status",
      "",
      "No active public incident is posted here yet.",
      "",
      "During an incident, staff will post short updates here and keep troubleshooting details in the relevant support thread.",
    ].join("\n"),
  );

  await upsertPinnedMessage(
    ctx,
    ctx.channels.knownIssues.id,
    "Known issues",
    [
      "# Known issues",
      "",
      "No public known issues are posted yet.",
      "",
      "If you hit a bug, open a post in #bug-reports with the game URL or slug, browser/device, what happened, and anything sensitive removed.",
    ].join("\n"),
  );

  await upsertPinnedMessage(
    ctx,
    ctx.channels.general.id,
    "Public support reminder",
    [
      "# Public support reminder",
      "",
      "For support, use #help-desk or #bug-reports instead of DMs. It keeps answers visible, avoids impersonation scams, and saves everyone from doing archaeology in screenshots.",
    ].join("\n"),
  );
}

async function upsertPinnedMessage(
  ctx: SetupContext,
  channelId: string,
  matchText: string,
  content: string,
): Promise<void> {
  const messages = await api<Message[]>(
    "GET",
    `/channels/${channelId}/messages?limit=50`,
  );
  const existing = messages.find(
    (message) =>
      message.author.id === ctx.botUser.id && message.content.includes(matchText),
  );

  const payload = {
    content,
    allowed_mentions: { parse: [] },
  };

  const message = existing
    ? await api<Message>(
        "PATCH",
        `/channels/${channelId}/messages/${existing.id}`,
        payload,
      )
    : await api<Message>("POST", `/channels/${channelId}/messages`, payload);

  if (!message.pinned) {
    await api("PUT", `/channels/${channelId}/pins/${message.id}`);
  }
  log(`${existing ? "updated" : "posted"} pinned message: ${matchText}`);
}

async function configureAutoMod(ctx: SetupContext): Promise<void> {
  const rules = await api<AutoModRule[]>(
    "GET",
    `/guilds/${guildId}/auto-moderation/rules`,
  );

  await upsertAutoModRule(rules, {
    name: "The House: block scams and fake support",
    event_type: AutoModEventType.MessageSend,
    trigger_type: AutoModTriggerType.Keyword,
    trigger_metadata: {
      keyword_filter: [
        "*seed phrase*",
        "*private key*",
        "*recovery phrase*",
        "*secret recovery*",
        "*wallet verify*",
        "*verify wallet*",
        "*connect wallet*",
        "*wallet support*",
        "*metamask support*",
        "*free nitro*",
        "*discord nitro*",
        "*support will dm*",
        "*admin will dm*",
        "*airdrop claim*",
        "*claim airdrop*",
        "*passphrase*",
      ],
    },
    actions: [
      block("Do not post fake support, wallet-secret, or scam language here."),
      alert(ctx.channels.automodAlerts.id),
    ],
    enabled: true,
    exempt_roles: [
      ctx.roles.admin.id,
      ctx.roles.moderator.id,
      ctx.roles.support.id,
    ],
    exempt_channels: [ctx.channels.modChat.id, ctx.channels.supportTriage.id],
  });

  await upsertAutoModRule(rules, {
    name: "The House: block mention spam",
    event_type: AutoModEventType.MessageSend,
    trigger_type: AutoModTriggerType.MentionSpam,
    trigger_metadata: {
      mention_total_limit: 5,
      mention_raid_protection_enabled: true,
    },
    actions: [
      block("Too many mentions. Slow down and use one thread."),
      alert(ctx.channels.automodAlerts.id),
      timeout(300),
    ],
    enabled: true,
    exempt_roles: [
      ctx.roles.admin.id,
      ctx.roles.moderator.id,
      ctx.roles.support.id,
    ],
  });

  await upsertAutoModRule(rules, {
    name: "The House: block spam",
    event_type: AutoModEventType.MessageSend,
    trigger_type: AutoModTriggerType.Spam,
    actions: [
      block("This looks like spam. Rephrase and try again."),
      alert(ctx.channels.automodAlerts.id),
    ],
    enabled: true,
    exempt_roles: [
      ctx.roles.admin.id,
      ctx.roles.moderator.id,
      ctx.roles.support.id,
    ],
  });

  await upsertAutoModRule(rules, {
    name: "The House: block slurs and sexual content",
    event_type: AutoModEventType.MessageSend,
    trigger_type: AutoModTriggerType.KeywordPreset,
    trigger_metadata: {
      presets: [
        AutoModKeywordPreset.Slurs,
        AutoModKeywordPreset.SexualContent,
      ],
    },
    actions: [
      block("That language is not welcome here."),
      alert(ctx.channels.automodAlerts.id),
    ],
    enabled: true,
    exempt_roles: [
      ctx.roles.admin.id,
      ctx.roles.moderator.id,
      ctx.roles.support.id,
    ],
  });

  await upsertAutoModRule(rules, {
    name: "The House: block scam profile names",
    event_type: AutoModEventType.MemberUpdate,
    trigger_type: AutoModTriggerType.MemberProfile,
    trigger_metadata: {
      keyword_filter: [
        "*the house support*",
        "*house support*",
        "*influence support*",
        "*the house admin*",
        "*discord support*",
        "*wallet support*",
        "*metamask support*",
        "*support team*",
        "*admin support*",
        "*seed phrase*",
        "*private key*",
      ],
    },
    actions: [
      blockMemberInteraction(),
      alert(ctx.channels.automodAlerts.id),
    ],
    enabled: true,
    exempt_roles: [
      ctx.roles.admin.id,
      ctx.roles.moderator.id,
      ctx.roles.support.id,
    ],
  });
}

function block(customMessage: string): Record<string, unknown> {
  return {
    type: AutoModActionType.BlockMessage,
    metadata: {
      custom_message: customMessage,
    },
  };
}

function alert(channelId: string): Record<string, unknown> {
  return {
    type: AutoModActionType.SendAlertMessage,
    metadata: {
      channel_id: channelId,
    },
  };
}

function timeout(durationSeconds: number): Record<string, unknown> {
  return {
    type: AutoModActionType.Timeout,
    metadata: {
      duration_seconds: durationSeconds,
    },
  };
}

function blockMemberInteraction(): Record<string, unknown> {
  return {
    type: AutoModActionType.BlockMemberInteraction,
  };
}

async function upsertAutoModRule(
  rules: AutoModRule[],
  body: Record<string, unknown>,
): Promise<void> {
  const name = String(body.name);
  const existing = rules.find((rule) => rule.name === name);

  if (existing) {
    await api(
      "PATCH",
      `/guilds/${guildId}/auto-moderation/rules/${existing.id}`,
      body,
    );
    log(`updated automod rule: ${name}`);
    return;
  }

  const created = await api<AutoModRule>(
    "POST",
    `/guilds/${guildId}/auto-moderation/rules`,
    body,
  );
  rules.push(created);
  log(`created automod rule: ${name}`);
}

async function verifySetup(ctx: SetupContext): Promise<void> {
  const [roles, channels, automodRules] = await Promise.all([
    api<Role[]>("GET", `/guilds/${guildId}/roles`),
    api<Channel[]>("GET", `/guilds/${guildId}/channels`),
    api<AutoModRule[]>("GET", `/guilds/${guildId}/auto-moderation/rules`),
  ]);

  const requiredRoleNames = [
    "House Admin",
    "House Moderator",
    "House Support",
    "Member",
    "Player",
    "Spectator",
    "Builder",
  ];
  const requiredChannelNames = [
    "welcome",
    "rules",
    "announcements",
    "status",
    "known-issues",
    "help-desk",
    "bug-reports",
    "general",
    "influence-lobby",
    "watch-parties",
    "agent-lab",
    "mod-chat",
    "automod-alerts",
    "support-triage",
    "incident-room",
  ];

  const missingRoles = requiredRoleNames.filter(
    (name) => !roles.some((role) => role.name === name),
  );
  const missingChannels = requiredChannelNames.filter(
    (name) => !channels.some((channel) => channel.name === name),
  );
  const houseAutomodRules = automodRules.filter((rule) =>
    rule.name.startsWith("The House:"),
  );

  if (missingRoles.length > 0) {
    throw new Error(`Missing roles after setup: ${missingRoles.join(", ")}`);
  }
  if (missingChannels.length > 0) {
    throw new Error(`Missing channels after setup: ${missingChannels.join(", ")}`);
  }
  if (houseAutomodRules.length < 5) {
    throw new Error(
      `Expected at least 5 The House AutoMod rules, found ${houseAutomodRules.length}`,
    );
  }

  log(`verified roles: ${requiredRoleNames.length}`);
  log(`verified public/staff channels: ${requiredChannelNames.length}`);
  log(`verified automod rules: ${houseAutomodRules.length}`);
}

async function main(): Promise<void> {
  log("loading Discord guild state");
  const initial = await loadInitialState();
  log(`configuring guild: ${initial.guild.name} (${initial.guild.id})`);
  log(`using bot user: ${initial.botUser.username} (${initial.botUser.id})`);

  const ctx: SetupContext = {
    guild: initial.guild,
    botUser: initial.botUser,
    roles: {} as SetupContext["roles"],
    channels: {},
    warnings: [],
  };

  await configureRoles(ctx, initial.roles);
  await configureChannels(ctx, initial.channels);
  await configureGuildSettings(ctx);
  await configureStarterMessages(ctx);
  await configureAutoMod(ctx);
  await configureWelcomeScreen(ctx);
  await configureOnboarding(ctx);
  await verifySetup(ctx);

  if (ctx.warnings.length > 0) {
    console.log("");
    log("manual follow-up needed:");
    for (const warning of ctx.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("");
  log("The House Discord setup is complete.");
}

try {
  await main();
} catch (error) {
  console.error(`[discord] setup failed: ${String(error)}`);
  process.exit(1);
}
