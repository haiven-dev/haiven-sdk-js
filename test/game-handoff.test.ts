import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import {
	HaivenClient,
	HandoffError,
	MemoryHandoffTransactionStore,
	browserHandoffHost,
	nodeHandoffHost,
	reactNativeHandoffHost,
	webCryptoHandoffCrypto,
	type HandoffHost,
	type HandoffKeyValueStore,
	type ResponseLike,
	type StoredCredential,
	type TokenStore,
} from "../src/client.ts"
import { FakeServerSocket } from "../src/ws/fake-server.ts"

const NOW = Date.parse("2026-09-17T12:00:00Z")
const REDIRECT = "haiven-example://auth/callback?mode=login"
const ENTRY = "https://app.haiven.gg/connect/game?from=typescript"

type Request = {
	url: string
	method: string
	headers: Record<string, string>
	body?: string
}

type RecordingTokens = TokenStore & {
	credential(): { token: string | null; expiresAt: number | null }
}

function response(status: number, body?: unknown): ResponseLike {
	return {
		status,
		headers: {
			get: (name) =>
				name.toLowerCase() === "content-type" && body !== undefined
					? "application/json"
					: null,
		},
		text: async () => (body === undefined ? "" : JSON.stringify(body)),
	}
}

function tokenStore(initial = "old-access"): RecordingTokens {
	let token: string | null = initial
	let expiresAt: number | null = null
	return {
		read: () => token,
		write: (next, expiry = null) => {
			token = next
			expiresAt = expiry
		},
		credential: () => ({ token, expiresAt }),
	}
}

function memoryStorage(): HandoffKeyValueStore & { readonly values: Map<string, string> } {
	const values = new Map<string, string>()
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value)
		},
		removeItem: (key) => {
			values.delete(key)
		},
	}
}

function clientHarness(exchangeBody: Record<string, unknown> = {
	access_token: "handoff-access",
	token_type: "Bearer",
	expires_in: 300,
}) {
	const tokens = tokenStore()
	const requests: Request[] = []
	const sockets: FakeServerSocket[] = []
	const client = new HaivenClient({
		baseUrl: "https://api.haiven.gg/v0",
		socketUrl: "wss://api.haiven.gg/v0/ws",
		tokens,
		vocabulary: ["unauthorized"],
		fetch: async (url, init) => {
			requests.push({ url, ...init })
			return url.endsWith("/auth/handoff/exchange")
				? response(200, exchangeBody)
				: response(200, { ok: true })
		},
		connect: () => {
			const socket = new FakeServerSocket({
				tokens: [
					{ value: "old-access", userId: "u1", valid: true },
					{ value: "handoff-access", userId: "u1", valid: true },
				],
			})
			sockets.push(socket)
			return socket
		},
	})
	return { client, requests, sockets, tokens }
}

function callback(state: string, code = "one use/code"): string {
	const url = new URL(REDIRECT)
	url.searchParams.set("code", code)
	url.searchParams.set("state", state)
	return url.toString()
}

const webCrypto = webCryptoHandoffCrypto(globalThis.crypto)

