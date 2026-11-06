// One entry point over both cores.
//
// The two transports were bound separately and each is complete on its own:
// `rest/client.ts` speaks the REST surface, `ws/session.ts` speaks the socket.
// Assembling them is not packaging convenience — it is the point where the fork
// this SDK exists to remove actually gets removed.
//
// `packages/app` and `apps/mobile` each wire a REST client and a socket
// separately, and each keeps the access token in its own place. That is the
// shape of `#mobileclientfix`: not one bug, but two token lifecycles that have
// to be kept in step by hand, in two codebases, with nothing failing when they
// drift. The socket authenticates with whatever token it was handed at
// construction; the REST client refreshes on a 401 and writes a new one. Nothing
// tells the socket. It keeps sending the token it was born with until the server
// expires the session out from under it, and the reconnect is what makes it look
// like a network problem.
//
// So the entry point owns ONE `TokenStore` and both cores read through it. The
// socket reads it per-frame rather than holding a copy (`token: () => ...`),
// which is why a REST refresh is visible to the socket without any wiring
// between them. That is the whole reason this file is not two constructors in a
// trench coat.
//
// The three injections F17 forced stay injections. They are host differences,
// not preferences: `fetch` (Electron main has no `window`, React Native's global
// is not the DOM one), token storage (`localStorage` vs `AsyncStorage` vs
// neither), and `baseUrl` (`packages/app` hardcodes a RELATIVE `/v0`, which
// works only same-origin). Defaulting any of them here would make this entry
// point browser-only and re-fork the thing it de-forks.

import { RestClient, type FetchLike, type TokenStore } from "./rest/client.ts"
import { HandoffCoordinator, type HandoffCoordinatorOptions } from "./handoff/core.ts"
import { Session, type SessionOptions } from "./ws/session.ts"
import type { SocketLike } from "./ws/protocol.ts"
import { OpenCodec } from "./wire/code.ts"

export type { FetchLike, ResponseLike, RestClientOptions, StoredCredential, TokenStore } from "./rest/client.ts"
export { RestClient, RestError } from "./rest/client.ts"
export * from "./handoff/index.ts"
export { FOUNDER_STATUS, findPlayerStatus, founderStatus, getGameAccess } from "./player-access.ts"
export * from "./rest/generated.ts"
export { HaivenChat, outgoingStateFor } from "./chat.ts"
export type { HaivenChatOptions, OutgoingChatMessage, OutgoingChatState } from "./chat.ts"
export {
	RewardClaims,
	RewardClaimSessionChangedError,
	browserRewardClaimStore,
	classifyRewardError,
	confirmReward,
	formatUuidV7,
	grantReward,
	memoryRewardClaimStore,
	newUuidV7,
	rewardConfirmation,
} from "./rewards.ts"
export type {
	RewardClaimIntentStore,
	RewardClaimOutcome,
	RewardClaimResult,
	RewardClaimsOptions,
	RewardConfirmation,
	SavedRewardClaim,
} from "./rewards.ts"
export { Session, classifyClose, closeMayReconnect, closeRequiresSignIn } from "./ws/session.ts"
export * from "./ws/generated.ts"
export type {
	SessionClose,
	SessionCloseKind,
	SessionEvent,
	SessionOptions,
	SessionState,
} from "./ws/session.ts"
export type {
	ClientFrame,
	DroppedFrames,
	RawServerFrame,
	ServerFrame,
	SocketLike,
} from "./ws/protocol.ts"
export { OpenCodec } from "./wire/code.ts"
export type { ParsedCode } from "./wire/code.ts"
export { DecodeError, INTEGER_PRECISION_EXCEEDED } from "./wire/json.ts"
export type { DecodeErrorCode } from "./wire/json.ts"
export {
	TelemetryReporter,
	type TelemetryDiagnostic,
	type TelemetryEnvironment,
	type TelemetryErrorDetails,
	type TelemetryPlatform,
	type TelemetryReporterOptions,
	type TelemetryRuntime,
	type TelemetryTransport,
} from "./telemetry.ts"

