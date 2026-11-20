// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A refresh hint that the signed-in account's entitlements changed, sent to its open sockets after the change commits. It carries no grants and authorizes nothing: re-read GET /users/me/entitlements unless that read already returned this projection version or a later one.
 */
export type EntitlementsUpdatedV0 = {
    /**
     * The account's entitlement projection version after the change; it only increases.
     */
    projectionVersion: number;
};
