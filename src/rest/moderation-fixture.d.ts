/** One credential the fixture minted, and what it is bound to. */
export type Credential = {
    token: string;
    role: string;
    studio: string;
};
/** What the fixture announces on stdout once it is listening. */
type Startup = {
    baseUrl: string;
    /** The studio every credential is bound to unless a caller asks for another. */
    studio: string;
};
/** One answered HTTP exchange. */
export type Answer = {
    status: number;
    /** The decoded body, or `null` when the response carried none that parses. */
    body: Record<string, unknown> | null;
};
/**
 * Why the moderation live tier may not run here.
 *
 * Reported, never silent — the same rule `liveUnavailable` follows, and for the
 * same reason: a suite whose absence is indistinguishable from its success is
 * not a suite.
 */
export declare function moderationUnavailable(): Promise<string | undefined>;
export declare class ModerationFixture {
    readonly info: Startup;
    private readonly child;
    private readonly buildDir;
    private constructor();
    static start(): Promise<ModerationFixture>;
    /**
     * Mint a credential for a role, bound to a studio.
     *
     * The role is recorded against the key, which is what makes `token.roles` a
     * capability the fixture genuinely offers rather than a label. The fixture
     * does not answer refusals on the surface's behalf: if Backend does not read
     * the role yet, a role-scoped scenario observes that, and the corpus records
     * it as a waiver.
     */
    mint(role: string, studio?: string): Promise<Credential>;
    /**
     * Call one moderation operation with a credential and an addressed studio.
     *
     * `studio` is passed separately from the credential on purpose: addressing a
     * studio the token was not minted for is the crossing `wrong-studio-is-rejected`
     * makes, and folding it into the credential would make that crossing
     * unexpressible.
     */
    call(method: string, urlPath: string, credential: Credential, studio: string, body?: unknown): Promise<Answer>;
    stop(): Promise<void>;
}
/**
 * Split a suite operation id (`http:POST:/moderation/df/events`) into its
 * method and path.
 *
 * Exported because it is the one piece of the runner that is worth testing
 * without a backend checkout: everything else needs the fixture, and this is
 * where a malformed id would otherwise turn into a request to a nonsense URL.
 */
export declare function operation(operationId: string): {
    method: string;
    path: string;
};
export {};
