// The client half: a session over a socket that is connected before it is
// usable, and that can be un-authenticated again without disconnecting.
//
// This is the part the plan says has to be hand-written four times. It is also
// the part with no schema, so everything here is a decision the binding author
// makes rather than one a generator makes for them. Each decision that was
// forced by the protocol rather than chosen is marked FORCED, and those are the
// findings.

import {
	AUTH,
	AUTH_EXPIRED,
	AUTH_EXPIRED_DROPPED,
	AUTH_FAILURE,
	AUTH_SUCCESS,
	isReply,
} from "./protocol.ts"
import type {
	ClientFrame,
	DroppedFrames,
	RawServerFrame,
	ServerFrame,
	SocketLike,
} from "./protocol.ts"
import { OpenCodec } from "../wire/code.ts"
import { DecodeError, decodeJson } from "../wire/json.ts"
import type { DecodeErrorCode } from "../wire/json.ts"

export type SessionState =
	| "pending" // socket open, auth frame not yet answered
	| "authenticated"
	| "expired" // still connected; the server refuses everything until re-auth
	| "closed"

export type SessionEvent =
	| { kind: "state"; from: SessionState; to: SessionState }
	| { kind: "frame"; frame: ServerFrame }
	/**
	 * The session expired. `resending` is what the client resends *blind*, which
	 * on a server that passes auth-control frames through is empty: every request
	 * the server actually refused is named individually (F11).
	 */
	| { kind: "expired"; resending: readonly ClientFrame[] }
	/**
	 * One request the server refused because the session had lapsed, named by the
	 * `auth.expired` that answered it. This is the correlated notice, and it now
	 * arrives at the moment it happens rather than after the recovery.
	 */
	| { kind: "dropped-request"; requestId: string; frame?: ClientFrame }
	/**
	 * The refresh itself failed — a revoked or malformed token, not an ordinary
	 * lapse. Retrying will not fix it, so the binding stops and hands it up.
	 */
	| { kind: "refresh-failed"; code: ServerFrame["error"] }
	/** The server's report of frames it could not hold. Only from a parking backend. */
	| { kind: "dropped-report"; report: DroppedFrames }
	/**
	 * The loss report named fewer requests than it dropped, so the ids it did
	 * name are a sample and the rest are unrecoverable. `resending` is what goes
	 * back blind — the one case where that is still the correct policy, and the
	 * reason the report says so rather than leaving a binding to guess (F12).
	 */
	| { kind: "resending-blind"; resending: readonly ClientFrame[] }
	/**
	 * A frame this SDK refused to decode, for example one carrying an integer
	 * beyond 2^53 - 1 that `JSON.parse` would round (`integer_precision_exceeded`).
	 * The frame is not delivered and the session stays open; `code` is finite and
	 * SDK-local, never a server code.
	 */
	| { kind: "decode-error"; code: DecodeErrorCode; message: string }

/**
 * What a socket close means for the credential that opened it. Finite and
 * SDK-local: the server sends a close code and a reason string, and this is the
 * part of them a game acts on.
 *
 * - `transport`: the connection ended for a reason unrelated to the credential
 *   (network loss, a server restart, the caller's own close). The credential is
 *   still good, and a new socket may authenticate with it, with no new sign-in.
 * - `credential_refused`: `1008 unauthorized`, the server refused the credential
 *   in the handshake (SDK-SESSION-5).
 * - `credential_revoked`: `1008 credential_revoked`, the player or an operator
 *   revoked the game credential while the socket was open (haiven-api
 *   `docs/features/websocket.md`, Game sockets).
 * - `policy`: any other `1008`, for example `parental_consent_denied` or a
 *   contract the server does not serve. The server refused this socket for a
 *   reason a new socket with the same credential does not change.
 */
export type SessionCloseKind = "transport" | "credential_refused" | "credential_revoked" | "policy"

/** How a session's socket closed: the server's code and reason, and what they mean. */
export type SessionClose = {
	code: number
	reason: string
	kind: SessionCloseKind
}

/** `websocket.StatusPolicyViolation`: every close the server makes on purpose. */
const POLICY_VIOLATION = 1008

/**
 * Classifies a close by its code and reason alone, so every binding reaches the
 * same answer for the same close.
 */
export function classifyClose(code: number, reason: string): SessionCloseKind {
	if (code !== POLICY_VIOLATION) return "transport"
	switch (reason) {
		case "unauthorized":
			return "credential_refused"
		case "credential_revoked":
			return "credential_revoked"
		default:
			return "policy"
	}
}

/**
 * True when the credential will not authenticate again: discard it and run the
 * game login handoff before opening another socket. A reconnect with it would
 * only be refused again.
 */
export function closeRequiresSignIn(kind: SessionCloseKind): boolean {
	return kind === "credential_refused" || kind === "credential_revoked"
}

/**
 * True when a new socket may authenticate with the same credential. Only a
 * transport close qualifies; reconnecting after any `1008` repeats the refusal.
 */
