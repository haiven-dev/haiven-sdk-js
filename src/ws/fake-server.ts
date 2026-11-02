// A model of the DEPLOYED server's socket behaviour.
//
// Source: backend/internal/platform/websocket/{conn,manager,router}.go @
// origin/main e7d8329. It is deliberately not the branch: `fix/ws-expired-
// message-loss` changes the expired-session paths substantially and is not
// merged, so modelling it here would make the spike describe behaviour that is
// not deployed anywhere. The live suite (`test/live.test.ts`) covers both.
//
// Every branch below is now backed by a transcript from
// `the websocket fixture`, which runs the real stack over a real socket — see
// F9. Where this file and that transcript once disagreed, this file was the
// bug: it modelled the read loop and the write pump as independent, and they
// are not. Every frame the read loop writes goes through the pump.
//
// Where the model and the backend disagree, the backend is right and this file
// is a bug. Re-derive it by running the live suite, not by adjusting it until
// tests pass.

import {
	AUTH,
	AUTH_EXPIRED,
	AUTH_EXPIRED_DROPPED,
	AUTH_FAILURE,
	AUTH_SUCCESS,
} from "./protocol.ts"
import type { ClientFrame, DroppedFrames, RawServerFrame, SocketLike } from "./protocol.ts"

/** `websocket.StatusPolicyViolation` — the close code used for a rejected handshake. */
export const STATUS_POLICY_VIOLATION = 1008

/**
 * What a client sees when the handshake read deadline elapses with no frame:
 * the server cancels the read context and the socket dies without a close
 * handshake. Measured at ~5s, close code 1006, no reason. There is no server
 * close frame on this path, so it is *not* 1008.
 */
export const STATUS_ABNORMAL_CLOSURE = 1006

export type FakeToken = {
	value: string
	userId: string
	/** Whether the verifier accepts it at all. */
	valid: boolean
	/** Whether the session it mints is already past its expiry. */
	expired?: boolean
}

export type FakeServerOptions = {
	tokens: readonly FakeToken[]
	/** Frame types the per-route token bucket should reject. */
	rateLimited?: ReadonlySet<string>
	/**
	 * Message types the router has a handler for. Only `ping` is registered by
	 * `websocket.NewRouter`; everything else is mounted by the API layer.
	 */
	routes?: ReadonlySet<string>
	/**
	 * Message types the router accepts but whose handler does not answer inline.
	 *
	 * The model collapses dispatch into an immediate reply; the real router does
	 * not. A handler that does work answers after the read loop has moved on, and
	 * that gap is the only way a reply can meet a session that lapsed after the
	 * request was accepted — the case parking exists for, and the case the loss
	 * report is about. A deferred frame is held until `answerDeferred` runs it.
	 */
	deferred?: ReadonlySet<string>
}

type ServerSession = { userId: string; expired: boolean }

/**
 * A `SocketLike` whose peer behaves like the backend's read loop and write
 * pump. Frames are delivered synchronously so tests read as a transcript.
 */
export class FakeServerSocket implements SocketLike {
	onmessage: ((event: { data: string }) => void) | null = null
	onclose: ((event: { code: number; reason: string }) => void) | null = null
	onerror: ((event: unknown) => void) | null = null
	onopen: (() => void) | null = null

	/** Every frame the client sent, in order — the client half of the transcript. */
	readonly sent: ClientFrame[] = []

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
	readonly droppedOutbound: RawServerFrame[] = []

	/**
	 * Client frames the read loop accepted, answered with `auth.expired`, and
	 * then abandoned via `continue`. The answer never reaches the client (it is
	 * in `droppedOutbound`), so from the client's side these vanish without any
	 * correlated acknowledgement at all.
	 */
	readonly droppedInbound: ClientFrame[] = []

	private readonly options: FakeServerOptions
	private readonly routes: ReadonlySet<string>
	private session: ServerSession | null = null
	private closed = false

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
	private readonly outbox: RawServerFrame[] = []
	private stepDepth = 0
	private draining = false

	/** Requests the router accepted whose handler has not answered yet. */
	private readonly held: ClientFrame[] = []

	constructor(options: FakeServerOptions) {
		this.options = options
		this.routes = options.routes ?? new Set(["ping"])
	}

	open(): void {
		this.onopen?.()
	}

