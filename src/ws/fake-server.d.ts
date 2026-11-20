import type { ClientFrame, DroppedFrames, RawServerFrame, SocketLike } from "./protocol.js";
/** `websocket.StatusPolicyViolation` — the close code used for a rejected handshake. */
export declare const STATUS_POLICY_VIOLATION = 1008;
/**
 * What a client sees when the handshake read deadline elapses with no frame:
 * the server cancels the read context and the socket dies without a close
 * handshake. Measured at ~5s, close code 1006, no reason. There is no server
 * close frame on this path, so it is *not* 1008.
 */
export declare const STATUS_ABNORMAL_CLOSURE = 1006;
export type FakeToken = {
    value: string;
    userId: string;
    /** Whether the verifier accepts it at all. */
    valid: boolean;
    /** Whether the session it mints is already past its expiry. */
    expired?: boolean;
};
export type FakeServerOptions = {
    tokens: readonly FakeToken[];
    /** Frame types the per-route token bucket should reject. */
    rateLimited?: ReadonlySet<string>;
    /**
     * Message types the router has a handler for. Only `ping` is registered by
     * `websocket.NewRouter`; everything else is mounted by the API layer.
     */
    routes?: ReadonlySet<string>;
    /**
     * Message types the router accepts but whose handler does not answer inline.
     *
     * The model collapses dispatch into an immediate reply; the real router does
     * not. A handler that does work answers after the read loop has moved on, and
     * that gap is the only way a reply can meet a session that lapsed after the
     * request was accepted — the case parking exists for, and the case the loss
     * report is about. A deferred frame is held until `answerDeferred` runs it.
     */
    deferred?: ReadonlySet<string>;
};
/**
 * A `SocketLike` whose peer behaves like the backend's read loop and write
 * pump. Frames are delivered synchronously so tests read as a transcript.
 */
export declare class FakeServerSocket implements SocketLike {
    onmessage: ((event: {
        data: string;
    }) => void) | null;
    onclose: ((event: {
        code: number;
        reason: string;
    }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onopen: (() => void) | null;
    /** Every frame the client sent, in order — the client half of the transcript. */
    readonly sent: ClientFrame[];
    /**
     * Everything the write pump was asked to deliver while the session was
     * expired and replaced with `auth.expired`. Nothing re-queues these, so this
     * is message loss, not a retry buffer.
     *
     * It collects the read loop's own writes too — its `auth.expired` answers,
     * the handshake `auth.success` — because the pump does not distinguish them
     * from a fan-out. That is the correction F9 forced: the read loop cannot
     * reach the client while the session is expired.
     */
    readonly droppedOutbound: RawServerFrame[];
    /**
     * Client frames the read loop accepted, answered with `auth.expired`, and
     * then abandoned via `continue`. The answer never reaches the client (it is
     * in `droppedOutbound`), so from the client's side these vanish without any
     * correlated acknowledgement at all.
     */
    readonly droppedInbound: ClientFrame[];
    private readonly options;
    private readonly routes;
    private session;
    private closed;
    /**
     * Frames the pump has resolved but not yet written.
     *
     * The read loop and the write pump are separate goroutines joined by a
     * channel, so the loop finishes handling a client frame before any of what
     * it wrote reaches the socket. Delivering inline instead let the client
     * react — synchronously, from `onmessage` — in the middle of a server step,
     * and reordered the transcript against the real server. The outbox restores
     * the ordering without making the model asynchronous.
     */
    private readonly outbox;
    private stepDepth;
    private draining;
    /** Requests the router accepted whose handler has not answered yet. */
    private readonly held;
    constructor(options: FakeServerOptions);
    open(): void;
    send(data: string): void;
    /** Run one server step, then write whatever it produced. */
    private step;
    private drain;
    close(code?: number, reason?: string): void;
    /**
     * `readLoop` -> `initAuth` -> `promoteConn`.
     *
     * Two things are absent. There is no `auth.failure` frame on this path:
     * every failure — unparseable payload, wrong frame type, rejected token, or
     * the read deadline — returns an error and the caller closes the socket, so
     * the client learns only the close code.
     *
     * And there is no expiry check. `initAuth` verifies the token and hands back
     * the session; whether that session is already past its `exp` is never
     * consulted here. A token inside the verifier's 30s leeway but past its
     * expiry therefore authenticates into a session that is expired from its
     * first instruction — which is how the live suite reaches these paths
     * without waiting out a real expiry.
     */
    private handshake;
    /** The post-handshake loop. */
    private readLoop;
    /**
     * The router. Only `ping` is mounted by `NewRouter`; the chat, presence and
     * notification handlers come from the API layer.
     *
     * `pong` is a reply like any other: it echoes the ping's `requestId` and
     * carries `success`. It used to be written as a bare `{"type":"pong"}` map
     * — a third envelope, and the one reply on the protocol that could not be
     * matched to its request (F9, fixed in F10).
     */
    private dispatch;
    /** The re-auth branch, reachable only on a live socket. */
    private reauth;
    /**
     * A server-originated fan-out: a chat message, presence update, or
     * notification the client did not ask for.
     */
    push(frame: RawServerFrame): void;
    /**
     * A burst of fan-out reaching the pump before the client can answer any of
     * it — the shape that produces a run of identical `auth.expired` frames.
     */
    pushAll(frames: readonly RawServerFrame[]): void;
    /**
     * The write pump — the single exit from the server, which is the whole point.
     *
     * While the session has expired, *content* heading for the client is replaced
     * by `auth.expired` with an empty `requestId` and then discarded; the
     * original is never re-queued and re-authenticating does not replay it. One
     * replacement is emitted per undeliverable frame, so a burst of fan-out
     * produces a burst of identical, unactionable frames.
     *
     * Auth-control frames pass through (F11). They used to be replaced like
     * everything else — the read loop writes through here too — which made the
     * empty-requestId shape the only `auth.expired` a client could ever observe,
     * and made `auth.failure` unreportable in the one case it mattered.
     */
    private writePump;
    /**
     * Run every deferred handler now, oldest request first.
     *
     * Called after `expireSession` this is the production shape the loss report
     * exists for: a request the server accepted while the session was usable,
     * answered after it was not.
     */
    answerDeferred(): void;
    /**
     * The loss report a *parking* backend writes at the head of its replay.
     *
     * The pump modelled here discards rather than parks, so it has nothing to
     * report and never produces one on its own — this is a control lever, not
     * modelled behaviour. It exists because the binding's overflow path has to
     * stay reachable without a Go toolchain; what the report actually contains is
     * measured against the real server in live.test.js.
     *
     * It goes through the pump rather than straight to the outbox so it keeps
     * passing the auth-control check, which is the only reason a client on a
     * lapsed session can receive it at all.
     */
    reportDropped(report: DroppedFrames): void;
    /** Expire the session without a wall-clock wait. */
    expireSession(): void;
    private resolve;
    private deliver;
}
