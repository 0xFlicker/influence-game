/** Shared frozen defaults; this module must remain safe for browser presentation imports. */
export const DEFAULT_CONVERSATION_POLICY = { bytesPerParticipant: 400, messageBytes: 320, maxHandoffs: 3 } as const;