	send(data: string): void {
		if (this.closed) return
		const frame = JSON.parse(data) as ClientFrame
		this.sent.push(frame)

		this.step(() => {
			if (this.session === null) {
				this.handshake(frame)
				return
			}
			this.readLoop(frame)
		})
	}

	/** Run one server step, then write whatever it produced. */
	private step(fn: () => void): void {
		this.stepDepth++
		try {
			fn()
		} finally {
			this.stepDepth--
			if (this.stepDepth === 0) this.drain()
		}
	}

	private drain(): void {
		// A client that sends from `onmessage` re-enters here. Let the outer loop
		// keep ownership; its queue already holds the new frames.
		if (this.draining) return
		this.draining = true
		try {
			while (this.outbox.length > 0) {
				const frame = this.outbox.shift() as RawServerFrame
				if (this.closed) return
				this.onmessage?.({ data: JSON.stringify(frame) })
			}
		} finally {
			this.draining = false
		}
	}

	close(code = 1000, reason = ""): void {
		if (this.closed) return
		this.closed = true
		this.onclose?.({ code, reason })
	}

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
	private handshake(frame: ClientFrame): void {
		const token = this.resolve(frame)

		if (frame.type !== AUTH || token === undefined || !token.valid) {
			this.close(STATUS_POLICY_VIOLATION, "unauthorized")
			return
		}

		this.session = { userId: token.userId, expired: token.expired ?? false }

		// requestId is hard-coded to "", discarding whatever the client sent on
		// the auth frame it is answering.
		//
		// auth.success has to mean the session is usable, and a token past its
		// exp but inside the verifier's leeway completes this handshake into a
		// session that is already expired. The pump used to cover that by
		// accident, replacing the reply; now that auth-control frames pass
		// through, the read loop answers with the truth instead (F11).
		this.writePump(
			this.session.expired
				? { type: AUTH_EXPIRED, requestId: "", success: false, error: "expired_token" }
				: { type: AUTH_SUCCESS, requestId: "", success: true },
		)

		// Nothing follows the handshake reply. promoteConn used to publish
		// user.connected to `user:<id>` and the manager's own subscriber fanned
		// it back to this socket, so every client got an unsolicited frame before
		// it had asked for anything (F9.2). That is gone (F13): the event is
		// Internal only, and a client learns about a connect from
		// presence.updated, which the presence handler projects from it.
	}

	/** The post-handshake loop. */
	private readLoop(frame: ClientFrame): void {
		const session = this.session
		if (session === null) return

		// The rate-limit gate runs before the expiry gate, and answers with the
		// *client's* frame type rather than an auth type.
		if (this.options.rateLimited?.has(frame.type)) {
			this.writePump({
				type: frame.type,
				requestId: frame.requestId,
				success: false,
				error: "rate_limited",
			})
			return
		}

		// Expiry is evaluated lazily, on the client's next frame.
		if (session.expired || frame.type === AUTH) {
			if (frame.type === AUTH) {
				this.reauth(frame, session)
				return
			}

			// The frame is answered and then dropped. The answer echoes the
			// client's requestId — and is then replaced by the write pump,
			// because the session it is reporting on is the same session the
			// pump refuses to write for. The client never sees this frame.
			this.droppedInbound.push(frame)
			this.writePump({
				type: AUTH_EXPIRED,
				requestId: frame.requestId,
				success: false,
				error: "expired_token",
			})
			return
		}

		this.dispatch(frame)
	}

	/**
	 * The router. Only `ping` is mounted by `NewRouter`; the chat, presence and
	 * notification handlers come from the API layer.
	 *
	 * `pong` is a reply like any other: it echoes the ping's `requestId` and
	 * carries `success`. It used to be written as a bare `{"type":"pong"}` map
	 * — a third envelope, and the one reply on the protocol that could not be
	 * matched to its request (F9, fixed in F10).
	 */
	private dispatch(frame: ClientFrame): void {
		if (!this.routes.has(frame.type)) {
			this.writePump({
				type: frame.type,
				requestId: frame.requestId,
				success: false,
				error: "unknown_message_type",
			})
			return
		}

		if (this.options.deferred?.has(frame.type)) {
			this.held.push(frame)
			return
		}

		if (frame.type === "ping") {
			this.writePump({ type: "pong", requestId: frame.requestId, success: true })
			return
		}

		this.writePump({ type: frame.type, requestId: frame.requestId, success: true })
	}

