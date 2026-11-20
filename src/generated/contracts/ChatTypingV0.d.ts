// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A user's typing state in a chat channel.
 */
export type ChatTypingV0 = {
    /**
     * The chat channel identifier.
     */
    channelId: string;
    /**
     * The user identifier.
     */
    userId?: string;
    /**
     * Whether the user is currently typing in the channel.
     */
    isTyping: boolean;
};
