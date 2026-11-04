import { RestClient, type FetchLike, type TokenStore } from "./rest/client.js";
import { HandoffCoordinator, type HandoffCoordinatorOptions } from "./handoff/core.js";
import { Session, type SessionOptions } from "./ws/session.js";
import type { SocketLike } from "./ws/protocol.js";
export type { FetchLike, ResponseLike, TokenStore } from "./rest/client.js";
export { RestClient, RestError } from "./rest/client.js";
export * from "./handoff/index.js";
export * from "./rest/generated.js";
export { Session } from "./ws/session.js";
export type { SessionEvent, SessionState } from "./ws/session.js";
export type { SocketLike } from "./ws/protocol.js";
export { OpenCodec } from "./wire/code.js";
export type HaivenClientOptions = {
    /**
     * The REST root, including the version prefix — `https://api.haiven.ai/v0`.
     *
     * Explicit for the reason F17 recorded: the relative `/v0` two shipped
     * clients use is not portable off the serving origin.
     */
    baseUrl: string;
    /**
     * The socket URL. Separate from `baseUrl` rather than derived from it,
     * because deriving means guessing a scheme swap and a path, and a deployment
     * that terminates the socket somewhere else has no way to say so.
     */
    socketUrl: string;
    fetch: FetchLike;
    /**
     * Where the access token lives. Read by both transports, written by the
     * refresh — this single store is the reason the entry point exists.
     */
    tokens: TokenStore;
    /**
     * Exchanges the refresh cookie for a fresh access token.
     *
     * Injected because the refresh endpoint answers with a cookie, and cookie
     * handling is the largest behavioural difference between the three hosts.
     */
    refresh?: () => Promise<string | null>;
    /**
     * Opens a socket to `socketUrl`.
     *
     * A factory rather than a socket, because the session is not the only thing
     * that ever needs a new one — a reconnect needs a second socket, and handing
     * this client a live one would make reconnection the caller's problem again.
     */
    connect: (url: string) => SocketLike;
    /**
     * The wire vocabulary this build was compiled against.
     *
     * Required, never defaulted. Recognition is relative to what shipped, and the
     * alternative to naming it is a client that silently recognises nothing. A
     * code minted after this build is carried with `recognised: false` — never
     * dropped, never a parse failure.
     */
    vocabulary: Iterable<string>;
    /** Injected so tests are deterministic; hosts pass `crypto.randomUUID`. */
    requestId?: SessionOptions["requestId"];
};
/**
 * A client over both transports, sharing one token and one vocabulary.
 *
 * The socket is opened lazily by {@link connect} rather than in the constructor.
 * Constructing a client is not the same act as opening a connection: the REST
 * surface is usable before any socket exists, sign-in happens over REST, and a
 * socket opened before there is a token to authenticate with is refused by the
 * server on its first frame.
 */
export declare class HaivenClient {
    readonly rest: RestClient;
    private readonly options;
    private readonly codec;
    private sessionValue;
    constructor(options: HaivenClientOptions);
    /** The live session, or null before {@link connect} or after {@link close}. */
    get session(): Session | null;
    /**
     * Opens the socket and returns the session.
     *
     * Idempotent: calling it twice returns the same session rather than opening a
     * second socket. The server reads exactly one frame from a new connection and
     * requires it to be `auth`, so a stray second socket is not a duplicate — it
     * is a second handshake against the same account.
     */
    connect(): Session;
    /**
     * Creates a game-login handoff that writes into this client's token store.
     * REST requests and an already-open socket therefore observe the exchanged
     * credential without a second synchronization path.
     */
    createHandoff(options: HandoffCoordinatorOptions): HandoffCoordinator;
    /**
     * Closes the socket if one is open, and forgets it.
     *
     * Leaves the token alone. Closing a connection is not signing out, and a
     * client that cleared the token here would make an ordinary teardown look
     * like a session ending.
     */
    close(code?: number, reason?: string): void;
}
