// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a notifications.get frame, selecting one notification.
 */
export type WsNotificationGetRequestV0 = {
    /**
     * The notification to fetch.
     */
    id: string;
};
