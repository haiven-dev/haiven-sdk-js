import { OpenCodec, type ParsedCode } from "../wire/code.js";
import { RestApi, type RestRequestContentType } from "./generated.js";
export * from "./generated.js";
/**
 * The minimum this client needs from a fetch implementation.
 *
 * Deliberately narrower than the DOM `fetch`. The three hosts the TS core has to
 * serve — browser, Electron main and renderer, React Native — do not agree on
 * the concrete global, and Electron's main process has no `window` at all. The
 * same reason `SocketLike` exists for the socket half.
 */
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<ResponseLike>;
/** The subset of a fetch `Response` this client reads. */
export type ResponseLike = {
    status: number;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
};
/**
 * Where the access token lives.
 *
 * Injected rather than assumed, because the three hosts disagree about what
 * durable storage is: a browser has `localStorage`, React Native has
 * `AsyncStorage`, and Electron's main process has neither. `packages/app` keeps
 * it in a module-level variable, which works only because it is one process with
 * one user.
 */
export type TokenStore = {
    read(): string | null;
    /**
     * Writes the current access token. Handoff callers also provide its absolute
     * expiry as Unix milliseconds; older stores may ignore that optional value.
     */
    write(token: string | null, expiresAt?: number | null): void;
};
export type RestClientOptions = {
    /**
     * The API root, including the version prefix — for example
     * `https://api.haiven.ai/v0`.
     *
     * Explicit rather than derived. `packages/app` hardcodes a relative `/v0`,
     * which works only because it is served from the same origin; Electron and
     * React Native have no origin to be relative to.
     */
    baseUrl: string;
    fetch: FetchLike;
    tokens: TokenStore;
    /**
     * Exchanges the refresh cookie for a fresh access token, returning it.
     *
     * Supplied by the caller because the refresh endpoint answers with a cookie,
     * and cookie handling is the single largest behavioural difference between
     * the three hosts.
     */
    refresh?: () => Promise<string | null>;
    /**
     * The error vocabulary this client was compiled against.
     *
     * Required rather than defaulted, because the alternative to naming it is a
     * client that silently recognises nothing. Recognition is relative to what
     * shipped: a code minted after this build is carried and reported with
     * `recognised: false`, never dropped and never a parse failure.
     */
    codes: OpenCodec;
};
/**
 * A request that did not succeed.
 *
 * `code` is what a caller branches on and it is deliberately a {@link ParsedCode}
 * rather than a string union: a client compiled against an older contract has to
 * be able to receive a code minted after it shipped, carry it, and log it. The
 * server's prose lands in `message`, which is for a human and never for a
 * condition.
 */
export declare class RestError extends Error {
    readonly status: number;
    readonly code: ParsedCode | null;
    constructor(status: number, code: ParsedCode | null, message: string);
}
export declare class RestClient {
    private readonly options;
    /** One generated, typed method for every operation in the pinned REST description. */
    readonly endpoints: RestApi;
    constructor(options: RestClientOptions);
    /**
     * Sends one request and returns its parsed body, or `null` when there is
     * none.
     *
     * `null` rather than `undefined` or a thrown parse error: since the success
     * bodies were reduced to a status, most mutations answer 204, and a binding
     * that assumed a body would now throw on every one of them.
     */
    request<T>(path: string, init?: {
        method?: string;
        body?: unknown;
        contentType?: RestRequestContentType;
        retried?: boolean;
    }): Promise<T | null>;
}
