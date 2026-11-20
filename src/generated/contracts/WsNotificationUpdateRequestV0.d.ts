// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The payload a client sends on a notifications.update frame, revising one notification.
 */
export type WsNotificationUpdateRequestV0 = {
    /**
     * The notification to revise.
     */
    id: string;
    /**
     * The replacement headline, omitted to leave it unchanged.
     */
    title?: string | null;
    /**
     * The replacement message text, omitted to leave it unchanged.
     */
    body?: string | null;
    /**
     * The replacement structured detail as raw JSON, omitted to leave it unchanged.
     */
    data?: unknown;
};
