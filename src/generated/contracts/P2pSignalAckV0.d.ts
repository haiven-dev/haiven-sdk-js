// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A recipient's acknowledgement of one signaling message.
 */
export type P2pSignalAckV0 = {
    /**
     * The session both members belong to.
     */
    sessionId: string;
    /**
     * The original sender of the acknowledged message.
     */
    toUserId: string;
    /**
     * The attempt of the acknowledged message.
     */
    attemptId: string;
    /**
     * The sequence number of the acknowledged message.
     */
    seq: number;
};
