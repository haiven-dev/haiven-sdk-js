// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A signaling message delivered to its recipient, with the sender the server authenticated.
 */
export type P2pSignalReceivedV0 = {
    /**
     * The session both members belong to.
     */
    sessionId: string;
    /**
     * The sender as the server authenticated it.
     */
    fromUserId: string;
    /**
     * The sender's connection attempt.
     */
    attemptId: string;
    /**
     * The sender's sequence number within the attempt.
     */
    seq: number;
    /**
     * The sender's opaque signaling data.
     */
    data: string;
};
