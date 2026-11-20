// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a notifications.read frame, marking a whole category read.
 */
export type WsNotificationReadRequestV0 = {
    /**
     * The notification category to mark read, one of chat, user or general.
     */
    kind: string;
};
