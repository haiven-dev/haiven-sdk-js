// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload of a chat channel event.
 */
export type WsChatChannelEventV0 = {
    /**
     * The community the channel belongs to.
     */
    communityId: string;
    /**
     * The channel this event is about.
     */
    channelId: string;
    /**
     * The user who created the channel.
     */
    createdByUserId: string;
    /**
     * The channel name, or null when it has none.
     */
    name: string | null;
    /**
     * The category the channel is grouped under, or null when it is ungrouped.
     */
    category: string | null;
    /**
     * The channel's sort position within its category, or null when unordered.
     */
    position: number | null;
};
