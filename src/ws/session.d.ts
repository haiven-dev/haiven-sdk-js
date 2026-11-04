import type { ClientFrame, DroppedFrames, ServerFrame, SocketLike } from "./protocol.js";
export type SessionState = "pending" | "authenticated" | "expired" | "closed";
export type SessionEvent = {
    kind: "state";
    from: SessionState;
    to: SessionState;
} | {
    kind: "frame";
    frame: ServerFrame;
}
/**
 * The session expired. `resending` is what the client resends *blind*, which
 * on a server that passes auth-control frames through is empty: every request
 * the server actually refused is named individually (F11).
 */
 | {
    kind: "expired";
    resending: readonly ClientFrame[];
}
/**
 * One request the server refused because the session had lapsed, named by the
 * `auth.expired` that answered it. This is the correlated notice, and it now
 * arrives at the moment it happens rather than after the recovery.
 */
 | {
    kind: "dropped-request";
    requestId: string;
    frame?: ClientFrame;
}
/**
 * The refresh itself failed — a revoked or malformed token, not an ordinary
 * lapse. Retrying will not fix it, so the binding stops and hands it up.
 */
 | {
    kind: "refresh-failed";
    code: ServerFrame["error"];
}
/** The server's report of frames it could not hold. Only from a parking backend. */
 | {
    kind: "dropped-report";
    report: DroppedFrames;
}
/**
 * The loss report named fewer requests than it dropped, so the ids it did
 * name are a sample and the rest are unrecoverable. `resending` is what goes
 * back blind — the one case where that is still the correct policy, and the
 * reason the report says so rather than leaving a binding to guess (F12).
 */
 | {
    kind: "resending-blind";
    resending: readonly ClientFrame[];
};
export type SessionOptions = {
    socket: SocketLike;
    token: () => string;
    /** Codes this build has logic for. Recognition only — see wire/code.js. */
    vocabulary?: Iterable<string>;
    /** Injected so tests are deterministic; browsers get `crypto.randomUUID`. */
    requestId?: () => string;
};
export declare class Session {
    private readonly socket;
    private readonly token;
    private readonly nextRequestId;
    private readonly codec;
    private stateValue;
    /**
     * FORCED. The socket is writable before it is usable — the server accepts
     * the TCP/WS upgrade, then reads exactly one frame and requires it to be
     * `auth` (conn.go:92, 286-310). Anything a caller sends in that window would
     * be consumed as the handshake, so the binding cannot pass writes straight
     * through and must own a queue. Every target language pays for this.
     */
    private readonly pending;
    /**
     * Requests held for resend after re-auth, because the server refused them and
     * the caller was told they were accepted.
     *
     * It used to hold *everything* in flight, because the server named none of
     * them. It now holds exactly what the server named — see `handleExpired`.
     */
    private readonly awaitingResend;
    readonly events: SessionEvent[];
    constructor(options: SessionOptions);
    get state(): SessionState;
    /** Requests the caller made that the server accepted and then discarded. */
    get droppedRequests(): readonly ClientFrame[];
    /**
     * Closes the socket deliberately.
     *
     * The session reaches `closed` on its own when the peer goes away, which is
     * how every test here had driven it — but a caller tearing down needs to be
     * able to say so, and until this existed the only way out was to reach past
     * the session for a socket it owns.
     *
     * Idempotent, because teardown paths run twice: a component unmounting after
     * the server has already hung up would otherwise send a close frame into a
     * dead socket. The state transition happens here rather than waiting for the
     * `onclose` echo, so a `send` immediately after this throws instead of
     * queueing into a socket nobody will flush.
     */
    close(code?: number, reason?: string): void;
    send(type: string, payload?: unknown): ClientFrame;
    private authenticate;
    private receive;
    /**
     * A reply closes out the request it names.
     *
     * This used to be missing and cost nothing visible, because `inFlight` was
     * read only by `handleExpired`, which looks up one id at a time. `truncated`
     * reads the whole map — it asks for everything still unanswered — so a map
     * that never forgot an answered request would resend requests the server had
     * already handled. That is a worse duplication than the blind resend F11
     * removed, and it would be silent.
     */
    private settle;
    /**
     * FORCED, and the shape of this changed twice.
     *
     * `auth.expired` arrives in two shapes and `requestId` tells them apart: the
     * read loop's answer echoes the client's id, the write pump's announcement
     * leaves it empty. Read as source that looked like a discriminator; F9 found
     * it was not observable, because the read loop wrote through the same pump
     * that replaced it. F11 fixed that server-side, so both shapes now reach the
     * client and the discriminator is real.
     *
     * Two consequences for a binding, and they run opposite ways:
     *
     * - **Either shape has to drive the state machine.** A client that is
     *   actively sending sees only correlated frames — nothing is being pushed to
     *   it, so the pump never announces. Treating only the empty shape as the
     *   expiry signal leaves that client waiting on a socket that will refuse
     *   everything it sends.
     * - **Only what the server named is resent.** A request refused after the
     *   lapse is answered by name. A request the server accepted *before* it has
     *   its reply parked and replayed after the re-auth, so resending it would
     *   duplicate it. The blind resend is gone, and with it the choice between
     *   losing a request and duplicating one.
     *
     * Overflow used to escape both of those: `auth.expired.dropped` reported
     * counts and types and no ids, so past the pump's bound a client was back to
     * the blind resend. `handleDropped` is the other half now (F12).
     */
    private handleExpired;
    /**
     * The overflow half of the expiry.
     *
     * A frame the pump parks is replayed, so it costs the client nothing. A frame
     * the *bound* discards is gone, and if it was a reply the request behind it
     * will never be answered. `requestIds` names those, so they can be resent by
     * name for the same reason a correlated `auth.expired` can — and an id the
     * report does not name must NOT be resent, because it is either still parked
     * or was never dropped, and resending it would duplicate it.
     *
     * FORCED, and it is the timing rather than the payload that forces it: this
     * frame arrives *after* the `auth.success` that ended the episode, because
     * the server writes it at the head of the replay. So `flush` has already run
     * and the queue it drains is empty — anything recovered here has to go back
     * out immediately rather than wait for a re-auth that has already happened.
     * A binding that only re-queues loses exactly the requests this frame exists
     * to save.
     *
     * `truncated` is the one branch that keeps the blind resend, and having the
     * server say so is the difference between a bounded policy and an invented
     * one: without the flag a client cannot tell a complete list from a sample,
     * so it would have to distrust every list it ever received.
     */
    private handleDropped;
    /**
     * Sends recovered requests now if the session is usable again, and holds them
     * for the next `auth.success` if it is not.
     */
    private requeue;
    private handleClose;
    private flush;
    private readonly inFlight;
    private write;
    private transition;
}
