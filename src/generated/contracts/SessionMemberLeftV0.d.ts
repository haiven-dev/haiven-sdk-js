// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A member's participation ended; the host closes its connection to that member.
 */
export type SessionMemberLeftV0 = {
    /**
     * The session.
     */
    sessionId: string;
    /**
     * The member whose participation ended.
     */
    userId: string;
    /**
     * The participation that ended.
     */
    participationId: string;
    /**
     * Why the participation ended.
     */
    reason: string;
};
