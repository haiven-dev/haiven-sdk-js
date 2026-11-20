// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload of a chat message event.
 */
export type WsChatMessageEventV0 = {
    /**
     * The channel the message belongs to.
     */
    channelId: string;
    /**
     * The message's server-assigned identifier.
     */
    id: string;
    /**
     * The user who wrote the message.
     */
    authorId?: string;
    /**
     * The identifier the sending client assigned, echoed so it can reconcile its optimistic copy.
     */
    clientMessageId?: string;
    /**
     * The message this one replies to, when it is a reply.
     */
    parentMessageId?: string;
    /**
     * The message body.
     */
    content?: string;
    /**
     * When the message was first written.
     */
    createdAt?: string;
    /**
     * When the message was last edited.
     */
    updatedAt?: string;
};
