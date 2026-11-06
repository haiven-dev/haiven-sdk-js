// The /v0/ws envelope, hand-written.
//
// There is no AsyncAPI document and no JSON Schema for the socket — the only
// machine-readable mention of /ws in the entire generated surface is a single
// Swagger path whose success response is `101 {string} string "Connection
// upgraded to WebSocket"`. Everything below was read out of
// backend/internal/platform/websocket/{handler,conn}.go by hand. That is the
// concrete cost behind the AsyncAPI item in the plan.
//
// That item has since landed: haiven-contracts publishes
// descriptions/websocket/public/gaming/v0/asyncapi.json, and codegen/emit_ws.py
// generates the typed requests and event router in ./generated.ts from it. The
// envelope below stays hand-written because the session that reads it does.

import type { ParsedCode } from "../wire/code.ts"

/** Client -> server. `backend/internal/platform/websocket/handler.go` */
export type ClientFrame = {
	type: string
	requestId: string
	payload?: unknown
}

/**
 * Server -> client: a reply to a frame the client sent.
 *
 * `success` and `requestId` are always present. `requestId` is the id the client
 * supplied; the server substitutes a generated one when the client supplied
 * none, so an SDK should always send one rather than rely on matching what comes
 * back. The empty string is reserved for a server-initiated control frame — the
 * write pump's `auth.expired` answers no request and says so.
 *
 * `pong` is one of these. It used to be a bare `{"type":"pong"}` map, the one
 * reply on the protocol a client could not match to its request (F9, F10).
 */
export type ServerReply = {
	type: string
	requestId: string
	success: boolean
	payload?: unknown
	/** Omitted on success — `json:"error,omitempty"`. */
	error?: string
}

/**
 * Server -> client: a frame the client did not ask for.
 *
 * Everything fanned out through the user channel — `chat.*`, `presence.updated`,
 * `notifications.*`. It carries `type` and an optional `payload` and nothing
 * else: there is no request to correlate to and no outcome to report.
 *
 * It used to carry a `requestId` as well, which was never one the receiving
 * client had sent — empty from presence, a fresh UUID from the manager, and the
 * originating user's HTTP request id from chat, broadcast to every recipient
 * (F10). Dropping it is what lets `requestId` mean exactly one thing.
 */
export type ServerEvent = {
	type: string
	payload?: unknown
}

/**
 * Server -> client, as it arrives off the wire.
 *
 * Two envelopes, discriminated by structure rather than by knowing the type
 * vocabulary: a reply has `success`, an event does not. `requestId` agrees with
 * that split, so either field decides it.
 */
export type RawServerFrame = {
	type: string
	requestId?: string
	success?: boolean
	payload?: unknown
	/** Omitted on success — `json:"error,omitempty"`. */
	error?: string
}

/**
 * Narrows a frame to the reply envelope.
 *
 * This is the whole discriminator, and it is the reason the third shape had to
 * go: a `pong` with neither field belonged to neither arm, so a binding could
 * not classify every frame it received.
 */
export function isReply(frame: RawServerFrame): frame is RawServerFrame & ServerReply {
	return typeof frame.success === "boolean"
}

/** Server -> client after the error code has been parsed open (see wire/code.ts). */
export type ServerFrame = Omit<RawServerFrame, "error"> & {
	error?: ParsedCode
}

// Frame types the handshake depends on. The full vocabulary is 30 types
// (11 inbound, 20 outbound, `chat.typing` being both); only the auth subset is
// load-bearing for the session state machine, so only it is named here.
export const AUTH = "auth"
export const AUTH_SUCCESS = "auth.success"
export const AUTH_FAILURE = "auth.failure"
export const AUTH_EXPIRED = "auth.expired"

/**
 * Reports what an expired session cost the client. Only sent by a backend whose
 * write pump parks outbound frames — absent from the deployed one, which
 * discards them (F9).
 */
export const AUTH_EXPIRED_DROPPED = "auth.expired.dropped"

/**
 * Payload of the `auth.expired.dropped` frame (`AUTH_EXPIRED_DROPPED`).
 *
 * `count` and `types` describe the loss; `requestIds` is the part of it a client
 * can act on. It used to report only the first two, so past the pump's bound a
 * client knew a reply had died but not which request was still waiting for one —
 * the same hole the correlated `auth.expired` closed for an ordinary expiry,
 * surviving for overflow (F11, closed in F12).
 *
 * The two fields have to be read together. `requestIds` names the requests that
 * will never be answered, so they are exactly what to resend — and an id it does
 * *not* name is either still parked for replay or was never dropped, so
 * resending it would duplicate it. That inference only holds while `truncated`
 * is false. When it is true the list is a sample, and the only correct policy is
 * the blind one: suspect everything in flight.
 */
export type DroppedFrames = {
	count: number
	types: { type: string; count: number }[]
	/**
	 * The discarded replies, oldest first. Empty rather than absent — every
	 * dropped frame having been a fan-out event is a complete answer, not a
	 * missing one, because an event answers no request by construction.
	 */
	requestIds: string[]
	/** More correlated replies were dropped than `requestIds` names. */
	truncated: boolean
}

/**
 * The minimum surface this SDK needs from a WebSocket implementation.
 *
 * Deliberately narrower than the browser `WebSocket`: the three hosts the TS
 * core has to serve (browser, Electron main + renderer, React Native) do not
 * agree on the concrete class, so the transport is injected. Nothing here
 * touches `document` or `window`.
 */
export type SocketLike = {
	send(data: string): void
	close(code?: number, reason?: string): void
	onmessage: ((event: { data: string }) => void) | null
	onclose: ((event: { code: number; reason: string }) => void) | null
	onerror: ((event: unknown) => void) | null
	onopen: (() => void) | null
}
