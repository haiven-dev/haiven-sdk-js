// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A request to mark a notification category as read.
 */
export type NotificationReadRequestV0 = {
    /**
     * The notification category used for grouping and read state.
     */
    kind: string;
};
