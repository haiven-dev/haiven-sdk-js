// Integers beyond 2^53 - 1: refused with a finite SDK-local code, never rounded.
//
// `JSON.parse` turns 9007199254740993 (2^53 + 1) into 9007199254740992 without
// complaint. The C++, Unreal and C# SDKs keep it exactly; this SDK cannot, so it
// refuses the document with `integer_precision_exceeded` instead.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { RestClient } from "../src/rest/client.ts"
import { OpenCodec } from "../src/wire/code.ts"
import { DecodeError, decodeJson, findUnsafeInteger, INTEGER_PRECISION_EXCEEDED } from "../src/wire/json.ts"
import { Session } from "../src/ws/session.ts"
import type { SocketLike } from "../src/ws/protocol.ts"

const refused = (text: string) => (error: unknown) =>
	error instanceof DecodeError && error.code === INTEGER_PRECISION_EXCEEDED && error.message.includes(text)

describe("decodeJson", () => {
	it("refuses 2^53 + 1 instead of rounding it", () => {
		assert.equal(JSON.parse("9007199254740993"), 9007199254740992) // the defect being guarded
		assert.throws(() => decodeJson('{"value":9007199254740993}'), refused("9007199254740993"))
	})

	it("refuses 2^53, which is what 2^53 + 1 rounds to", () => {
		assert.throws(() => decodeJson("[9007199254740992]"), refused("9007199254740992"))
	})

	it("accepts the safe bounds in both signs", () => {
		assert.deepEqual(decodeJson("[9007199254740991,-9007199254740991,0,-0]"), [
			Number.MAX_SAFE_INTEGER,
			Number.MIN_SAFE_INTEGER,
			0,
			-0,
		])
	})

	it("refuses below -(2^53 - 1)", () => {
		assert.throws(() => decodeJson('{"a":[1,{"b":-9007199254740992}]}'), refused("-9007199254740992"))
		assert.throws(() => decodeJson("-9007199254740993"), refused("-9007199254740993"))
	})

	it("refuses literals far beyond the bound", () => {
		assert.throws(() => decodeJson("123456789012345678901234567890"), refused("123456789012345678901234567890"))
	})

	it("ignores digits inside strings, escapes included", () => {
		assert.deepEqual(decodeJson('{"id":"9007199254740993","q":"\\"12345678901234567890"}'), {
			id: "9007199254740993",
			q: '"12345678901234567890',
		})
	})

	it("decodes numbers with a fraction or exponent as floats", () => {
		assert.deepEqual(decodeJson("[12345678901234567.5, 1e300, 90071992547409930e-1]"), [
			12345678901234567.5,
			1e300,
			90071992547409930e-1,
		])
	})

	it("still throws SyntaxError on malformed JSON", () => {
		assert.throws(() => decodeJson("{"), SyntaxError)
	})

	it("finds nothing in a document without a 16-digit run", () => {
		assert.equal(findUnsafeInteger('{"steamId":480,"version":3}'), undefined)
	})
})

describe("the REST client", () => {
	it("rejects a body carrying 2^53 + 1 with the SDK-local code", async () => {
		const client = new RestClient({
			baseUrl: "https://api.example/v0",
			codes: new OpenCodec([]),
			fetch: async () => ({
				status: 200,
				headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
				text: async () => '{"count":9007199254740993}',
			}),
			tokens: { read: () => "token", write: () => {} },
		})
		await assert.rejects(client.request("/thing"), refused("9007199254740993"))
	})
})

describe("the realtime session", () => {
	it("reports a frame carrying 2^53 + 1 as a decode-error and stays open", () => {
		const socket: SocketLike = {
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			send: () => {},
			close: () => {},
		}
		const session = new Session({ socket, token: () => "token" })
		socket.onmessage?.({ data: '{"type":"auth.success","requestId":"","success":true}' })
		assert.equal(session.state, "authenticated")

		socket.onmessage?.({ data: '{"type":"chat.message","payload":{"seq":9007199254740993}}' })
		const decodeErrors = session.events.filter((event) => event.kind === "decode-error")
		assert.equal(decodeErrors.length, 1)
		assert.equal(decodeErrors[0]?.kind === "decode-error" && decodeErrors[0].code, INTEGER_PRECISION_EXCEEDED)
		assert.equal(
			session.events.some((event) => event.kind === "frame" && event.frame.type === "chat.message"),
			false,
		)
		assert.equal(session.state, "authenticated")
	})
})
