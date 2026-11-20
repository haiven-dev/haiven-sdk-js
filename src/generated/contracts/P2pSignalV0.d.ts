// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * One signaling message from a session member to another, relayed by the server.
 */
export type P2pSignalV0 = {
    /**
     * The session both members belong to.
     */
    sessionId: string;
    /**
     * The member to deliver the message to.
     */
    toUserId: string;
    /**
     * One connection attempt including an ICE restart.
     */
    attemptId: string;
    /**
     * Rises from 1 within the attempt.
     */
    seq: number;
    /**
     * Opaque to the server: at most 4096 bytes.
     */
    data: string;
};
