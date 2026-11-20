// Generated from the published Haiven contract schemas. Do not edit by hand.
//
// The nullability of a presence discriminant is deliberate and is NOT derived
// from `required`.
/**
 * A Google or Apple identity linked to the account from settings.
 */
export type AccountIdentityLinkedV0 = {
    /**
     * The sign-in provider of the identity: google or apple.
     */
    provider: string;
    /**
     * The email address the provider gave for the identity, which can differ from the account's.
     */
    email: string;
};
