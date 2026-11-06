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
// generates the typed requests and event router in ./generated.js from it. The
// envelope below stays hand-written because the session that reads it does.
/**
 * Narrows a frame to the reply envelope.
 *
 * This is the whole discriminator, and it is the reason the third shape had to
 * go: a `pong` with neither field belonged to neither arm, so a binding could
 * not classify every frame it received.
 */
export function isReply(frame) {
    return typeof frame.success === "boolean";
}
// Frame types the handshake depends on. The full vocabulary is 30 types
// (11 inbound, 20 outbound, `chat.typing` being both); only the auth subset is
// load-bearing for the session state machine, so only it is named here.
export const AUTH = "auth";
export const AUTH_SUCCESS = "auth.success";
export const AUTH_FAILURE = "auth.failure";
export const AUTH_EXPIRED = "auth.expired";
/**
 * Reports what an expired session cost the client. Only sent by a backend whose
 * write pump parks outbound frames — absent from the deployed one, which
 * discards them (F9).
 */
export const AUTH_EXPIRED_DROPPED = "auth.expired.dropped";
