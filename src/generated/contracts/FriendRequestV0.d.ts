// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A pending friend request and the other user it involves.
 */
export type FriendRequestV0 = {
    /**
     * The stable identifier of this value.
     */
    id: string;
    /**
     * The identifier of the other user in the friendship or friend request.
     */
    friendId: string;
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
    profileImageUrl: string;
    /**
     * The item reference of the avatar frame the user has equipped; resolve it against the avatar frame catalog.
     */
    avatarFrame: string;
    /**
     * The time the value was created.
     */
    createdAt: string;
};
