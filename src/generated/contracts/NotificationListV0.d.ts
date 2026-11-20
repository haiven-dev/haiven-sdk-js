// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type NotificationListV0Item = {
    /**
     * The stable identifier of this value.
     */
    id: string;
    /**
     * The user identifier.
     */
    userId: string;
    /**
     * The notification category used for grouping and read state.
     */
    kind: string;
    /**
     * The presentation variant used for the notification.
     */
    variety: string;
    /**
     * The notification title shown to the user.
     */
    title: string;
    /**
     * The notification body shown to the user.
     */
    body: string;
    /**
     * Opaque application data encoded for JSON transport.
     */
    data: string;
    /**
     * Whether the user has read the notification.
     */
    isRead: boolean;
    /**
     * The time the value was created.
     */
    createdAt: string;
    /**
     * The time the value was last updated.
     */
    updatedAt: string;
};
/** A list of user notifications. */
export type NotificationListV0 = NotificationListV0Item[];
