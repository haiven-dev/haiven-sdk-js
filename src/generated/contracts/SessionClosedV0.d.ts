// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A peer-to-peer session closed; every member stops playing in it.
 */
export type SessionClosedV0 = {
    /**
     * The session.
     */
    sessionId: string;
    /**
     * The end reason of the host's participation that closed the session.
     */
    reason: string;
};
