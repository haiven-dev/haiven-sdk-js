// The same assertion the C# and GDScript spikes make, in the third language.
//
// Each binding tells a reply from an event by the PRESENCE of `success`, never
// its value, and each of the three has a natural spelling that gets it wrong:
// a non-nullable bool in C#, a falsy null from Dictionary.get in GDScript, and
// `if (frame.success)` here. The mistake is invisible until a request is
// refused, at which point the client stops correlating the frames it most needs
// to — so all three bindings pin it the same way, and all three confirm the
// pinning by neutering their own check.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { isReply, type RawServerFrame } from "../src/ws/protocol.ts"

/** The spelling a binding reaches for first, and the reason this file exists. */
const truthy = (frame: RawServerFrame) => Boolean(frame.success)

describe("the outbound discriminant", () => {
	const accepted = { type: "pong", requestId: "rq-1", success: true } as RawServerFrame
	const refused = {
		type: "chat.send",
		requestId: "rq-2",
		success: false,
		error: "rate_limited",
	} as RawServerFrame
	const event = { type: "chat.message", payload: { id: "m1" } } as RawServerFrame

	it("reads an accepted reply as a reply", () => {
		assert.equal(isReply(accepted), true)
	})

	it("reads a refused reply as a reply, which is the whole point", () => {
		// A refused request is a reply that says no. Treating it as an event
		// silently drops the correlation for every rate-limited or rejected
		// frame — the ones a client most needs to match to what it sent.
		assert.equal(isReply(refused), true)
	})

	it("reads an event as an event", () => {
		assert.equal(isReply(event), false)
	})

	it("fails on exactly one case when written the natural way", () => {
		// The neuter, asserted rather than described. `truthy` is what the other
		// two bindings' broken forms compute, and it disagrees with `isReply` on
		// the refused reply and nowhere else.
		assert.equal(truthy(accepted), isReply(accepted))
		assert.equal(truthy(event), isReply(event))
		assert.notEqual(truthy(refused), isReply(refused), "and this is the case it destroys")
	})

	it("keeps absent distinct from empty on requestId", () => {
		// Both are on the wire and both mean something: a server-initiated reply
		// sends "", an event omits the field.
		const announced = { type: "auth.expired", requestId: "", success: false } as RawServerFrame

		assert.equal(announced.requestId, "")
		assert.equal(event.requestId, undefined)
		assert.notEqual(announced.requestId, event.requestId)
	})
})
