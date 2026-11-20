// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload of a chat community update.
 */
export type WsChatServerEventV0 = {
    /**
     * The community this event is about.
     */
    communityId: string;
    /**
     * The community's display name after the update.
     */
    name: string;
    /**
     * The community's icon, or null when it has none.
     */
    iconUrl: string | null;
};
