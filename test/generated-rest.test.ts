import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { RestClient, type ResponseLike } from "../src/rest/client.ts"
import { OpenCodec } from "../src/wire/code.ts"

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string }

function response(body: unknown): ResponseLike {
	return {
		status: 200,
		headers: { get: () => "application/json" },
		text: async () => JSON.stringify(body),
	}
}

function clientOf(bodies: unknown[]) {
	const sent: Recorded[] = []
	const queue = [...bodies]
	const client = new RestClient({
		baseUrl: "https://api.example/v0",
		codes: new OpenCodec([]),
		fetch: async (url, init) => {
			sent.push({ url, method: init.method, headers: init.headers, body: init.body })
			return response(queue.shift())
		},
		tokens: { read: () => null, write: () => undefined },
	})
	return { client, sent }
}

describe("the generated REST operations", () => {
	it("reads the Message of the Day before sign-in, by integration id", async () => {
		const motd = { id: "m1", body: "New rewards are live.", startsAt: "2026-10-03T00:00:00Z" }
		const { client, sent } = clientOf([motd])

		const got = await client.endpoints.getMotd({ integrationId: "partner game" })

		assert.equal(sent[0].method, "GET")
		assert.equal(sent[0].url, "https://api.example/v0/motd?integration_id=partner%20game")
		assert.deepEqual(got, motd)
	})

	it("encodes path and optional query parameters", async () => {
		const { client, sent } = clientOf([{ messages: [] }])

		await client.endpoints.getChatChannelsChannelIdMessages({
			channelId: "community/general",
			beforeMessageId: "message 1",
			limit: 25,
		})

		assert.equal(
			sent[0]?.url,
			"https://api.example/v0/chat/channels/community%2Fgeneral/messages?beforeMessageId=message%201&limit=25",
		)
		assert.equal(sent[0]?.method, "GET")
	})

	it("passes a typed body through the hand-written transport", async () => {
		const { client, sent } = clientOf([{ accessToken: "access", refreshToken: "refresh" }])

		const result = await client.endpoints.postAuthLogin({
			body: { username: "player", password: "secret" },
		})

		assert.equal(sent[0]?.url, "https://api.example/v0/auth/login")
		assert.equal(sent[0]?.method, "POST")
		assert.equal(sent[0]?.headers["Content-Type"], "application/json")
		assert.equal(sent[0]?.body, JSON.stringify({ username: "player", password: "secret" }))
		assert.equal(result?.accessToken, "access")
	})

	it("preserves the handoff exchange form encoding", async () => {
		const { client, sent } = clientOf([{ access_token: "access", expires_in: 300, token_type: "Bearer" }])

		const result = await client.endpoints.postAuthHandoffExchange({
			body: {
				code: "one use/code",
				code_verifier: "verifier~value",
				integration_id: "example-game",
				redirect_uri: "https://game.example/callback?mode=login",
			},
		})

		assert.equal(sent[0]?.url, "https://api.example/v0/auth/handoff/exchange")
		assert.equal(sent[0]?.method, "POST")
		assert.equal(sent[0]?.headers["Content-Type"], "application/x-www-form-urlencoded")
		assert.equal(
			sent[0]?.body,
			"code=one%20use%2Fcode&code_verifier=verifier~value&integration_id=example-game&redirect_uri=https%3A%2F%2Fgame.example%2Fcallback%3Fmode%3Dlogin",
		)
		assert.deepEqual(result, { access_token: "access", expires_in: 300, token_type: "Bearer" })
		assert.equal("refresh_token" in (result ?? {}), false)
	})

	it("reads the account entitlements (inventory) snapshot", async () => {
		const { client, sent } = clientOf([
			{ asOf: "2026-10-02T00:00:00Z", projectionVersion: 7, entitlements: [{ code: "sword", kind: "item", state: "active" }] },
		])

		const result = await client.endpoints.getUsersMeEntitlements()

		assert.equal(sent[0]?.url, "https://api.example/v0/users/me/entitlements")
		assert.equal(sent[0]?.method, "GET")
		assert.equal(result?.projectionVersion, 7)
		assert.equal(result?.entitlements?.[0]?.kind, "item")
	})

	it("builds SSO initiation as a browser URL rather than fetching the redirect", () => {
		const { client, sent } = clientOf([])

		assert.equal(
			client.endpoints.getAuthSsoProviderUrl({
				provider: "google",
				codeChallenge: "challenge",
				codeChallengeMethod: "S256",
			}),
			"https://api.example/v0/auth/sso/google?code_challenge=challenge&code_challenge_method=S256",
		)
		assert.equal(sent.length, 0)
	})

	it("starts an SSO provider link for the signed-in account", async () => {
		const { client, sent } = clientOf([{ redirectUrl: "https://auth.example/authorize" }])

		const result = await client.endpoints.postUsersMeSignInMethodsSsoProvider({ provider: "apple" })

		assert.equal(sent[0]?.url, "https://api.example/v0/users/me/sign-in-methods/sso/apple")
		assert.equal(sent[0]?.method, "POST")
		assert.equal(result?.redirectUrl, "https://auth.example/authorize")
	})
})
