// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type WsPresenceEventV0Status = {
    /**
     * The status emoji, or the empty string when there is none.
     */
    emoji: string;
    /**
     * The status text, or the empty string when there is none.
     */
    text: string;
    /**
     * When this status lapses, or null when it does not.
     */
    expiresAt: string | null;
};
export type WsPresenceEventV0Availability = {
    /**
     * The availability state.
     */
    state: string;
    /**
     * When this availability lapses, or null when it does not.
     */
    expiresAt: string | null;
};
/**
 * The payload of a presence update.
 */
export type WsPresenceEventV0 = {
    /**
     * The user whose presence changed.
     */
    userId: string;
    /**
     * Whether the user is reachable, and until when.
     */
    availability: WsPresenceEventV0Availability;
    /**
     * The user's self-set status.
     */
    status: WsPresenceEventV0Status;
};