describe("the TypeScript game-login handoff", () => {
	it("uses independent 256-bit values and the RFC 7636 S256 transform", async () => {
		const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
		const entropy = [Buffer.from(verifier, "base64url"), new Uint8Array(32).fill(7)]
		const opened: string[] = []
		const { client } = clientHarness()
		const coordinator = client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: {
				profile: "node",
				transactions: new MemoryHandoffTransactionStore(),
				randomBytes: () => new Uint8Array(entropy.shift() ?? []),
				sha256: webCrypto.sha256,
				launchUrl: (url) => {
					opened.push(url)
				},
			},
		})

		const start = await coordinator.beginLogin()
		const authorization = new URL(start.authorizationUrl)

		assert.equal(opened[0], start.authorizationUrl)
		assert.equal(authorization.searchParams.get("from"), "typescript")
		assert.equal(authorization.searchParams.get("integration_id"), "example-game")
		assert.equal(authorization.searchParams.get("completion"), "redirect")
		assert.equal(authorization.searchParams.get("redirect_uri"), REDIRECT)
		assert.equal(authorization.searchParams.get("state"), start.state)
		assert.equal(authorization.searchParams.get("code_challenge_method"), "S256")
		assert.equal(
			authorization.searchParams.get("code_challenge"),
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		)
		assert.equal(start.state.length, 43)
		assert.notEqual(start.state, verifier)
	})

	it("validates callback target and state before exchange, then consumes state once", async () => {
		const { client, requests, tokens } = clientHarness({
			access_token: "header.eyJleHAiOjF9.signature",
			token_type: "Bearer",
			expires_in: 300,
		})
		const coordinator = client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: nodeHandoffHost(),
		})
		const start = await coordinator.beginLogin()

		await assert.rejects(
			coordinator.complete(`haiven-example://other/callback?code=attacker&state=${start.state}`),
			HandoffError,
		)
		await assert.rejects(coordinator.complete(callback("attacker-state")), HandoffError)
		assert.equal(requests.length, 0, "untrusted callbacks never reach the exchange")

		let linked = false
		coordinator.onLinked(() => {
			linked = true
			assert.equal(
				tokens.credential().token,
				"header.eyJleHAiOjF9.signature",
				"the listener runs after the token is stored",
			)
		})
		const credential = await coordinator.complete(callback(start.state))
		assert.equal(linked, true, "a completed handoff notifies onLinked")
		assert.deepEqual(credential, {
			accessToken: "header.eyJleHAiOjF9.signature",
			tokenType: "Bearer",
			expiresAt: NOW + 300_000,
		})
		assert.deepEqual(tokens.credential(), {
			token: "header.eyJleHAiOjF9.signature",
			expiresAt: NOW + 300_000,
		})
		assert.equal(requests.length, 1)
		assert.notEqual(credential.expiresAt, 1_000, "JWT-shaped bearer claims are ignored")
		assert.equal(requests[0]?.headers["Content-Type"], "application/x-www-form-urlencoded")
		const form = new URLSearchParams(requests[0]?.body)
		assert.deepEqual([...form.keys()], ["code", "code_verifier", "integration_id", "redirect_uri"])
		assert.equal(form.get("code"), "one use/code")
		assert.equal(form.get("code_verifier")?.length, 43)
		assert.equal(form.get("integration_id"), "example-game")
		assert.equal(form.get("redirect_uri"), REDIRECT)

		await assert.rejects(coordinator.complete(callback(start.state)), HandoffError)
		assert.equal(requests.length, 1, "a replay is rejected without a second exchange")
	})

	it("clears and re-handoffs for expiry, REST 401, and WebSocket expiry", async () => {
		for (const reason of ["expired", "rest-401", "ws-expired"] as const) {
			const opened: string[] = []
			const { client, tokens } = clientHarness()
			const coordinator = client.createHandoff({
				entryUrl: ENTRY,
				integrationId: "example-game",
				redirectUrl: REDIRECT,
				now: () => NOW,
				host: {
					...nodeHandoffHost(),
					launchUrl: (url) => {
						opened.push(url)
					},
				},
			})

			const restarted = await coordinator.restartLogin(reason)
			assert.equal(tokens.read(), null, `${reason} clears the old bearer`)
			assert.equal(opened.length, 1, `${reason} launches a new handoff`)
			assert.equal(new URL(opened[0] ?? "").searchParams.get("state"), restarted.state)
		}
	})

	it("turns REST 401 into re-handoff without calling web refresh", async () => {
		const opened: string[] = []
		let refreshes = 0
		const tokens = tokenStore()
		tokens.write("opaque-game-bearer", NOW + 300_000)
		const client = new HaivenClient({
			baseUrl: "https://api.haiven.gg/v0",
			socketUrl: "wss://api.haiven.gg/v0/ws",
			tokens,
			vocabulary: ["unauthorized"],
			fetch: async () => response(401, { code: "unauthorized" }),
			refresh: async () => {
				refreshes++
				return "web-token"
			},
			connect: () => new FakeServerSocket({ tokens: [] }),
		})
		client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: {
				...nodeHandoffHost(),
				launchUrl: (url) => {
					opened.push(url)
				},
			},
		})

		await assert.rejects(client.rest.request("/users/me"), /HTTP 401/)
		assert.equal(refreshes, 0)
		assert.equal(tokens.read(), null)
		assert.equal(opened.length, 1)
	})

	it("expires verifier state and rejects refresh credentials", async () => {
		let now = NOW
		const expired = clientHarness()
		const expiredCoordinator = expired.client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => now,
			transactionLifetimeMs: 1_000,
			host: nodeHandoffHost(),
		})
		const start = await expiredCoordinator.beginLogin()
		now += 1_001
		await assert.rejects(expiredCoordinator.complete(callback(start.state)), /expired/)
		assert.equal(expired.requests.length, 0)

		const forbidden = clientHarness({
			access_token: "handoff-access",
			token_type: "Bearer",
			expires_in: 300,
			refresh_token: "must-not-cross-the-boundary",
		})
		const forbiddenCoordinator = forbidden.client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: nodeHandoffHost(),
		})
		const forbiddenStart = await forbiddenCoordinator.beginLogin()
		await assert.rejects(forbiddenCoordinator.complete(callback(forbiddenStart.state)), /refresh/)
		assert.equal(forbidden.tokens.read(), "old-access")
	})
})

