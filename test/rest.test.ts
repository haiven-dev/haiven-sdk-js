// What binding the REST surface costs a client, measured the same way the socket
// half was: against a fake peer that behaves like the server, so each test reads
// as a transcript rather than as a mock assertion.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { RestClient, RestError, type ResponseLike } from "../src/rest/client.ts"
import { OpenCodec } from "../src/wire/code.ts"

/** A snapshot of what a client compiled today would know. */
const CODES = new OpenCodec(["unauthorized", "bad_request", "rate_limit_reached"])

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string }

function respond(
	status: number,
	body?: unknown,
	options: { contentType?: string | null } = {},
): ResponseLike {
	// The server sets Content-Type only when it writes a body. `response.JSON`
	// takes the same branch, which is what makes a 204 headerless.
	const contentType =
		options.contentType === undefined
			? body === undefined
				? null
				: "application/json; charset=utf-8"
			: options.contentType

	return {
		status,
		headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
		text: async () => (body === undefined ? "" : JSON.stringify(body)),
	}
}

function clientOf(responses: ResponseLike[], options: { refresh?: () => Promise<string | null> } = {}) {
	const sent: Recorded[] = []
	let token: string | null = "access-1"
	const queue = [...responses]

	const client = new RestClient({
		baseUrl: "https://api.example/v0",
		codes: CODES,
		fetch: async (url, init) => {
			sent.push({ url, method: init.method, headers: init.headers, body: init.body })
			const next = queue.shift()
			assert.ok(next, `no response queued for ${init.method} ${url}`)
			return next
		},
		tokens: {
			read: () => token,
			write: (value) => {
				token = value
			},
		},
		...(options.refresh ? { refresh: options.refresh } : {}),
	})

	return { client, sent, token: () => token }
}

describe("binding the REST surface", () => {
	it("sends the token and an absolute url", async () => {
		const { client, sent } = clientOf([respond(200, { id: "u1" })])

		await client.request("/users/me")

		assert.equal(sent[0]?.url, "https://api.example/v0/users/me")
		assert.equal(sent[0]?.headers.Authorization, "Bearer access-1")
		// No Content-Type on a request with no body: sending one would make an
		// empty POST look like it carried JSON.
		assert.equal(sent[0]?.headers["Content-Type"], undefined)
	})

	it("answers null for a 204, rather than failing to parse nothing", async () => {
		const { client } = clientOf([respond(204)])

		// This is the shape most mutations answer with now that the string success
		// vocabulary is gone. A binding that assumed a body would throw on every
		// one of them.
		assert.equal(await client.request("/users/me/referrals", { method: "POST" }), null)
	})

	it("replays a form request without changing its media type", async () => {
		const { client, sent } = clientOf([respond(401), respond(200, { access_token: "access-2" })], {
			refresh: async () => "access-2",
		})

		await client.request("/auth/handoff/exchange", {
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: { code: "one use", code_verifier: "verify/value" },
		})

		assert.equal(sent.length, 2)
		for (const request of sent) {
			assert.equal(request.headers["Content-Type"], "application/x-www-form-urlencoded")
			assert.equal(request.body, "code=one%20use&code_verifier=verify%2Fvalue")
		}
	})

	it("ignores a body the server did not label as JSON", async () => {
		const { client } = clientOf([respond(200, { id: "u1" }, { contentType: "text/html" })])

		// The guard is what made deleting the success bodies invisible to both
		// shipped clients: they parse on the header, not on the status.
		assert.equal(await client.request("/users/me"), null)
	})

	it("surfaces the error code, and keeps the prose for a human", async () => {
		const { client } = clientOf([
			respond(400, { status: 400, code: "bad_request", message: "studio id required" }),
		])

		const error = await client.request("/studios").then(
			() => null,
			(e: unknown) => e as RestError,
		)

		assert.ok(error instanceof RestError)
		assert.equal(error.code?.value, "bad_request")
		assert.equal(error.code?.recognised, true)
		assert.equal(error.message, "studio id required")
		assert.equal(error.status, 400)
	})

	it("carries a code minted after it shipped instead of dropping it", async () => {
		const { client } = clientOf([
			respond(409, { status: 409, code: "studio_seat_limit_reached", message: "no seats left" }),
		])

		const error = (await client.request("/studios/x/members", { method: "POST" }).catch(
			(e: unknown) => e,
		)) as RestError

		// The whole reason Code is an open type. A sealed enum would have thrown
		// here, in a binary nobody can update, on a routine server addition.
		assert.equal(error.code?.value, "studio_seat_limit_reached")
		assert.equal(error.code?.recognised, false)
	})

	it("refreshes once on a 401 and replays the request", async () => {
		let refreshes = 0
		const { client, sent, token } = clientOf([respond(401), respond(200, { id: "u1" })], {
			refresh: async () => {
				refreshes += 1
				return "access-2"
			},
		})

		assert.deepEqual(await client.request("/users/me"), { id: "u1" })
		assert.equal(refreshes, 1)
		assert.equal(token(), "access-2")
		assert.equal(sent[0]?.headers.Authorization, "Bearer access-1")
		assert.equal(sent[1]?.headers.Authorization, "Bearer access-2", "the replay uses the new token")
	})

	it("does not retry forever when the refresh itself is refused", async () => {
		let refreshes = 0
		const { client, sent, token } = clientOf([respond(401), respond(401)], {
			refresh: async () => {
				refreshes += 1
				return "access-2"
			},
		})

		const error = (await client.request("/users/me").catch((e: unknown) => e)) as RestError

		// One retry, not a loop. A revoked session answers 401 to the replay too,
		// and it is the second failure that is worth reporting.
		assert.equal(error.status, 401)
		assert.equal(refreshes, 1)
		assert.equal(sent.length, 2)
		assert.equal(token(), "access-2")
	})

	it("gives up rather than replaying when the refresh yields no token", async () => {
		const { client, sent, token } = clientOf([respond(401)], { refresh: async () => null })

		const error = (await client.request("/users/me").catch((e: unknown) => e)) as RestError

		assert.equal(error.status, 401)
		assert.equal(sent.length, 1, "no replay without a token to replay with")
		assert.equal(token(), null, "and the dead token is cleared rather than reused")
	})

	it("reports a status even when the failure carries no body at all", async () => {
		const { client } = clientOf([respond(502)])

		const error = (await client.request("/users/me").catch((e: unknown) => e)) as RestError

		// A gateway answers before the API does, so there is no code and no prose.
		// The client still has to produce something a caller can branch on.
		assert.equal(error.status, 502)
		assert.equal(error.code, null)
		assert.equal(error.message, "HTTP 502")
	})
})
