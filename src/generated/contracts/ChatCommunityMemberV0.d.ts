// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type ChatCommunityMemberV0User = {
    /**
     * The stable identifier of this value.
     */
    id: string;
    /**
     * The user's username.
     */
    username: string;
    /**
     * The member name shown to other users.
     */
    displayName: string;
    /**
     * The URL of the user's profile image.
     */
    profileImageUrl: string | null;
    /**
     * The item reference of the avatar frame the user has equipped; resolve it against the avatar frame catalog.
     */
    avatarFrame?: string;
};
/**
 * A member of a chat community.
 */
export type ChatCommunityMemberV0 = {
    /**
     * The chat community identifier.
     */
    communityId: string;
    /**
     * The user identifier.
     */
    userId: string;
    /**
     * The user summary for this chat participant.
     */
    user?: ChatCommunityMemberV0User;
    /**
     * The number of active members in the community after this membership change.
     */
    memberCount: number;
};
