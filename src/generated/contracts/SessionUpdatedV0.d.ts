// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * The host changed the session's state, visibility or metadata.
 */
export type SessionUpdatedV0 = {
    /**
     * The session.
     */
    sessionId: string;
    /**
     * Whether the session takes joins: open does and locked does not.
     */
    state: string;
    /**
     * Who may find and join the session.
     */
    visibility: string;
    /**
     * The most members the session holds.
     */
    maxMembers: number;
    /**
     * The six-character code of a private session: null otherwise.
     */
    joinCode: unknown;
    /**
     * The game's own key and value pairs.
     */
    metadata: Record<string, unknown>;
};
