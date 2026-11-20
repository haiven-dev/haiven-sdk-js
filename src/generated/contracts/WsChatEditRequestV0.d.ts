// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a chat.edit frame, replacing the text of a message it authored.
 */
export type WsChatEditRequestV0 = {
    /**
     * The message to edit.
     */
    messageId: string;
    /**
     * The replacement message text.
     */
    content: string;
};
