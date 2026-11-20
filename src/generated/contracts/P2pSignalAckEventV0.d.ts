// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * An acknowledgement delivered to the member that sent the signaling message.
 */
export type P2pSignalAckEventV0 = {
    /**
     * The session both members belong to.
     */
    sessionId: string;
    /**
     * The member that acknowledged as the server authenticated it.
     */
    fromUserId: string;
    /**
     * The attempt of the acknowledged message.
     */
    attemptId: string;
    /**
     * The sequence number of the acknowledged message.
     */
    seq: number;
};
