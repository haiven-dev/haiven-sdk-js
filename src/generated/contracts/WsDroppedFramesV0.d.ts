// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type WsDroppedFramesV0TypesItem = {
    /**
     * The frame type that was discarded.
     */
    type: string;
    /**
     * How many frames of this type were discarded.
     */
    count: number;
};
/**
 * A report of the server-originated frames discarded while a session was expired.
 */
export type WsDroppedFramesV0 = {
    /**
     * How many frames were discarded during the expiry episode.
     */
    count: number;
    /**
     * The discarded frames grouped by type, so a client can say what was lost rather than only how much.
     */
    types: WsDroppedFramesV0TypesItem[];
    /**
     * The identifiers of the discarded replies, oldest first.
     */
    requestIds: string[];
    /**
     * Whether more correlated replies were discarded than the list names.
     */
    truncated: boolean;
};