/** A token store that survives a restart: `load` returns what an earlier process saved. */
function savedTokenStore(
	saved: StoredCredential | null,
): RecordingTokens & { loads: number; load(): Promise<StoredCredential | null> } {
	const tokens = tokenStore("")
	tokens.write(null, null)
	let persisted = saved
	const store = {
		...tokens,
		loads: 0,
		write: (next: string | null, expiry: number | null = null) => {
			tokens.write(next, expiry)
			persisted = next === null ? null : { token: next, expiresAt: expiry }
		},
		load: async () => {
			store.loads++
			return persisted
		},
		credential: tokens.credential,
		read: tokens.read,
	}
	return store
}

function resumeHarness(tokens: TokenStore) {
	const opened: string[] = []
	const requests: Request[] = []
	const client = new HaivenClient({
		baseUrl: "https://api.haiven.gg/v0",
		socketUrl: "wss://api.haiven.gg/v0/ws",
		tokens,
		vocabulary: ["unauthorized"],
		fetch: async (url, init) => {
			requests.push({ url, ...init })
			return response(200, { ok: true })
		},
		connect: () => new FakeServerSocket({ tokens: [] }),
	})
	const coordinator = client.createHandoff({
		entryUrl: ENTRY,
		integrationId: "example-game",
		redirectUrl: REDIRECT,
		now: () => NOW,
		host: {
			...nodeHandoffHost(),
			launchUrl: (url) => {
				opened.push(url)
			},
		},
	})
	return { client, coordinator, opened, requests }
}