export type HaivenClientOptions = {
	/**
	 * The REST root, including the version prefix — `https://api.haiven.ai/v0`.
	 *
	 * Explicit for the reason F17 recorded: the relative `/v0` two shipped
	 * clients use is not portable off the serving origin.
	 */
	baseUrl: string

	/**
	 * The socket URL. Separate from `baseUrl` rather than derived from it,
	 * because deriving means guessing a scheme swap and a path, and a deployment
	 * that terminates the socket somewhere else has no way to say so.
	 */
	socketUrl: string

	fetch: FetchLike

	/**
	 * Where the access token lives. Read by both transports, written by the
	 * refresh — this single store is the reason the entry point exists.
	 */
	tokens: TokenStore

	/**
	 * Exchanges the refresh cookie for a fresh access token.
	 *
	 * Injected because the refresh endpoint answers with a cookie, and cookie
	 * handling is the largest behavioural difference between the three hosts.
	 */
	refresh?: () => Promise<string | null>

	/**
	 * Opens a socket to `socketUrl`.
	 *
	 * A factory rather than a socket, because the session is not the only thing
	 * that ever needs a new one — a reconnect needs a second socket, and handing
	 * this client a live one would make reconnection the caller's problem again.
	 */
	connect: (url: string) => SocketLike

	/**
	 * The wire vocabulary this build was compiled against.
	 *
	 * Required, never defaulted. Recognition is relative to what shipped, and the
	 * alternative to naming it is a client that silently recognises nothing. A
	 * code minted after this build is carried with `recognised: false` — never
	 * dropped, never a parse failure.
	 */
	vocabulary: Iterable<string>

	/** Injected so tests are deterministic; hosts pass `crypto.randomUUID`. */
	requestId?: SessionOptions["requestId"]

	/** The host's subscription to session events; see `SessionOptions.onEvent`. */
	onEvent?: SessionOptions["onEvent"]
	/** See `SessionOptions.retainEvents`. */
	retainEvents?: SessionOptions["retainEvents"]
}

/**
 * A client over both transports, sharing one token and one vocabulary.
 *
 * The socket is opened lazily by {@link connect} rather than in the constructor.
 * Constructing a client is not the same act as opening a connection: the REST
 * surface is usable before any socket exists, sign-in happens over REST, and a
 * socket opened before there is a token to authenticate with is refused by the
 * server on its first frame.
 */
export class HaivenClient {
	readonly rest: RestClient

	private readonly options: HaivenClientOptions
	private readonly codec: OpenCodec
	private sessionValue: Session | null = null

	constructor(options: HaivenClientOptions) {
		this.options = options
		// One codec for both transports. Two would be two answers to "do we
		// recognise this code", and the interesting failure is when they differ.
		this.codec = new OpenCodec(options.vocabulary)

		this.rest = new RestClient({
			baseUrl: options.baseUrl,
			fetch: options.fetch,
			tokens: options.tokens,
			refresh: options.refresh,
			codes: this.codec,
		})
	}

	/** The live session, or null before {@link connect} or after {@link close}. */
	get session(): Session | null {
		return this.sessionValue
	}

	/**
	 * Opens the socket and returns the session.
	 *
	 * Idempotent: calling it twice returns the same session rather than opening a
	 * second socket. The server reads exactly one frame from a new connection and
	 * requires it to be `auth`, so a stray second socket is not a duplicate — it
	 * is a second handshake against the same account.
	 */
	connect(): Session {
		if (this.sessionValue) return this.sessionValue

		this.sessionValue = new Session({
			socket: this.options.connect(this.options.socketUrl),
			// Read through, never captured. This is the line that keeps a REST
			// refresh visible to the socket.
			token: () => this.options.tokens.read() ?? "",
			vocabulary: this.options.vocabulary,
			requestId: this.options.requestId,
			onEvent: this.options.onEvent,
			retainEvents: this.options.retainEvents,
		})

		return this.sessionValue
	}

	/**
	 * Creates a game-login handoff that writes into this client's token store.
	 * REST requests and an already-open socket therefore observe the exchanged
	 * credential without a second synchronization path.
	 */
	createHandoff(options: HandoffCoordinatorOptions): HandoffCoordinator {
		return new HandoffCoordinator(this.rest, this.options.tokens, options)
	}

	/**
	 * Closes the socket if one is open, and forgets it.
	 *
	 * Leaves the token alone. Closing a connection is not signing out, and a
	 * client that cleared the token here would make an ordinary teardown look
	 * like a session ending.
	 */
	close(code?: number, reason?: string): void {
		this.sessionValue?.close(code, reason)
		this.sessionValue = null
	}
}
