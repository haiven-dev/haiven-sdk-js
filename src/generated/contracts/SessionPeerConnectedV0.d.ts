// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The host's report that the data channel to a guest is open.
 */
export type SessionPeerConnectedV0 = {
    /**
     * The session the guest belongs to.
     */
    sessionId: string;
    /**
     * The guest whose data channel opened.
     */
    userId: string;
};