describe("the TypeScript durable game credential (ADR 0041)", () => {
	it("accepts a null expires_in as a credential with no fixed expiry", async () => {
		const { client, tokens } = clientHarness({
			access_token: "durable-access",
			token_type: "Bearer",
			expires_in: null,
		})
		const coordinator = client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: nodeHandoffHost(),
		})
		const start = await coordinator.beginLogin()
		const credential = await coordinator.complete(callback(start.state))
		assert.deepEqual(credential, { accessToken: "durable-access", tokenType: "Bearer", expiresAt: null })
		assert.deepEqual(tokens.credential(), { token: "durable-access", expiresAt: null })
	})

	it("still refuses an expires_in that is missing or not a whole number of seconds", async () => {
		for (const expires of [undefined, "300", 1.5, -1]) {
			const body: Record<string, unknown> = { access_token: "handoff-access", token_type: "Bearer" }
			if (expires !== undefined) body.expires_in = expires
			const { client, tokens } = clientHarness(body)
			const coordinator = client.createHandoff({
				entryUrl: ENTRY,
				integrationId: "example-game",
				redirectUrl: REDIRECT,
				now: () => NOW,
				host: nodeHandoffHost(),
			})
			const start = await coordinator.beginLogin()
			await assert.rejects(coordinator.complete(callback(start.state)), /invalid credential/, String(expires))
			assert.equal(tokens.read(), "old-access")
		}
	})

	it("reuses a saved credential at start instead of opening the browser", async () => {
		for (const expiresAt of [null, NOW + 60_000]) {
			const tokens = savedTokenStore({ token: "saved-access", expiresAt })
			const { client, coordinator, opened, requests } = resumeHarness(tokens)
			let linked: unknown = null
			coordinator.onLinked((credential) => {
				linked = credential
			})

			const resumed = await coordinator.resume()

			assert.deepEqual(resumed, { accessToken: "saved-access", tokenType: "Bearer", expiresAt })
			assert.deepEqual(linked, resumed, "a resumed credential notifies onLinked")
			assert.equal(opened.length, 0, "no browser handoff while a valid credential is saved")
			assert.equal(tokens.loads, 1)
			await client.rest.request("/users/me")
			assert.equal(requests[0]?.headers.Authorization, "Bearer saved-access")
		}
	})

	it("clears a saved credential that has expired or is malformed, then hands off", async () => {
		const saved = [
			{ token: "saved-access", expiresAt: NOW },
			{ token: "", expiresAt: null },
			{ token: "saved-access", expiresAt: "never" },
		] as unknown as StoredCredential[]
		for (const credential of saved) {
			const tokens = savedTokenStore(credential)
			const { coordinator, opened } = resumeHarness(tokens)

			assert.equal(await coordinator.resume(), null)
			assert.equal(await tokens.load(), null, "the unusable credential is cleared from the store")
			assert.equal(tokens.read(), null)
			await coordinator.beginLogin()
			assert.equal(opened.length, 1)
		}
	})

	it("resumes nothing from a store that saves nothing or has no load", async () => {
		const empty = savedTokenStore(null)
		assert.equal(await resumeHarness(empty).coordinator.resume(), null)

		const memoryOnly = tokenStore("in-memory")
		assert.equal(await resumeHarness(memoryOnly).coordinator.resume(), null)
		assert.equal(memoryOnly.read(), "in-memory", "a store without load is left alone")
	})

	it("clears the saved credential on REST 401 so the next start hands off", async () => {
		const tokens = savedTokenStore({ token: "revoked-access", expiresAt: null })
		const opened: string[] = []
		const client = new HaivenClient({
			baseUrl: "https://api.haiven.gg/v0",
			socketUrl: "wss://api.haiven.gg/v0/ws",
			tokens,
			vocabulary: ["unauthorized"],
			fetch: async () => response(401, { code: "unauthorized" }),
			connect: () => new FakeServerSocket({ tokens: [] }),
		})
		const coordinator = client.createHandoff({
			entryUrl: ENTRY,
			integrationId: "example-game",
			redirectUrl: REDIRECT,
			now: () => NOW,
			host: {
				...nodeHandoffHost(),
				launchUrl: (url) => {
					opened.push(url)
				},
			},
		})
		assert.notEqual(await coordinator.resume(), null)

		await assert.rejects(client.rest.request("/users/me"), /HTTP 401/)
		assert.equal(await tokens.load(), null)
		assert.equal(opened.length, 1)
	})
})

type Profile = {
	name: string
	create(opened: string[]): HandoffHost
}

const profiles: Profile[] = [
	{
		name: "browser",
		create: (opened) =>
			browserHandoffHost({
				crypto: globalThis.crypto,
				storage: memoryStorage(),
				openUrl: (url) => opened.push(url),
			}),
	},
	{
		name: "node",
		create: (opened) =>
			nodeHandoffHost({
				openUrl: (url) => {
					opened.push(url)
				},
			}),
	},
	{
		name: "react-native",
		create: (opened) =>
			reactNativeHandoffHost({
				storage: memoryStorage(),
				openUrl: async (url) => {
					opened.push(url)
				},
				randomBytes: webCrypto.randomBytes,
				sha256: webCrypto.sha256,
			}),
	},
]

describe("the browser, Node, and React Native host profiles", () => {
	for (const profile of profiles) {
		it(`${profile.name} writes the assembled client's REST and WebSocket token immediately`, async () => {
			const opened: string[] = []
			const { client, requests, sockets, tokens } = clientHarness()
			const session = client.connect()
			const socket = sockets[0]
			assert.ok(socket)
			socket.open()

			const coordinator = client.createHandoff({
				entryUrl: ENTRY,
				integrationId: "example-game",
				redirectUrl: REDIRECT,
				now: () => NOW,
				host: profile.create(opened),
			})
			const start = await coordinator.beginLogin()
			await coordinator.complete(callback(start.state))

			assert.equal(opened[0], start.authorizationUrl)
			assert.deepEqual(tokens.credential(), {
				token: "handoff-access",
				expiresAt: NOW + 300_000,
			})

			await client.rest.request("/me")
			assert.equal(requests.at(-1)?.headers.Authorization, "Bearer handoff-access")

			socket.expireSession()
			session.send("chat.message.send", { content: "after handoff" })
			assert.deepEqual(
				socket.sent.filter((frame) => frame.type === "auth").map((frame) => frame.payload),
				["old-access", "handoff-access"],
			)
		})
	}
})
