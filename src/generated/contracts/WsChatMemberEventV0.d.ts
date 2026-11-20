// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload of a chat community membership change.
 */
export type WsChatMemberEventV0 = {
    /**
     * The community whose membership changed.
     */
    communityId: string;
    /**
     * The member who joined or left.
     */
    userId: string;
    /**
     * The member's display name at the time of the change.
     */
    displayName: string;
};