export function closeMayReconnect(kind: SessionCloseKind): boolean {
	return kind === "transport"
}

export type SessionOptions = {
	socket: SocketLike
	token: () => string
	/** Codes this build has logic for. Recognition only — see wire/code.ts. */
	vocabulary?: Iterable<string>
	/** Injected so tests are deterministic; browsers get `crypto.randomUUID`. */
	requestId?: () => string
	/**
	 * Receives every event as it happens.
	 *
	 * A host needs a subscription, not a transcript. `events` is what a test
	 * reads afterwards; an application dispatching frames into its own state has
	 * nothing to poll and no moment at which to poll it. This was the first thing
	 * `packages/app` needed that the binding did not have.
	 */
	onEvent?: (event: SessionEvent) => void
	/**
	 * Whether `events` keeps the transcript. On by default for the tests that
	 * read it; a long-lived session with an `onEvent` sink turns it off, because
	 * otherwise the array grows for the life of the connection.
	 */
	retainEvents?: boolean
}

let counter = 0
const defaultRequestId = () => `req-${++counter}`

export class Session {
	private readonly socket: SocketLike
	private readonly token: () => string
	private readonly nextRequestId: () => string
	private readonly codec: OpenCodec

	private stateValue: SessionState = "pending"
	private closeValue: SessionClose | undefined

	/**
	 * FORCED. The socket is writable before it is usable — the server accepts
	 * the TCP/WS upgrade, then reads exactly one frame and requires it to be
	 * `auth` (conn.go:92, 286-310). Anything a caller sends in that window would
	 * be consumed as the handshake, so the binding cannot pass writes straight
	 * through and must own a queue. Every target language pays for this.
	 */
	private readonly pending: ClientFrame[] = []

	/**
	 * Requests held for resend after re-auth, because the server refused them and
	 * the caller was told they were accepted.
	 *
	 * It used to hold *everything* in flight, because the server named none of
	 * them. It now holds exactly what the server named — see `handleExpired`.
	 */
	private readonly awaitingResend: ClientFrame[] = []

	readonly events: SessionEvent[] = []
	private readonly onEvent: ((event: SessionEvent) => void) | undefined
	private readonly retainEvents: boolean

	constructor(options: SessionOptions) {
		this.socket = options.socket
		this.token = options.token
		this.nextRequestId = options.requestId ?? defaultRequestId
		this.codec = new OpenCodec(options.vocabulary ?? [])
		this.onEvent = options.onEvent
		this.retainEvents = options.retainEvents ?? true

		this.socket.onopen = () => this.authenticate()
		this.socket.onmessage = (event) => this.receive(event.data)
		this.socket.onclose = (event) => this.handleClose(event)
	}

	get state(): SessionState {
		return this.stateValue
	}

	/**
	 * How the socket closed, once the session is `closed`. Set before the state
	 * change is announced, so a `closed` state handler can read it. A close the
	 * caller made through {@link close} is a `transport` close.
	 */
	get lastClose(): SessionClose | undefined {
		return this.closeValue
	}

	/** Requests the caller made that the server accepted and then discarded. */
	get droppedRequests(): readonly ClientFrame[] {
		return this.awaitingResend
	}

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
	close(code?: number, reason?: string): void {
		if (this.stateValue === "closed") return

		this.closeValue = { code: code ?? 1000, reason: reason ?? "", kind: "transport" }
		this.transition("closed")
		this.socket.close(code, reason)
	}

	send(type: string, payload?: unknown): ClientFrame {
		const frame: ClientFrame = { type, requestId: this.nextRequestId(), payload }

		if (this.stateValue === "authenticated") {
			this.write(frame)
		} else if (this.stateValue === "closed") {
			throw new Error("session is closed")
		} else {
			// pending or expired: the server would either eat this as the
			// handshake or reject and discard it.
			this.pending.push(frame)
		}
		return frame
	}

	private authenticate(): void {
		this.write({ type: AUTH, requestId: this.nextRequestId(), payload: this.token() })
	}

