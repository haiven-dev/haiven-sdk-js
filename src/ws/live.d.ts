import type { ClientFrame, RawServerFrame, SocketLike } from "./protocol.js";
/** `haiven-dev/src/haiven-api`, two repositories up from `haiven-sdk/sdks/js/src/ws`. */
export declare const backendDir: string;
/**
 * Why the live tests may not run here.
 *
 * They are skipped rather than failed when the backend checkout or the Go
 * toolchain is absent: this repository is a spike and its model-driven tests
 * must stay runnable on their own. A skip is reported, never silent.
 */
export declare function liveUnavailable(): Promise<string | undefined>;
type Startup = {
    baseUrl: string;
    wsUrl: string;
    userId: string;
    cognitoSub: string;
    /** The write pump's parked-frame bound, published so tests do not restate it. */
    pendingLimit: number;
};
export declare class LiveFixture {
    readonly info: Startup;
    private readonly child;
    private readonly buildDir;
    private constructor();
    static start(): Promise<LiveFixture>;
    /**
     * A signed access token. `ttl` is a Go duration; negative values are the
     * point of the endpoint — see the note at the top of this file.
     */
    token(ttl?: string): Promise<string>;
    /** Publish a server-originated frame to this fixture's user. */
    push(frame: {
        type: string;
        payload?: unknown;
        count?: number;
    }): Promise<void>;
    /** A `SocketLike` over a real WebSocket to the fixture. */
    socket(): NodeSocket;
    /** A raw transcript client, for assertions that must not run through `Session`. */
    client(): Promise<LiveClient>;
    stop(): Promise<void>;
}
/**
 * `SocketLike` over Node's global `WebSocket`.
 *
 * The adapter is four assignments, which is itself the finding: the injected
 * transport in `protocol.js` was designed against a browser `WebSocket`, and a
 * runtime that ships the same interface needs no shim at all.
 */
export declare class NodeSocket implements SocketLike {
    onmessage: ((event: {
        data: string;
    }) => void) | null;
    onclose: ((event: {
        code: number;
        reason: string;
    }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    /**
     * Latched, and that is not optional.
     *
     * `Session` attaches its handlers in its constructor, which runs after the
     * socket was created — and a real socket can already be open by then. A
     * browser-style `onopen` is edge-triggered and simply loses that, so the
     * session sits in `pending` forever with a live socket underneath it. The
     * model never showed this because it only fires `open()` when a test says so.
     *
     * Every binding that injects its transport has to solve this, in whatever
     * the local idiom is. It belongs in the conformance corpus.
     */
    get onopen(): (() => void) | null;
    set onopen(handler: (() => void) | null);
    private readonly ws;
    private openHandler;
    private isOpen;
    constructor(url: string);
    send(data: string): void;
    close(code?: number, reason?: string): void;
}
export type CloseInfo = {
    code: number;
    reason: string;
};
/**
 * A socket that records the transcript and hands frames back one at a time.
 *
 * `Session` re-authenticates the moment it sees `auth.expired`, which is the
 * right client behaviour and the wrong instrument for measuring what the server
 * sent: the reply races the next assertion. Scenarios about server output use
 * this instead.
 */
export declare class LiveClient {
    readonly frames: RawServerFrame[];
    readonly opened: Promise<void>;
    private readonly ws;
    /**
     * Frames that have arrived but not yet been read by `next`/`until`.
     *
     * Kept apart from `frames` because a real socket delivers whenever it likes:
     * two frames written back to back arrive in one turn of the event loop, and a
     * reader that only ever waits for the *next* arrival misses the second one
     * and then blocks forever. The model never showed this either.
     */
    private readonly unread;
    private readonly waiting;
    private closeInfo;
    private resolveClosed;
    readonly closed: Promise<CloseInfo>;
    constructor(url: string);
    send(frame: ClientFrame): void;
    /** The next unread frame, in arrival order. */
    next(timeoutMs?: number): Promise<RawServerFrame>;
    /** Frames until one satisfies `match`, inclusive. Fails rather than hangs. */
    until(match: (frame: RawServerFrame) => boolean, timeoutMs?: number): Promise<RawServerFrame>;
    /**
     * Wait `ms` for the socket to go quiet, then report what arrived during the
     * wait. Used to assert an *absence* — the only way to show a frame was never
     * processed is to wait and find nothing.
     *
     * Prefer reading `frames` after this returns when the frames of interest may
     * have arrived before the call.
     */
    quiesce(ms?: number): Promise<RawServerFrame[]>;
    /** Forget everything received so far, log and unread queue alike. */
    reset(): void;
    get closeCode(): number | undefined;
    close(): void;
}
export {};
