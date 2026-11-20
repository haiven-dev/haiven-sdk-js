// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * Every frame a client sends over the /v0/ws socket.
 */
export type WsClientFrameV0 = {
    /**
     * The frame discriminator, such as chat.send or ping. Clients must accept a type minted after they shipped rather than treating it as a protocol error.
     */
    type: string;
    /**
     * An identifier the client chooses to correlate this frame with the reply that answers it.
     */
    requestId?: string;
    /**
     * The frame body, whose shape is determined by the type field.
     */
    payload?: unknown;
};
