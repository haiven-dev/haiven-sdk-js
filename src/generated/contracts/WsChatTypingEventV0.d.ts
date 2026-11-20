// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload of a chat typing event.
 */
export type WsChatTypingEventV0 = {
    /**
     * The channel the typing state applies to.
     */
    channelId: string;
    /**
     * The user whose typing state changed.
     */
    userId: string;
    /**
     * Whether the user is currently typing.
     */
    isTyping: boolean;
};