	/** The re-auth branch, reachable only on a live socket. */
	private reauth(frame: ClientFrame, session: ServerSession): void {
		const token = this.resolve(frame)

		if (token === undefined) {
			this.writePump({
				type: AUTH_FAILURE,
				requestId: frame.requestId,
				success: false,
				error: "invalid_payload",
			})
			return
		}
		if (!token.valid) {
			this.writePump({
				type: AUTH_FAILURE,
				requestId: frame.requestId,
				success: false,
				error: "invalid_token",
			})
			return
		}
		if (token.userId !== session.userId) {
			this.writePump({
				type: AUTH_FAILURE,
				requestId: frame.requestId,
				success: false,
				error: "unauthorized",
			})
			return
		}

		// The session is replaced *before* the reply is written, so the reply
		// reports the session the client now has rather than the one it had.
		session.userId = token.userId
		session.expired = token.expired ?? false

		// A refresh can be accepted and resolve nothing: the replacement token
		// verifies inside the leeway while its own exp has already passed. Same
		// rule as the handshake — that is not a success. Unlike the handshake,
		// either answer echoes requestId.
		this.writePump(
			session.expired
				? {
						type: AUTH_EXPIRED,
						requestId: frame.requestId,
						success: false,
						error: "expired_token",
					}
				: { type: AUTH_SUCCESS, requestId: frame.requestId, success: true },
		)
	}

	/**
	 * A server-originated fan-out: a chat message, presence update, or
	 * notification the client did not ask for.
	 */
	push(frame: RawServerFrame): void {
		this.step(() => this.writePump(frame))
	}

	/**
	 * A burst of fan-out reaching the pump before the client can answer any of
	 * it — the shape that produces a run of identical `auth.expired` frames.
	 */
	pushAll(frames: readonly RawServerFrame[]): void {
		this.step(() => {
			for (const frame of frames) this.writePump(frame)
		})
	}

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
	private writePump(frame: RawServerFrame): void {
		if (this.session?.expired && !isAuthControl(frame)) {
			this.droppedOutbound.push(frame)
			this.deliver({
				type: AUTH_EXPIRED,
				requestId: "",
				success: false,
				error: "expired_token",
			})
			return
		}
		this.deliver(frame)
	}

	/**
	 * Run every deferred handler now, oldest request first.
	 *
	 * Called after `expireSession` this is the production shape the loss report
	 * exists for: a request the server accepted while the session was usable,
	 * answered after it was not.
	 */
	answerDeferred(): void {
		this.step(() => {
			for (const frame of this.held.splice(0)) {
				this.writePump({ type: frame.type, requestId: frame.requestId, success: true })
			}
		})
	}

	/**
	 * The loss report a *parking* backend writes at the head of its replay.
	 *
	 * The pump modelled here discards rather than parks, so it has nothing to
	 * report and never produces one on its own — this is a control lever, not
	 * modelled behaviour. It exists because the binding's overflow path has to
	 * stay reachable without a Go toolchain; what the report actually contains is
	 * measured against the real server in live.test.ts.
	 *
	 * It goes through the pump rather than straight to the outbox so it keeps
	 * passing the auth-control check, which is the only reason a client on a
	 * lapsed session can receive it at all.
	 */
	reportDropped(report: DroppedFrames): void {
		this.step(() =>
			this.writePump({
				type: AUTH_EXPIRED_DROPPED,
				requestId: "",
				success: false,
				error: "expired_token",
				payload: report,
			}),
		)
	}

	/** Expire the session without a wall-clock wait. */
	expireSession(): void {
		if (this.session) this.session.expired = true
	}

	private resolve(frame: ClientFrame): FakeToken | undefined {
		if (typeof frame.payload !== "string") return undefined
		return this.options.tokens.find((t) => t.value === frame.payload)
	}

	private deliver(frame: RawServerFrame): void {
		if (this.closed) return
		this.outbox.push(frame)
	}
}

/**
 * The frames the pump must not replace while a session is expired.
 *
 * All four are already about the expiry, so passing them costs nothing the
 * announcement does not already say — and two of them carry the only
 * information a client cannot reconstruct: which request died, and whether the
 * refresh itself is dead.
 */
function isAuthControl(frame: RawServerFrame): boolean {
	return (
		frame.type === AUTH_SUCCESS ||
		frame.type === AUTH_FAILURE ||
		frame.type === AUTH_EXPIRED ||
		frame.type === AUTH_EXPIRED_DROPPED
	)
}
