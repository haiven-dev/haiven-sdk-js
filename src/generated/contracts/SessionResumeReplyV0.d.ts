// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The socket a resumed participation is now bound to.
 */
export type SessionResumeReplyV0 = {
    /**
     * The resumed participation.
     */
    participationId: string;
    /**
     * The server-generated WebSocket connection identifier.
     */
    connectionId: string;
};
