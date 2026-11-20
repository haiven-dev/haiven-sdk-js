// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A request to update a notification's visible fields.
 */
export type NotificationUpdateRequestV0 = {
    /**
     * The stable identifier of this value.
     */
    id: string;
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
    data: unknown;
};
