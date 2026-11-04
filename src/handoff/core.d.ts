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
    /** Absolute Unix time in milliseconds. */
    expiresAt: number;
};
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
    private readonly options;
    constructor(rest: RestClient, tokens: TokenStore, options: HandoffCoordinatorOptions);
    beginLogin(): Promise<HandoffStart>;
    complete(callbackUrl: string): Promise<GameHandoffCredential>;
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
