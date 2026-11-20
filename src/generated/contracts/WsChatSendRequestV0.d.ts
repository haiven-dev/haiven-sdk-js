// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a chat.send frame, posting a message to a channel.
 */
export type WsChatSendRequestV0 = {
    /**
     * The channel to post the message to.
     */
    channelId: string;
    /**
     * The message text.
     */
    content: string;
    /**
     * The message this one replies to, omitted when it is not a reply.
     */
    parentMessageId?: string;
    /**
     * An identifier the client chooses to recognise its own message on the broadcast that follows.
     */
    clientMessageId?: string;
};
