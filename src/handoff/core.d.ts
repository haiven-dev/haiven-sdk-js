import type { RestClient, TokenStore } from "../rest/client.js";
export type Awaitable<T> = T | Promise<T>;
export type HandoffTransaction = {
    state: string;
    codeVerifier: string;
    createdAt: number;
};
export type HandoffTransactionStore = {
    put(transaction: HandoffTransaction): Awaitable<void>;
    take(state: string): Awaitable<HandoffTransaction | null>;
    remove(state: string): Awaitable<void>;
};
export type HandoffCrypto = {
    randomBytes(size: number): Awaitable<Uint8Array>;
    sha256(value: Uint8Array): Awaitable<Uint8Array>;
};
export type HandoffHost = HandoffCrypto & {
    readonly profile: "browser" | "node" | "react-native";
    readonly transactions: HandoffTransactionStore;
    /** Optional for hosts that return the URL to another launcher. */
    launchUrl?(url: string): Awaitable<void>;
};
export type HandoffCoordinatorOptions = {
    /** First-party page that completes login, normally `/connect/game`. */
    entryUrl: string;
    integrationId: string;
    redirectUrl: string;
    host: HandoffHost;
    instructionsId?: string;
    screenHint?: string;
    transactionLifetimeMs?: number;
    /** Injected for deterministic tests and hosts with a platform clock. */
    now?: () => number;
};
export type HandoffStart = {
    authorizationUrl: string;
    state: string;
};
export type GameHandoffCredential = {
    accessToken: string;
    tokenType: string;
    /**
     * Absolute Unix time in milliseconds, or `null` for a durable credential
     * that lasts until it is revoked (ADR 0041).
     */
    expiresAt: number | null;
};
/** Events that end an opaque handoff bearer and require a new handoff. */
export type HandoffCredentialEndReason = "expired" | "rest-401" | "ws-expired";
export declare class HandoffError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
/**
 * Target-independent PKCE handoff state machine.
 *
 * Host differences stay behind HandoffHost: entropy, SHA-256, URL launching,
 * and transient transaction persistence. The generated REST surface owns the
 * form exchange, while the assembled client owns the TokenStore.
 */
export declare class HandoffCoordinator {
    private readonly rest;
    private readonly tokens;
    private readonly linkedListeners;
    private readonly options;
    constructor(rest: RestClient, tokens: TokenStore, options: HandoffCoordinatorOptions);
    beginLogin(): Promise<HandoffStart>;
    /**
     * Reuses the credential the token store saved, so a restart does not send
     * the player back to the browser. Call it before {@link beginLogin}; it
     * returns `null` when nothing valid is saved, and the caller then begins a
     * handoff. A saved credential past its expiry is cleared. A reused
     * credential notifies {@link onLinked} like a completed handoff.
     */
    resume(): Promise<GameHandoffCredential | null>;
    /**
     * Clears the rejected bearer and starts a fresh handoff. Game credentials
     * never enter the ordinary web refresh-token path.
     */
    restartLogin(reason: HandoffCredentialEndReason): Promise<HandoffStart>;
    complete(callbackUrl: string): Promise<GameHandoffCredential>;
    /**
     * Runs after a credential is stored or resumed. The access token is already
     * visible to REST.
     */
    onLinked(listener: (credential: GameHandoffCredential) => Awaitable<void>): () => void;
    private buildAuthorizationUrl;
    private isExpectedCallback;
}
export declare class MemoryHandoffTransactionStore implements HandoffTransactionStore {
    private readonly values;
    put(transaction: HandoffTransaction): void;
    take(state: string): HandoffTransaction | null;
    remove(state: string): void;
}
export type HandoffKeyValueStore = {
    getItem(key: string): Awaitable<string | null>;
    setItem(key: string, value: string): Awaitable<void>;
    removeItem(key: string): Awaitable<void>;
};
/** SessionStorage/AsyncStorage adapter with serialized one-use reads. */
export declare class KeyValueHandoffTransactionStore implements HandoffTransactionStore {
    private readonly storage;
    private readonly prefix;
    private tail;
    constructor(storage: HandoffKeyValueStore, prefix?: string);
    put(transaction: HandoffTransaction): Promise<void>;
    take(state: string): Promise<HandoffTransaction | null>;
    remove(state: string): Promise<void>;
    private key;
    private exclusive;
}
export type WebCryptoLike = {
    getRandomValues(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
    subtle: {
        digest(algorithm: string, value: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
    };
};
export declare function webCryptoHandoffCrypto(crypto: WebCryptoLike): HandoffCrypto;
