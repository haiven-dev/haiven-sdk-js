// The REST half of the binding, which the spike had never attempted.
//
// The socket half was measured first because it was the one with no
// machine-readable description. REST had the opposite problem: a 380 KB Go file
// nobody could consume. That artifact is now emitted as `swagger.json`, so this
// is the first time the REST surface can be bound against something a generator
// reads rather than against a reading of the handlers.
//
// Everything here is hand-written on purpose. The point is to find what the
// surface costs a client *before* a generator hides it — a generated client
// would paper over exactly the decisions recorded below.

import { OpenCodec, type ParsedCode } from "../wire/code.ts"
import { RestApi, type RestRequestContentType } from "./generated.ts"

export * from "./generated.ts"

/**
 * The minimum this client needs from a fetch implementation.
 *
 * Deliberately narrower than the DOM `fetch`. The three hosts the TS core has to
 * serve — browser, Electron main and renderer, React Native — do not agree on
 * the concrete global, and Electron's main process has no `window` at all. The
 * same reason `SocketLike` exists for the socket half.
 */
export type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<ResponseLike>

/** The subset of a fetch `Response` this client reads. */
export type ResponseLike = {
	status: number
	headers: { get(name: string): string | null }
	text(): Promise<string>
}

/**
 * Where the access token lives.
 *
 * Injected rather than assumed, because the three hosts disagree about what
 * durable storage is: a browser has `localStorage`, React Native has
 * `AsyncStorage`, and Electron's main process has neither. `packages/app` keeps
 * it in a module-level variable, which works only because it is one process with
 * one user.
 */
export type TokenStore = {
	read(): string | null
	/**
	 * Writes the current access token. Handoff callers also provide its absolute
	 * expiry as Unix milliseconds; older stores may ignore that optional value.
	 */
	write(token: string | null, expiresAt?: number | null): void
}

export type RestClientOptions = {
	/**
	 * The API root, including the version prefix — for example
	 * `https://api.haiven.ai/v0`.
	 *
	 * Explicit rather than derived. `packages/app` hardcodes a relative `/v0`,
	 * which works only because it is served from the same origin; Electron and
	 * React Native have no origin to be relative to.
	 */
	baseUrl: string
	fetch: FetchLike
	tokens: TokenStore
	/**
	 * Exchanges the refresh cookie for a fresh access token, returning it.
	 *
	 * Supplied by the caller because the refresh endpoint answers with a cookie,
	 * and cookie handling is the single largest behavioural difference between
	 * the three hosts.
	 */
	refresh?: () => Promise<string | null>
	/**
	 * The error vocabulary this client was compiled against.
	 *
	 * Required rather than defaulted, because the alternative to naming it is a
	 * client that silently recognises nothing. Recognition is relative to what
	 * shipped: a code minted after this build is carried and reported with
	 * `recognised: false`, never dropped and never a parse failure.
	 */
	codes: OpenCodec
}

/**
 * A request that did not succeed.
 *
 * `code` is what a caller branches on and it is deliberately a {@link ParsedCode}
 * rather than a string union: a client compiled against an older contract has to
 * be able to receive a code minted after it shipped, carry it, and log it. The
 * server's prose lands in `message`, which is for a human and never for a
 * condition.
 */
export class RestError extends Error {
	readonly status: number
	readonly code: ParsedCode | null

	constructor(status: number, code: ParsedCode | null, message: string) {
		super(message || `HTTP ${status}`)
		this.name = "RestError"
		this.status = status
		this.code = code
	}
}

type ErrorBody = { code?: unknown; message?: unknown }

export class RestClient {
	private readonly options: RestClientOptions
	/** One generated, typed method for every operation in the pinned REST description. */
	readonly endpoints: RestApi

	constructor(options: RestClientOptions) {
		this.options = options
		this.endpoints = new RestApi(this)
	}

	/**
	 * Sends one request and returns its parsed body, or `null` when there is
	 * none.
	 *
	 * `null` rather than `undefined` or a thrown parse error: since the success
	 * bodies were reduced to a status, most mutations answer 204, and a binding
	 * that assumed a body would now throw on every one of them.
	 */
	async request<T>(
		path: string,
		init: {
			method?: string
			body?: unknown
			contentType?: RestRequestContentType
			retried?: boolean
		} = {},
	): Promise<T | null> {
		const { method = "GET", body, contentType = "application/json", retried = false } = init

		const token = this.options.tokens.read()
		const headers: Record<string, string> = {}
		if (body !== undefined) headers["Content-Type"] = contentType
		if (token) headers.Authorization = `Bearer ${token}`

		const response = await this.options.fetch(`${this.options.baseUrl}${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: encodeRequestBody(body, contentType) }),
		})

		// One retry, never a loop. A refresh that keeps failing against a revoked
		// session would otherwise retry forever, and the second failure is the
		// one worth reporting.
		if (response.status === 401 && !retried && this.options.refresh) {
			const refreshed = await this.options.refresh()
			this.options.tokens.write(refreshed)
			if (refreshed) {
				return this.request<T>(path, { method, body, contentType, retried: true })
			}
		}

		const payload = await readJson(response)

		if (response.status >= 400) {
			throw toError(this.options.codes, response.status, payload)
		}

		return (payload as T | null) ?? null
	}
}

function encodeRequestBody(body: unknown, contentType: RestRequestContentType): string {
	if (contentType === "application/json") return JSON.stringify(body)
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new TypeError("form request body must be an object")
	}

	const fields: string[] = []
	for (const [name, value] of Object.entries(body)) {
		if (value === undefined) continue
		if (value === null || typeof value === "object") {
			throw new TypeError(`form request field ${name} must be a scalar`)
		}
		fields.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
	}
	return fields.join("&")
}

/**
 * Parses a body only when the server says there is one.
 *
 * The content-type guard is load-bearing rather than defensive. A 204 carries no
 * `Content-Type` at all, so a reader that called `.json()` unconditionally would
 * throw on every successful mutation — which is also why deleting the string
 * success vocabulary was invisible to the two shipped clients: both guard on
 * this header, and both therefore never noticed the bodies disappear.
 */
async function readJson(response: ResponseLike): Promise<unknown> {
	if (!response.headers.get("content-type")?.includes("application/json")) {
		return null
	}

	const raw = await response.text()
	if (raw === "") return null

	return JSON.parse(raw)
}

function toError(codes: OpenCodec, status: number, payload: unknown): RestError {
	if (payload === null || typeof payload !== "object") {
		return new RestError(status, null, "")
	}

	const body = payload as ErrorBody

	return new RestError(
		status,
		typeof body.code === "string" ? codes.parse(body.code) : null,
		typeof body.message === "string" ? body.message : "",
	)
}
