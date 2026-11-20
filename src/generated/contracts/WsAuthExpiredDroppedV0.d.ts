// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
export type WsAuthExpiredDroppedV0TypesItem = {
    /**
     * The WebSocket message type represented by this value.
     *
     * Open vocabulary WsMessageTypeV0: recognised values are in the emitted vocabulary; never reject one that is not.
     */
    type: string;
    /**
     * The number of values represented by this object.
     */
    count: number;
};
/**
 * Frames discarded after a WebSocket session expired.
 */
export type WsAuthExpiredDroppedV0 = {
    /**
     * The number of values represented by this object.
     */
    count: number;
    /**
     * Discarded frame counts grouped by WebSocket message type.
     */
    types: WsAuthExpiredDroppedV0TypesItem[];
    /**
     * The request identifiers of discarded client frames when available.
     */
    requestIds: string[];
    /**
     * Whether additional discarded-frame details were omitted.
     */
    truncated: boolean;
};
