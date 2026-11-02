// Question 6: do the two published vocabularies survive codegen?
//
// The backend documents both wire boundaries as open string types so a client
// on an older contract can receive and forward a value minted after it shipped.
// These tests check whether that intent survives to a TypeScript consumer.
//
// Only the codecs live here now. The emitter assertions moved to
// codegen/test/test_vocabulary.py with the emitters themselves.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { OpenCodec, SealedCodec } from "../src/wire/code.ts"

// A slice of the real vocabulary, plus a code that does not exist yet. The
// point does not need all 94 values; the measurement of the real enum lives in
// artifact.test.ts.
const SHIPPED = ["unauthorized", "rate_limited", "expired_token", "invalid_payload"] as const

// The case the open type exists for: the server registers a new code, and a
// client compiled before that registration receives it.
const MINTED_LATER = "studio_quota_exceeded"

describe("errorcode.Code through a default generator", () => {
	it("cannot represent a code minted after the client shipped", () => {
		const sealed = new SealedCodec(SHIPPED)

		// The discarding variant loses the value entirely: the client can see
		// that something failed but not what, and cannot forward it.
		assert.equal(sealed.parseOrDrop(MINTED_LATER), undefined)

		// The validating variant is worse — the frame carrying the code becomes
		// unusable, so a routine server addition is a crash in a shipped binary.
		assert.throws(() => sealed.parseOrThrow(MINTED_LATER), TypeError)
	})

	it("still round-trips codes it was compiled with", () => {
		const sealed = new SealedCodec(SHIPPED)
		assert.equal(sealed.parseOrDrop("rate_limited"), "rate_limited")
	})
})

describe("errorcode.Code bound as the open type the backend documents", () => {
	it("preserves an unrecognised code instead of dropping it", () => {
		const open = new OpenCodec(SHIPPED)
		const parsed = open.parse(MINTED_LATER)

		assert.equal(parsed.value, MINTED_LATER, "the value survives")
		assert.equal(parsed.recognised, false, "and is honestly reported as unknown")
	})

	it("keeps recognition available for codes the client has logic for", () => {
		const open = new OpenCodec(SHIPPED)
		const parsed = open.parse("rate_limited")

		assert.equal(parsed.recognised, true)
		assert.ok(open.is(parsed, "rate_limited"))
	})

	it("compares by wire value, never by recognition", () => {
		const open = new OpenCodec(SHIPPED)
		assert.ok(open.is(open.parse(MINTED_LATER), MINTED_LATER))
	})
})
