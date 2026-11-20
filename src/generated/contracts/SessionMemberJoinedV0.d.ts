// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A player joined the peer-to-peer session.
 */
export type SessionMemberJoinedV0 = {
    /**
     * The session.
     */
    sessionId: string;
    /**
     * The member.
     */
    userId: string;
    /**
     * The member's participation.
     */
    participationId: string;
};