	private receive(data: string): void {
		let raw: RawServerFrame
		try {
			raw = decodeJson(data) as RawServerFrame
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error
			this.emit({ kind: "decode-error", code: error.code, message: error.message })
			return
		}
		// Spread-then-overwrite would add an explicit `error: undefined` to every
		// success frame, which is not what arrived. Frames are compared field by
		// field in tests and forwarded to callers, so the absent field has to
		// stay absent.
		const frame: ServerFrame = { ...raw, error: undefined }
		if (raw.error === undefined) delete frame.error
		else frame.error = this.codec.parse(raw.error)
		this.emit({ kind: "frame", frame })

		switch (frame.type) {
			case AUTH_SUCCESS:
				// FORCED. This cannot be correlated by requestId. The handshake
				// reply hard-codes `requestId: ""` while the re-auth reply echoes
				// it, so the same frame type is correlatable in one case and not
				// the other. A binding that routes every response through a
				// pending-request map has to special-case this one, or it leaks
				// the auth request forever.
				//
				// It also need not be the first one. A backend that parks
				// outbound frames replays the handshake `auth.success` after the
				// re-auth `auth.success` that released it, so an already-
				// authenticated session sees a second one. Transitioning to the
				// state it is already in has to be a no-op.
				this.transition("authenticated")
				this.flush()
				return

			case AUTH_FAILURE:
				// Only reachable on a live socket. The identical failure during
				// the handshake arrives as a close frame instead.
				//
				// This was unreachable on an expired session until F11: the pump
				// replaced it with another auth.expired, so a client whose refresh
				// token had been revoked saw only more lapse notices and retried
				// against a token that would never work again. Now it arrives, and
				// the binding stops retrying and hands it up — the one failure a
				// client has to act on differently is finally distinguishable from
				// the one it can recover from on its own.
				this.emit({ kind: "refresh-failed", code: frame.error })
				this.transition("expired")
				return

			case AUTH_EXPIRED:
				this.handleExpired(frame)
				return

			case AUTH_EXPIRED_DROPPED:
				this.handleDropped(frame)
				return

			default:
				this.settle(raw)
				return
		}
	}

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
	private settle(raw: RawServerFrame): void {
		if (!isReply(raw) || raw.requestId === "") return

		this.inFlight.delete(raw.requestId)
	}

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
	private handleExpired(frame: ServerFrame): void {
		const correlated = frame.requestId !== undefined && frame.requestId !== ""

		if (correlated) {
			const requestId = frame.requestId as string
			const refused = this.inFlight.get(requestId)
			this.inFlight.delete(requestId)
			if (refused !== undefined) this.awaitingResend.push(refused)

			this.emit({ kind: "dropped-request", requestId, frame: refused })
		}

		// One re-auth per episode. The server announces once, but a client sending
		// several frames into a lapsed session is answered once per frame.
		if (this.stateValue === "expired") return

		this.emit({ kind: "expired", resending: [] })

		this.transition("expired")
		// Re-auth on the *same* socket; the server never asked for a
		// reconnect and a binding that reconnects here pays for a new
		// handshake, loses the receive window, and re-subscribes for nothing.
		this.authenticate()
	}

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
	private handleDropped(frame: ServerFrame): void {
		const report = frame.payload as DroppedFrames

		this.emit({ kind: "dropped-report", report })

		const named: ClientFrame[] = []
		for (const requestId of report.requestIds ?? []) {
			const refused = this.inFlight.get(requestId)
			this.inFlight.delete(requestId)
			if (refused !== undefined) named.push(refused)

			this.emit({ kind: "dropped-request", requestId, frame: refused })
		}

		// Read the remainder before resending anything: a resend goes back into
		// `inFlight` — it is genuinely in flight again — so a named request would
		// otherwise be swept up by the fallback below and sent a second time.
		const suspect = report.truncated === true ? [...this.inFlight.values()] : []
		if (suspect.length > 0) this.inFlight.clear()

		this.requeue(named)

		if (report.truncated !== true) return

		this.emit({ kind: "resending-blind", resending: suspect })
		this.requeue(suspect)
	}

	/**
	 * Sends recovered requests now if the session is usable again, and holds them
	 * for the next `auth.success` if it is not.
	 */
	private requeue(frames: readonly ClientFrame[]): void {
		if (this.stateValue !== "authenticated") {
			this.awaitingResend.push(...frames)
			return
		}

		for (const frame of frames) this.write(frame)
	}

	private handleClose(event: { code: number; reason: string }): void {
		// A failed handshake surfaces only here, as code 1008 with the reason
		// string `unauthorized` — there is no `auth.failure` frame on that path.
		// A revoked game credential closes an open socket with 1008
		// `credential_revoked`. The kind tells the two apart from a dropped
		// connection, which is the only close a reconnect can recover from.
		if (this.stateValue === "closed") return

		this.closeValue = { code: event.code, reason: event.reason, kind: classifyClose(event.code, event.reason) }
		this.transition("closed")
	}

	private flush(): void {
		const queued = [...this.awaitingResend, ...this.pending]
		this.awaitingResend.length = 0
		this.pending.length = 0
		for (const frame of queued) this.write(frame)
	}

	private readonly inFlight = new Map<string, ClientFrame>()

	private write(frame: ClientFrame): void {
		if (frame.type !== AUTH) this.inFlight.set(frame.requestId, frame)
		this.socket.send(JSON.stringify(frame))
	}

	private transition(to: SessionState): void {
		if (this.stateValue === to) return
		const from = this.stateValue
		// State first, then the event: a sink that sends on `authenticated` must
		// find the session already there, or its write lands in the pending queue
		// it is about to flush.
		this.stateValue = to
		this.emit({ kind: "state", from, to })
	}

	private emit(event: SessionEvent): void {
		if (this.retainEvents) this.events.push(event)
		this.onEvent?.(event)
	}
}
