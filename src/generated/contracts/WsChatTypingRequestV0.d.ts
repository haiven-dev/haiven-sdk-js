// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a chat.typing frame, reporting its own typing state.
 */
export type WsChatTypingRequestV0 = {
    /**
     * The channel the typing state applies to.
     */
    channelId: string;
    /**
     * Whether the user is currently typing.
     */
    isTyping: boolean;
};
