// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A visible update to a chat community.
 */
export type ChatCommunityUpdateV0 = {
    /**
     * The chat community identifier.
     */
    communityId: string;
    /**
     * The human-readable name of this value.
     */
    name: string;
    /**
     * The URL of the chat community icon, or null when it has no icon.
     */
    iconUrl: string;
    /**
     * The URL of the chat community cover image, or null when it has no cover.
     */
    coverUrl: string;
};
