// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type WsChatDmEventV0Friend = {
    /**
     * The other member's user identifier.
     */
    id: string;
    /**
     * When the other member left the direct message, or null while they are still in it.
     */
    leftAt: string | null;
};
/**
 * The payload of a direct-message membership event.
 */
export type WsChatDmEventV0 = {
    /**
     * The direct-message channel this event is about.
     */
    channelId: string;
    /**
     * The other member of the direct message.
     */
    friend: WsChatDmEventV0Friend;
};
