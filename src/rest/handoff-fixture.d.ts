import type { FetchLike } from "./client.js";
type Integration = {
    id: string;
    allowed_redirects: string[];
};
type Verifier = {
    value: string;
    challenge: string;
};
type Credential = {
    access_token: string;
    token_type: string;
    expires_in: number;
};
export type HandoffFixtureDefinition = {
    now: string;
    code_ttl_seconds: number;
    integrations: Record<string, Integration>;
    redirects: Record<string, string>;
    states: Record<string, string>;
    verifiers: Record<string, Verifier>;
    credentials: Record<string, Credential>;
};
export type FixtureResponse = {
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
/**
 * A deterministic provider for the published auth-handoff corpus.
 *
 * It implements the fixture contract, not SDK product behaviour. The generated
 * REST methods are the client under test; this provider only gives every target
 * runner the same clock, bindings, atomic-consume semantics, and responses.
 */
export declare class HandoffFixture {
    readonly definition: HandoffFixtureDefinition;
    readonly requests: {
        credential: number;
        create: number;
        exchange: number;
    };
    lastResponse: FixtureResponse | null;
    private readonly startMs;
    private nowMs;
    private nextCode;
    private readonly codes;
    constructor(definition: HandoffFixtureDefinition);
    advance(seconds: number): void;
    credential(name: string): Credential;
    integration(name: string): Integration;
    redirect(name: string): string;
    state(name: string): string;
    verifier(name: string): Verifier;
    readonly fetch: FetchLike;
    private readCredential;
    private create;
    private exchange;
    private authorizedCredential;
    private remainingSeconds;
    private findIntegration;
    private jsonBody;
    private expired;
    private error;
    private respond;
}
export {};
