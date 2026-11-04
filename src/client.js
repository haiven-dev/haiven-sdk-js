// One entry point over both cores.
//
// The two transports were bound separately and each is complete on its own:
// `rest/client.js` speaks the REST surface, `ws/session.js` speaks the socket.
// Assembling them is not packaging convenience — it is the point where the fork
// this SDK exists to remove actually gets removed.
//
// `packages/app` and `apps/mobile` each wire a REST client and a socket
// separately, and each keeps the access token in its own place. That is the
// shape of `#mobileclientfix`: not one bug, but two token lifecycles that have
// to be kept in step by hand, in two codebases, with nothing failing when they
// drift. The socket authenticates with whatever token it was handed at
// construction; the REST client refreshes on a 401 and writes a new one. Nothing
// tells the socket. It keeps sending the token it was born with until the server
// expires the session out from under it, and the reconnect is what makes it look
// like a network problem.
//
// So the entry point owns ONE `TokenStore` and both cores read through it. The
// socket reads it per-frame rather than holding a copy (`token: () => ...`),
// which is why a REST refresh is visible to the socket without any wiring
// between them. That is the whole reason this file is not two constructors in a
// trench coat.
//
// The three injections F17 forced stay injections. They are host differences,
// not preferences: `fetch` (Electron main has no `window`, React Native's global
// is not the DOM one), token storage (`localStorage` vs `AsyncStorage` vs
// neither), and `baseUrl` (`packages/app` hardcodes a RELATIVE `/v0`, which
// works only same-origin). Defaulting any of them here would make this entry
// point browser-only and re-fork the thing it de-forks.
import { RestClient } from "./rest/client.js";
import { HandoffCoordinator } from "./handoff/core.js";
import { Session } from "./ws/session.js";
import { OpenCodec } from "./wire/code.js";
export { RestClient, RestError } from "./rest/client.js";
export * from "./handoff/index.js";
export * from "./rest/generated.js";
export { Session } from "./ws/session.js";
export { OpenCodec } from "./wire/code.js";
/**
 * A client over both transports, sharing one token and one vocabulary.
 *
 * The socket is opened lazily by {@link connect} rather than in the constructor.
 * Constructing a client is not the same act as opening a connection: the REST
 * surface is usable before any socket exists, sign-in happens over REST, and a
 * socket opened before there is a token to authenticate with is refused by the
 * server on its first frame.
 */
export class HaivenClient {
    rest;
    options;
    codec;
    sessionValue = null;
    constructor(options) {
        this.options = options;
        // One codec for both transports. Two would be two answers to "do we
        // recognise this code", and the interesting failure is when they differ.
        this.codec = new OpenCodec(options.vocabulary);
        this.rest = new RestClient({
            baseUrl: options.baseUrl,
            fetch: options.fetch,
            tokens: options.tokens,
            refresh: options.refresh,
            codes: this.codec,
        });
    }
    /** The live session, or null before {@link connect} or after {@link close}. */
    get session() {
        return this.sessionValue;
    }
    /**
     * Opens the socket and returns the session.
     *
     * Idempotent: calling it twice returns the same session rather than opening a
     * second socket. The server reads exactly one frame from a new connection and
     * requires it to be `auth`, so a stray second socket is not a duplicate — it
     * is a second handshake against the same account.
     */
    connect() {
        if (this.sessionValue)
            return this.sessionValue;
        this.sessionValue = new Session({
            socket: this.options.connect(this.options.socketUrl),
            // Read through, never captured. This is the line that keeps a REST
            // refresh visible to the socket.
            token: () => this.options.tokens.read() ?? "",
            vocabulary: this.options.vocabulary,
            requestId: this.options.requestId,
        });
        return this.sessionValue;
    }
    /**
     * Creates a game-login handoff that writes into this client's token store.
     * REST requests and an already-open socket therefore observe the exchanged
     * credential without a second synchronization path.
     */
    createHandoff(options) {
        return new HandoffCoordinator(this.rest, this.options.tokens, options);
    }
    /**
     * Closes the socket if one is open, and forgets it.
     *
     * Leaves the token alone. Closing a connection is not signing out, and a
     * client that cleared the token here would make an ordinary teardown look
     * like a session ending.
     */
    close(code, reason) {
        this.sessionValue?.close(code, reason);
        this.sessionValue = null;
    }
}
