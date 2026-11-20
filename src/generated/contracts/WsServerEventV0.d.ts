// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A server frame the client did not ask for.
 */
export type WsServerEventV0 = {
    /**
     * The frame discriminator, naming what happened.
     */
    type: string;
    /**
     * The event body, whose shape is determined by the type field.
     */
    payload?: unknown;
};
