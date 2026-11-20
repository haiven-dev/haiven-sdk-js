// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A request to replace a chat message's content.
 */
export type ChatEditRequestV0 = {
    /**
     * The chat message identifier.
     */
    messageId: string;
    /**
     * The user-authored message content.
     */
    content: string;
};
